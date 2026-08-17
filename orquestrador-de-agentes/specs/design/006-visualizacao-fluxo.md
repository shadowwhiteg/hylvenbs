# Design 006 · Visualização gráfica do fluxo com log de erros

**Cobre:** RQ-VIS-01 … RQ-VIS-12, RQ-NFR-02
**Depende de:** 002 (snapshot), 003 (spans e logs), 004 (SSE)

## O problema

A topologia do fluxo só existe como caixas de seleção na tela de edição. Não há como ver
o desenho, nem acompanhar por onde a execução passou, nem descobrir rapidamente **onde**
falhou — hoje isso exige ler a lista de passos de cima a baixo.

## Decisões

| # | Decisão | Motivo |
| --- | --- | --- |
| D1 | SVG próprio com layout em camadas | O grafo é um DAG raso (profundidade ≤ 3, dezenas de nós). Layout determinístico cabe em ~150 linhas e evita dependência de canvas (T1/RQ-NFR-04). |
| D2 | Layout puro e determinístico | Mesma topologia, mesmo desenho (RQ-VIS-02). Simulação de força daria posições diferentes a cada render. |
| D3 | Grafo e log na mesma tela, sincronizados | O valor está na correlação: ver o nó vermelho e o erro correspondente sem trocar de página (RQ-VIS-05/06). |
| D4 | Uma fonte de dados para os dois modos | *Edição* lê o snapshot/rascunho; *execução* sobrepõe os spans a esse mesmo grafo. Um só renderizador. |
| D5 | Grafo é visualização, não editor | Editar por canvas é outro produto; a edição continua nos formulários, que já funcionam. |
| D6 | Log virtualizado por janela | 5.000 linhas em DOM travam a interface (RQ-NFR-02). |

## Fonte de dados

```
GET /api/flows/:id/graph?version=<n|current|draft>   → topologia
GET /api/runs/:id/graph                              → topologia (do snapshot da run)
                                                        + agregados por nó e aresta
GET /api/runs/:id/events (SSE, do design 004)        → atualização ao vivo
```

O grafo de uma execução vem do **snapshot que rodou** (RQ-VIS-08), nunca da configuração
atual — abrir uma run de três versões atrás desenha a topologia daquela época.

```jsonc
{
  "nodes": [
    { "id": "agt_a1", "type": "orchestrator", "label": "Coordenador",
      "model": "claude-opus-4-8", "provider": "anthropic" },
    { "id": "agt_b2", "type": "subagent",  "label": "Pesquisador", "model": "claude-sonnet-5" },
    { "id": "mcp_1",  "type": "mcpServer", "label": "filesystem", "toolCount": 14 }
  ],
  "edges": [
    { "id": "e1", "from": "agt_a1", "to": "agt_b2", "kind": "delegate" },
    { "id": "e2", "from": "agt_b2", "to": "mcp_1",  "kind": "tool" }
  ],
  "runtime": {                                  // só em /api/runs/:id/graph
    "nodes": { "agt_b2": { "state": "error", "calls": 1, "durationMs": 812,
                           "inputTokens": 55, "outputTokens": 11,
                           "errorType": "mcp_connection_error", "errorCount": 1 } },
    "edges": { "e1": { "calls": 2 } }
  }
}
```

## Algoritmo de layout (RQ-VIS-01, RQ-VIS-02)

`src/lib/graph/layout.ts` — função pura, sem estado, testável isoladamente.

1. **Camadas.** BFS a partir da raiz: `layer(agente) = distância em arestas de delegação`.
   Servidor MCP entra em `max(layer dos agentes que o usam) + 1`.
2. **Ordem inicial** dentro da camada: ordem de descoberta no BFS — determinística porque
   `edges` vem ordenada do snapshot.
3. **Redução de cruzamentos:** duas passadas de baricentro (uma para frente, uma para
   trás). Empate resolvido pelo id do nó — nunca por posição anterior, para o resultado
   não depender do histórico de renderização.
4. **Coordenadas.** Nó 200×72; espaçamento 96 px horizontal, 24 px vertical. Camada
   centralizada verticalmente em relação à mais alta.
5. **Arestas.** Bézier cúbica da borda direita da origem à borda esquerda do destino.
   Aresta que volta para uma camada anterior (ciclo de delegação) é desenhada como arco
   por cima, tracejada.

Complexidade linear no número de arestas; para 50 nós roda em menos de 1 ms — o custo
está no DOM, não no cálculo.

**Interação (RQ-VIS-09).** Zoom e deslocamento por manipulação do `viewBox` (roda = zoom
no ponto do cursor, arrastar = pan, `Ajustar` = enquadra a caixa envolvente com margem).
Sem re-layout durante a interação: só a matriz de visualização muda.

## Estados dos nós (RQ-VIS-03, RQ-VIS-04)

