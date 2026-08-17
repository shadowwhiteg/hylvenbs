# Design 005 · Criptografia de segredos em repouso

**Cobre:** RQ-SEC-01 … RQ-SEC-10
**Depende de:** nada · **Relaciona-se com:** 001 (quem pode escrever segredo), 002 (snapshot sem segredo)

## O problema

`Provider.apiKey`, `McpServer.env` e `McpServer.headers` estão em texto plano no SQLite.
Qualquer cópia do `dev.db` — backup, anexo de bug, sincronização de pasta — carrega as
chaves. O arquivo tem permissão de usuário comum e nenhuma barreira.

**Modelo de ameaça.** Protege: cópia indevida do arquivo do banco, dump acidental,
`SELECT` por alguém com acesso de leitura ao banco, vazamento por log/resposta de API.
Não protege: quem já tem o processo e a `ENCRYPTION_KEY` — o servidor precisa do valor em
claro para chamar o provedor. Isso é limite conhecido de cifra em repouso, não descuido.

## Decisões

| # | Decisão | Motivo |
| --- | --- | --- |
| D1 | AES-256-GCM do `node:crypto` | Autenticado (detecta adulteração, RQ-SEC-04), padrão, sem dependência (T1). |
| D2 | Envelope numa única coluna `String` | Migração vira transformação de dados; nenhuma tabela nova, nenhuma junção no caminho quente. |
| D3 | Chave mestra em `ENCRYPTION_KEY` (env) | Guardar no banco anularia o objetivo (RQ-SEC-02). |
| D4 | Versão de chave no prefixo do envelope | Rotação sem parada: `v1` e `v2` coexistem durante a migração (RQ-SEC-06). |
| D5 | Falhar ruidosamente sem a chave | Degradar em silêncio deixaria segredos ilegíveis parecendo "provedor com problema" (RQ-SEC-03). |
| D6 | Máscara na borda, por padrão | Serialização já mascara; nenhuma rota devolve claro (RQ-SEC-08). |

## Formato do envelope (RQ-SEC-01)

```
v<versão>:<iv-b64url>:<tag-b64url>:<ciphertext-b64url>
       │        │            │
       │        │            └── tag GCM de 16 bytes
       │        └── IV aleatório de 12 bytes, novo a cada escrita
       └── versão da chave mestra (1, 2, …)
```

```ts
// src/lib/crypto/secrets.ts
export function encrypt(plain: string): string;      // usa a versão corrente
export function decrypt(envelope: string): string;   // resolve a versão pelo prefixo
export function isEnvelope(value: string): boolean;  // migração idempotente
export function mask(value: string): string;         // "sk-a…z9"
```

**Chave** — `ENCRYPTION_KEY` com 32 bytes em base64url, gerada por
`npm run generate-key` (`crypto.randomBytes(32)`). Chaves antigas ficam em
`ENCRYPTION_KEY_V1`, `ENCRYPTION_KEY_V2`, … durante a rotação. Nada disso vai para o
banco; o `.env` já está no `.gitignore`.

**Dado associado (AAD)** — o envelope usa `<modelo>:<id>:<campo>` como AAD, de forma que
um ciphertext copiado de um provedor para outro registro falha na verificação. Custo
zero, elimina uma classe de troca indevida.

## O que é cifrado

| Campo | Antes | Depois |
| --- | --- | --- |
| `Provider.apiKey` | texto plano | `Provider.apiKeyEnc` (envelope) |
| `McpServer.env` | JSON em claro | `McpServer.envEnc` (envelope do JSON) + `envKeys` (nomes, em claro) |
| `McpServer.headers` | JSON em claro | `McpServer.headersEnc` + `headerKeys` |

Os **nomes** ficam em claro de propósito: a UI precisa mostrar quais variáveis existem, o
snapshot de versão precisa listá-las (RQ-VER-09) e o `configHash` precisa detectar drift
sem decifrar nada (RQ-VER-10).

Senhas (`User.passwordHash`) e tokens (`Session.tokenHash`, `ApiToken.tokenHash`) **não**
são cifrados — são hashes de verificação, nunca precisam voltar ao original.

## Onde se decifra (RQ-SEC-07)

Somente dois pontos:

- [src/lib/providers.ts](../../src/lib/providers.ts) → ao montar o header de autenticação
  da chamada.
- [src/lib/mcp.ts](../../src/lib/mcp.ts) → ao montar `env` do processo filho ou os headers
  HTTP.

