# Design 007 · Roteamento de modelos por tarefa, prioridade e disponibilidade

**Cobre:** RQ-ROT-01 … RQ-ROT-12
**Depende de:** 002 (snapshot), 003 (taxonomia de erro e spans), 004 (retentativa)

## O problema

Um agente hoje aponta para **um** `providerId` + `model`. Se aquele provedor devolver
500, estourar o limite de taxa ou simplesmente não conhecer o modelo, a execução falha —
o worker até repete, mas repete *o mesmo modelo*, contra *o mesmo provedor*, que
continua fora do ar. Não há como dizer "para raciocínio pesado use Opus, e se ele estiver
indisponível caia para Sonnet, e só então para o modelo local".

Duas necessidades distintas, frequentemente confundidas:

1. **Escolha deliberada** — qual modelo é o *mais adequado* para este tipo de tarefa,
   em que ordem de preferência (decisão de projeto, estática).
2. **Escolha reativa** — qual modelo está *funcionando agora* (fato operacional,
   dinâmico).

O design trata as duas como camadas separadas: a ordem deliberada é a base, e a
disponibilidade observada apenas **reordena** essa base — nunca a substitui.

## Decisões

| # | Decisão | Motivo |
| --- | --- | --- |
| D1 | Cadeia = lista ordenada de candidatos `(taskType, rank, provider, model)` | Ordem explícita e determinística; `rank` evita o empate ambíguo que "ordem de inserção" produziria (RQ-ROT-05). |
| D2 | Política reutilizável **e** sobrescrita por agente | A cadeia costuma ser organizacional ("raciocínio pesado"), mas um agente específico às vezes precisa fugir do padrão sem quebrar os outros (RQ-ROT-02/03). |
| D3 | Disponibilidade **reordena**, não filtra | Um provedor com carência aberta ainda é melhor que falhar a run quando todos os outros também caíram (RQ-ROT-08/09). |
| D4 | Failover dentro da chamada, não por re-execução da run | Refazer a run perderia o histórico de mensagens e cobraria de novo os turnos já pagos. O failover troca só a chamada que falhou. |
| D5 | Failover só para erro de **indisponibilidade** | Cancelamento e timeout da run são decisão do usuário/sistema; erro de validação vai falhar igual no próximo modelo (RQ-ROT-07). |
| D6 | Cadeia **resolvida** entra no snapshot | Sem isso, editar uma política reescreveria o que uma versão publicada executa — contradiz RQ-VER-05 (RQ-ROT-10). |
| D7 | Saúde persistida em tabela, não só em memória | Sobrevive a reinício do processo e fica consultável/observável; o volume é ínfimo (uma linha por par provedor+modelo). |
| D8 | `provider`/`model` do agente vira o último candidato | Todo agente existente continua funcionando sem configurar nada (RQ-ROT-12). |

## Modelo de dados

```prisma
model ModelPolicy {
  id, name, slug (único), description, enabled, deletedAt, timestamps, autoria
  candidates ModelCandidate[]
  agents     Agent[]
}

model ModelCandidate {
  id
  policyId?  → ModelPolicy (cascade)     // candidato da política
  agentId?   → Agent       (cascade)     // OU sobrescrita do agente (D2)
  taskType   String @default("default")
  rank       Int    @default(0)          // menor = tentado primeiro
  providerId → Provider
  model      String
  maxTokens?  Int                        // override opcional do parâmetro do agente
  temperature? Float
  enabled    Boolean @default(true)
}

model ModelHealth {
  providerId + model (único)
  consecutiveFailures Int
  lastErrorType?, lastErrorAt?, lastOkAt?
  cooldownUntil?                          // carência aberta = despriorizado (D3)
}
```

`Agent` ganha `modelPolicyId?` e `taskType` (o tipo padrão das execuções daquele
agente). `Run` ganha `taskType?` (o tipo pedido na chamada) e `modelFailover Boolean`
(marca a execução que precisou trocar de candidato — RQ-ROT-11).

Um `ModelCandidate` pertence **ou** a uma política **ou** a um agente; nunca aos dois.
A restrição é de aplicação, não de banco — o SQLite não expressa "exatamente um de dois
opcionais" sem um `CHECK` que o Prisma não gera.

## Resolução da cadeia

`src/lib/routing/resolve.ts`, função pura sobre linhas já carregadas:

```
resolveChain(agent, taskType):
  1. candidatos do próprio agente com aquele taskType        → se houver, use
  2. candidatos do próprio agente com taskType "default"     → se houver, use
  3. candidatos da política do agente com aquele taskType    → se houver, use
  4. candidatos da política do agente com "default"          → se houver, use
  5. []                                                       (nada configurado)
  + sempre anexa agent.provider/agent.model ao fim, se ainda não estiver na lista (D8)
```

A busca por tipo de tarefa **não** mistura níveis: se o agente tem candidatos próprios
para `reasoning`, a política não é consultada para `reasoning` (D2 — sobrescrita é
sobrescrita, não união). Mas se o agente só tem candidatos para `coding` e a run pede
`reasoning`, cai-se para o passo 3 e a política responde.

Empate de `rank` é resolvido pelo id do candidato — determinístico e estável entre
processos, como no layout do design 006.

## Ordenação por disponibilidade

`orderByAvailability(chain, health, now)` faz uma ordenação **estável** em dois grupos:

```
[ candidatos sem carência aberta, na ordem de rank ]
[ candidatos com carência aberta, na ordem de rank ]
```