| Estado | Origem | Aparência |
| --- | --- | --- |
| `ocioso` | sem span | borda neutra |
| `executando` | `span.start` do nó | borda de destaque + pulso |
| `concluído` | `span.end` com `ok` | borda de sucesso + ✓ |
| `falhou` | `span.end` com `error` | borda de erro + ⚠ + rótulo do `errorType` |
| `cancelado` | run cancelada com span aberto | borda tênue + ⊘ |

O reducer do cliente aplica os eventos SSE em ordem de `seq`; o mesmo reducer processa o
histórico ao abrir uma run concluída — um caminho só, sem divergência entre "ao vivo" e
"depois" (D4). Latência alvo: menos de 1 s entre o evento e a mudança visual.

Estado de erro **nunca** é comunicado só por cor (RQ-VIS-11): sempre acompanha ícone e
texto da categoria. Um clique no nó abre o painel lateral com mensagem, argumentos
enviados, tentativa e link para o span (RQ-VIS-04).

## Painel de log (RQ-VIS-05)

- Colunas: instante · nível · origem (agente/tool) · mensagem, com linha expansível
  mostrando o `payload` mascarado.
- Filtros: nível (multi), nó selecionado, texto livre; contadores por nível no cabeçalho.
- **Seguir execução**: rolagem automática ligada por padrão, desligada quando o usuário
  rola para cima e religada pelo botão *Ir para o fim*.
- **Virtualização (D6/RQ-NFR-02)**: altura fixa por linha (28 px), renderiza a janela
  visível mais 10 de folga, calculada a partir de `scrollTop`. Implementação própria — a
  lista é homogênea, não justifica biblioteca.
- Aba **Erros**: só as entradas `error`, agrupadas por `errorType`, cada uma com ação
  *Ver no grafo*.

## Navegação cruzada (RQ-VIS-06)

Estado compartilhado `{ selectedNodeId, selectedSpanId, levelFilter }`:
clicar em linha de log → resolve `spanId → agentId|mcpServerId` → seleciona e enquadra o
nó; clicar no nó → filtra o log por aquele nó. A seleção também destaca as arestas
incidentes.

## Acessibilidade (RQ-VIS-10)

O `<svg>` recebe `role="img"` e um `aria-label` com o resumo ("fluxo com 4 nós, 1 em
falha"). Ao lado, uma árvore equivalente (`role="tree"`) lista os mesmos nós com estado e
erro, navegável por setas, com `Enter` abrindo o detalhe — mesma informação, mesmas ações.
Foco visível em nós e linhas de log; contraste AA nos dois temas.

## Onde aparece

- **Fluxos → Grafo**: topologia da versão escolhida, com seletor de versão e diff visual
  (nós adicionados/removidos destacados ao comparar).
- **Execução**: grafo em cima, log embaixo, divisor ajustável; funciona igual para run em
  andamento e concluída.
- **Playground**: versão compacta do grafo ao lado da saída, para ver a delegação acontecer.

## Exportação (RQ-VIS-12, P2)

SVG serializado com os estilos resolvidos em atributos (para abrir fora da aplicação),
PNG via `canvas`, e log em JSON ou texto respeitando os filtros ativos.

## Alternativas rejeitadas

- **React Flow (`@xyflow/react`)** — resolveria canvas, zoom e minimapa, mas traz ~100 KB
  e um modelo de nós próprio para um grafo raso que já sabemos desenhar; e o requisito não
  inclui edição por canvas (D5). Fica como caminho de troca se a edição visual virar meta.
- **Mermaid / Graphviz (WASM)** — geram imagem estática; estado ao vivo por nó, seleção e
  navegação cruzada ficariam impossíveis (RQ-VIS-03/06).
- **d3-force** — posições diferentes a cada execução, exatamente o que o RQ-VIS-02 proíbe.
- **Canvas 2D** — mais rápido em milhares de nós, mas perde DOM, acessibilidade e teste
  simples; o teto de 50 nós não justifica.
- **Log em página separada** — destrói a correlação que motiva a funcionalidade.

## Plano de verificação

1. Fluxo com 1 orquestrador, 2 subagentes e 1 servidor MCP: 4 nós, arestas corretas, sem
   sobreposição.
2. Renderizar duas vezes: coordenadas idênticas; adicionar um subagente não embaralha os
   demais.
3. Run ao vivo: nó ativo destacado; delegação reflete no subagente em menos de 1 s.
4. Falha de tool: nó do servidor marcado com `mcp_connection_error`; clique abre detalhe
   com args e tentativa.
5. Filtro por `error` e por nó; seleção cruzada nos dois sentidos.
6. Run de versão antiga desenha a topologia daquela versão.
7. 50 nós: zoom e pan fluidos; *Ajustar* enquadra tudo.
8. Percurso completo por teclado; leitor de tela anuncia estado e erro.
9. Contraste AA nos temas claro e escuro; erro identificável em escala de cinza.