O valor vive numa variável local pelo tempo da chamada; não entra em cache, span, log nem
serialização. Regra verificável: `grep` por `decrypt(` fora desses dois arquivos e dos
scripts de migração/rotação deve retornar vazio — vira teste de arquitetura.

## Bootstrap e falha (RQ-SEC-03)

Na inicialização (`instrumentation.ts`):

1. `ENCRYPTION_KEY` ausente **e** existe pelo menos um envelope no banco → aborta com:
   `ENCRYPTION_KEY ausente. Gere com "npm run generate-key" e defina no .env.`
2. Chave presente com tamanho errado → aborta.
3. Chave presente e banco sem envelope → segue (instalação nova).
4. Decifra um registro de teste; falha de tag → aborta com "chave incorreta para os dados
   existentes" — evita a situação de descobrir o problema só na primeira execução.

## Migração dos dados atuais (RQ-SEC-05)

`npm run migrate:secrets`:

```
para cada Provider/McpServer:
  se o valor já é envelope → pula                 (idempotente)
  senão → cifra, grava, e no caso de env/headers deriva envKeys/headerKeys
recalcula configHash
```

Roda depois da migração de schema, dentro de uma transação por registro. Ao final,
verifica que não sobrou nenhum valor não-envelope e imprime o resumo. Executar duas vezes
é seguro — critério de aceite do RQ-SEC-05.

## Rotação (RQ-SEC-06)

`npm run rotate-keys`:

```
1. exige ENCRYPTION_KEY (nova, vN) e ENCRYPTION_KEY_V<N-1> (anterior)
2. para cada envelope: decifra com a versão do prefixo → recifra com vN
3. relatório final por versão; aborta e mantém o estado anterior se qualquer item falhar
```

Registros de versões diferentes coexistem enquanto a rotação roda: `decrypt` sempre
resolve a versão pelo prefixo, então a aplicação continua funcionando durante o processo.

## Superfície de vazamento (RQ-SEC-08)

Camadas de defesa:

1. `serialize.ts` nunca projeta campo cifrado — só `hasApiKey` e a máscara.
2. `PATCH` com string vazia significa "manter" (RQ-SEC-10); o valor atual nunca precisa
   trafegar de volta ao cliente para ser preservado.
3. Mascarador aplicado a payloads de span e log (003) sobre um conjunto de padrões
   (`sk-…`, `Bearer …`, valores conhecidos de `envKeys`).
4. Snapshot de versão carrega só nomes (002).
5. A Postman Collection usa `{{anthropic_api_key}}` como variável, sem valor embutido.
6. Teste de vazamento: cadastra segredos-sentinela, exercita todos os endpoints, spans,
   logs e a collection, e falha se qualquer sentinela aparecer.

## Divisão de responsabilidade com o RBAC (001)

`editor` cria um servidor MCP declarando `envKeys: ["GITHUB_TOKEN"]` sem valor; o servidor
fica em estado `awaiting_secret` e não executa. Um `admin` preenche os valores em
`PUT /api/mcp/:id/secrets`, e só então o servidor fica utilizável. Assim quem constrói o
fluxo não precisa manipular segredo.

## Alternativas rejeitadas

- **SQLCipher (banco inteiro cifrado)** — protegeria tudo, mas exige binário nativo e
  troca o driver do Prisma; peso alto para um problema resolvido em uma coluna.
- **Keychain do sistema operacional** — some no self-host em contêiner, que é o alvo.
- **Cofre externo (Vault/KMS)** — dependência de infraestrutura; o desenho de envelope com
  versão permite trocar a origem da chave mestra depois, sem mexer nos dados.
- **AES-CBC + HMAC** — mais peças para o mesmo resultado que o GCM entrega autenticado.
- **Cifrar também os nomes das variáveis** — quebraria UI, snapshot e detecção de drift em
  troca de esconder um dado que não é segredo.

## Plano de verificação

1. `SELECT apiKeyEnc FROM Provider` não devolve nada legível; formato do envelope confere.
2. Adulterar um byte do ciphertext → falha de tag, sem chamada ao provedor.
3. Subir sem `ENCRYPTION_KEY` com dados cifrados → boot abortado com mensagem acionável.
4. `migrate:secrets` duas vezes → banco consistente, zero valores em claro.
5. `rotate-keys` → tudo em `v2`, execuções funcionando antes e depois.
6. `PATCH` só com `name` preserva a chave.
7. Teste de sentinela em endpoints, spans, logs e collection: nenhuma ocorrência.
8. Teste de arquitetura: `decrypt(` só aparece nos arquivos permitidos.