Nunca remove ninguém (D3). A carência abre depois de `FAILURE_THRESHOLD` falhas
consecutivas e dura `COOLDOWN_MS` a partir da última falha, com teto — um sucesso zera
`consecutiveFailures` e fecha a carência na hora.

Isso é um disjuntor deliberadamente frouxo: ele não impede a chamada, só muda a ordem.
Um disjuntor que *bloqueia* exigiria uma política de meia-abertura e um relógio confiável
entre réplicas — complexidade que o teto de escala deste projeto (worker in-process,
design 004) não justifica.

## Failover na chamada

`completeWithFailover()` substitui a chamada direta a `complete()` dentro do loop de
tool-calling do orquestrador:

```
para cada candidato na cadeia ordenada:
    abre span "model:<modelo>" com orq.model.rank e orq.model.attempt
    tenta complete(...)
    sucesso → registra saúde ok, fecha span, devolve resultado
    falha:
      classifica (design 003)
      NÃO é indisponibilidade → fecha span, propaga o erro (RQ-ROT-07)
      é indisponibilidade → registra saúde, log warn, tenta o próximo
todos falharam → propaga o erro do último candidato (RQ-ROT-09)
```

`isFailoverable(errorType, httpStatus)`:

| Erro | Failover? | Por quê |
| --- | --- | --- |
| `provider_error` 5xx / 404 / 401 / 403 | sim | provedor fora do ar, modelo inexistente ou credencial inválida — outro candidato pode servir |
| `provider_rate_limit` | sim | é exatamente o caso de uso |
| `provider_error` 4xx restante | não | requisição malformada; falha igual no próximo |
| `cancelled`, `timeout` | não | decisão do usuário/sistema (RQ-ROT-07) |
| demais | não | não indicam indisponibilidade |

Cada tentativa gera **seu próprio span**, então o trace mostra a cadeia inteira: dois
spans `model:` irmãos, o primeiro em erro e o segundo em sucesso. A retentativa da run
(design 004) continua valendo *depois* de a cadeia esgotar — são camadas independentes.

## Snapshot e versionamento (RQ-ROT-10)

`FlowSnapshotAgent` ganha `taskType` e `candidates[]` — a cadeia **já resolvida** no
momento da publicação, com `provider` embutido (id, kind, name; nunca segredo, como
manda RQ-VER-09). Consequências:

- editar uma política depois não muda o que a versão publicada executa (D6);
- o hash canônico passa a cobrir roteamento, então a primeira publicação após esta fase
  aparece como alteração — comportamento correto, não regressão;
- o diff ganha os campos `routing.taskType` e `routing.candidates`.

Na execução a partir do snapshot, os candidatos são reconstruídos com o `Provider` vivo
buscado por id (segredo), igual ao que 002 já faz com o provedor único.

## API

```
GET    /api/model-policies          lista           policy.read
POST   /api/model-policies          cria            policy.write
GET    /api/model-policies/:id      detalha         policy.read
PATCH  /api/model-policies/:id      atualiza        policy.write
DELETE /api/model-policies/:id      exclusão lógica policy.write
GET    /api/model-health            saúde observada policy.read
```

Candidatos são gerenciados **junto do dono** (`candidates: [...]` no corpo do PATCH da
política ou do agente), substituindo a lista inteira. CRUD individual por candidato daria
seis rotas a mais para editar uma lista que a UI sempre manipula por inteiro.

`POST /api/runs` ganha `taskType` opcional; `POST`/`PATCH /api/agents` ganham
`modelPolicyId`, `taskType` e `candidates`. Nenhum contrato existente muda.

Papéis: `viewer` recebe `policy.read`; `editor` e `admin` recebem `policy.write` —
mesma faixa de `agent.write`, porque escolher modelo é configuração de agente, não
manuseio de segredo.

## Alternativas rejeitadas

- **Roteamento por custo/latência medidos** (escolher o mais barato que atende) — exige
  série temporal por modelo e uma função de utilidade que ninguém sabe calibrar antes de
  ter tráfego. A ordem explícita resolve o caso real e não impede evoluir para isto.
- **Classificar o tipo de tarefa com um LLM** — introduz uma chamada de modelo para
  decidir qual modelo chamar, com custo, latência e um modo de falha novo bem no caminho
  crítico. O tipo vem declarado por quem chama.
- **Disjuntor que bloqueia o candidato** — transformaria indisponibilidade parcial em
  falha total quando toda a cadeia estivesse em carência; D3 evita isso.
- **Failover re-executando a run inteira** — perderia o histórico de mensagens do turno
  e recobraria os turnos já pagos (D4).
- **Candidato como JSON dentro do agente** — mataria a política reutilizável (D2) e
  impediria consultar "quais agentes usam o modelo X".

## Plano de verificação

1. Agente sem nada configurado executa pelo `provider`/`model` de sempre (RQ-ROT-12).
2. Cadeia de três candidatos: executa pelo primeiro; derrubando o primeiro, conclui pelo
   segundo e o trace mostra os dois spans.
3. `taskType: "reasoning"` usa a cadeia de `reasoning`; sem ele, a de `default`.
4. Candidatos do agente prevalecem sobre os da política, sem alterar a política.
5. Cancelar durante a chamada não tenta o próximo candidato.
6. Todos fora do ar → run `failed` com o erro do último e contagem de tentativas.
7. Falhas consecutivas abrem carência e jogam o candidato para o fim; sucesso a fecha.
8. Publicar, editar a política, reexecutar a versão publicada → cadeia original.
9. Diff entre versões mostra a mudança de roteamento.
