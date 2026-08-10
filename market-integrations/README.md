# ML Drop Publisher

Publicação automatizada de produtos do [Meu Drop Brasil](https://meudropbrasil.com/) no Mercado Livre, com dashboard para edição, kits, simulador de custos, sync contínuo de estoque/preço, markup em massa e agente Ollama + MCP.

## Spec Driven Development

- Design original: `docs/superpowers/specs/2026-07-26-ml-drop-publisher-design.md`
- Evolução (2026-07-31): `docs/superpowers/specs/2026-07-31-ml-drop-publisher-evolution-design.md`
- Plano evolução: `docs/superpowers/plans/2026-07-31-ml-drop-publisher-evolution.md`
- Features: `docs/superpowers/specs/features/`

## Setup

```bash
cp .env.example .env
# Preencha ML_APP_ID (e opcionalmente ML_CLIENT_SECRET — também editável na UI)
npm install
npx prisma db push
npx playwright install chromium
npm run dev
```

Ao subir (`npm run dev` ou `npm start`), o app também inicia o Cloudflare Quick Tunnel automaticamente e grava a URL em `.tunnel-url`. Em **Configurações** você vê a URL do túnel, o callback OAuth e pode colar o **Secret Key**. Se o túnel falhar, o app continua; use `npm run tunnel` manualmente para tentar novamente.

### Ollama (agente)

```bash
# Em outro terminal
ollama serve
ollama pull qwen3.5:4b   # ou o modelo definido em Configurações
```

Defaults: `http://127.0.0.1:11434` / modelo `qwen3.5:4b` (editável em **Configurações** ou via env `OLLAMA_BASE_URL` / `OLLAMA_MODEL` no primeiro upsert).

### MCP (Cursor)

```bash
npm run mcp
```

Exemplo em `~/.cursor/mcp.json` (ou config do projeto):

```json
{
  "mcpServers": {
    "ml-drop-publisher": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "/caminho/absoluto/para/Publicação de Produtos"
    }
  }
}
```

Tools: `sync_catalog`, `sync_ml_listings`, `list_products`, `apply_margin`, `get_settings`, `update_settings`, `get_status`, `queue_publish`.

### DevCenter Mercado Livre — o que preencher

#### URIs de redirect (OAuth)

> **Importante:** o WAF/CloudFront do Mercado Livre retorna **403 Request blocked** se o `redirect_uri` for `localhost`, `127.0.0.1` ou IP privado (`10.x`, `192.168.x`, etc.), mesmo em HTTP ou HTTPS. Para OAuth funcionar, use um host **público** (Cloudflare Quick Tunnel ou domínio).

Cadastre no DevCenter a URL pública que você for usar:

| Onde acessa | URI de redirect | OAuth funciona? |
|---|---|---|
| Cloudflare Quick Tunnel (**recomendado**) | `https://SUA-URL.trycloudflare.com/api/auth/ml/callback` | Sim |
| Domínio público HTTPS | `https://seu-dominio/api/auth/ml/callback` | Sim |
| IP na rede / localhost | `http://10.131.24.6:3000/...` ou `http://localhost:3000/...` | **Não** (CloudFront 403) |

#### URL de retornos de chamada de notificação
Endpoint público do app (deve responder **HTTP 200** em até 500 ms):

| Onde acessa | URL de notificação |
|---|---|
| IP na rede* | `http://10.131.24.6:3000/api/ml/notifications` |
| Cloudflare Quick Tunnel (recomendado) | `https://SUA-URL.trycloudflare.com/api/ml/notifications` |

\*O Mercado Livre exige URL **pública e acessível**. Para notificações reais, prefira HTTPS via Quick Tunnel ou domínio fixo.

**Tópicos sugeridos** (marque no DevCenter conforme sua necessidade):

- `items` — mudanças nos anúncios publicados
- `orders_v2` — vendas confirmadas (recomendado)
- `payments` — pagamentos
- `shipments` — envios
- `questions` — perguntas nos anúncios

#### Fluxos OAuth (como na imagem)

| Opção | Marcar? | Motivo |
|---|---|---|
| **Authorization Code** | Sim | Login do vendedor na dashboard |
| **Client Credentials** | Opcional | Não usado hoje; pode deixar marcado |
| **Refresh Token** | **Sim** | App renova token automaticamente |
| **PKCE** | Não | Fluxo server-side, sem PKCE |
| **Mercado Livre** | Sim | Integração de marketplace |
| **VIS** | Não | Não usado neste projeto |

#### Permissões (scopes)
Marque pelo menos **Read** e **Write** (publicar/editar anúncios) e **Offline access** (refresh token), se aparecer separado.

No `.env` (ou em **Configurações** → Secret Key):

```env
ML_APP_ID=seu_app_id
ML_CLIENT_SECRET=seu_secret
# Preferir URL pública (túnel). localhost/IP privado → CloudFront 403 no auth ML
# Com túnel automático, a UI mostra o callback atual; atualize no DevCenter quando a URL mudar.
ML_REDIRECT_URI=https://SUA-URL.trycloudflare.com/api/auth/ml/callback
```

O secret pode ser salvo pela UI: fica em `AppSettings.mlClientSecret` (prioridade) e também atualiza a linha `ML_CLIENT_SECRET=` do `.env`. A API **nunca** devolve o valor — só `hasMlClientSecret: true/false`.

### Acesso na rede / IP

O `npm run dev` e `npm start` escutam em `0.0.0.0:3000`.

- Local: [http://localhost:3000](http://localhost:3000)
- LAN (IP liberado): [http://10.131.24.6:3000](http://10.131.24.6:3000)

**Para conectar o Mercado Livre (OAuth):**

1. `npm run dev` — Next + túnel sobem juntos (aguarde a URL em Configurações)
2. Em **Configurações**, copie o **Callback para o DevCenter** e cadastre no app ML  
   (`https://….trycloudflare.com/api/auth/ml/callback`)
3. Cole o Secret Key se ainda não estiver no `.env` → **Salvar**
4. Clique em **Conectar Mercado Livre** (mesmo se abriu pelo IP da LAN: o OAuth usa o túnel como `redirect_uri`)

O app monta o `redirect_uri` pela origem da requisição; se a origem for privada (localhost/LAN) e o túnel estiver ativo, **prefere a URL do túnel**. Hosts liberados: `localhost`, `127.0.0.1`, `10.131.24.6`, `*.trycloudflare.com`.

### Cloudflare Quick Tunnel

Com `npm run dev` / `npm start`, o túnel sobe sozinho via `instrumentation.ts` (usa `scripts/tunnel.sh`). A URL pública é gravada em `.tunnel-url` e aparece em **Configurações**.

Standalone (outro terminal), se precisar:

```bash
npm run tunnel
```

O script usa `bin/cloudflared` (baixa automaticamente na primeira execução) ou o `cloudflared` do sistema (`pacman -S cloudflared`).

Quick Tunnel muda a hostname a cada execução — atualize o Redirect URI no DevCenter quando a URL mudar (ou use túnel nomeado com hostname fixo).

O auto-túnel está sempre ativo em `dev`/`start`.

Hosts liberados por padrão: `localhost`, `127.0.0.1`, `10.131.24.6`, `*.trycloudflare.com`.  
Extras via `ALLOWED_HOSTS` no `.env` (CSV).

## Uso

1. Em **Configurações**, conecte o Mercado Livre (OAuth) e escolha o modo de auto-sync.
2. No **Antigo Catálogo**, clique em **Atualizar agora** (sync a cada 60 min automaticamente; em seguida roda `MlListingSync`). O scrape combina a vitrine `/loja/` com o sitemap WordPress de produtos (`wp-sitemap-posts-product-*.xml`), porque nem todos os itens publicados aparecem na loja.
3. Edite o anúncio (vídeo, margem override), selecione em massa, aplique margem % e publique — ou crie um **kit**.
4. Em **Anúncios ML**, importe os anúncios já publicados, gerencie preço/promoções/kits pela API do ML, e publique/sincronize do catálogo pelo **Sistema One Click** (ver abaixo).
5. Em **Agente**, converse com o Ollama para sync/margem/status (mesmas tools do MCP).

### Publicar e sincronizar via One Click (Anúncios ML)

No final da página **Anúncios ML** há o painel **Publicar / sincronizar via One Click**, que usa o plugin do Meu Drop (`woo-meli-drop`) em vez da API oficial de criação de itens:

- Defina markup % sobre o custo, filtre por estoque/custo e selecione produtos do catálogo (ou use **Selecionar todos não anunciados** / **Sincronizar todos já anunciados**).
- Opcionalmente informe EAN/GTIN; o restante (título, fotos, categoria) vem do Meu Drop pelo SKU.
- Acompanhe a fila item a item e o histórico de jobs. Ao terminar, use **Atualizar agora** para importar os anúncios novos no snapshot local.
- Após sucesso, o app grava `mlItemId` no produto do catálogo.

Gestão de anúncios já no ar (promoções, pausar/reativar, revisão IA, kits, estoque) continua pela **API OAuth do Mercado Livre** nas ações do topo da mesma página.

### Kits a partir de anúncios já publicados (Anúncios ML)

Duas formas, ambas na página **Anúncios ML** — assim dá pra ver o que já está no ar e o que só falta virar kit:

- **Manual**: marque 2+ anúncios na tabela, ajuste o *desconto de combo* e clique em **Criar kit**.
- **Com IA**: clique em **✨ Sugerir kits com IA**. O agente agrupa os anúncios em combos coerentes e devolve título, justificativa, itens e desconto sugerido. As sugestões abrem num painel de revisão onde dá pra editar título e desconto (preço recalcula na hora), desmarcar o que não interessa e só então criar. Sem seleção, ele analisa todos os anúncios ativos; com anúncios marcados, restringe a análise a eles.

Em ambos os casos, **Preencher características com IA** completa os atributos (marca, condição etc.) do rascunho após criar.

Como o preço é montado:

| Campo | Origem |
|-------|--------|
| Preço | soma dos preços dos anúncios − desconto de combo (padrão 10%) |
| Custo | soma dos custos dos produtos Meu Drop vinculados (0 se o anúncio for avulso) |
| Estoque | limitado pelo item mais escasso |
| Categoria | a mais frequente entre os anúncios |
| Fotos | miniaturas dos anúncios (variante 2X) |

Se o Ollama estiver fora do ar, as sugestões caem para um agrupamento por categoria do ML — o botão nunca volta vazio.

### Filtros, revisão por IA, estoque e margem (Anúncios ML)

A página **Anúncios ML** tem filtros equivalentes aos do Catálogo (status, origem local, estoque, faixa de preço/custo, sem SKU, sem EAN, ordenação) e três automações que usam o catálogo do Meu Drop como fonte da verdade — funcionam tanto selecionando vários anúncios quanto num só:

- **Revisar com IA** (botão em massa na barra de seleção ou "Revisar" em cada linha): corrige título, características, SKU (`SELLER_SKU`) e EAN (`GTIN`) do anúncio de acordo com o produto do Meu Drop vinculado. O dado do catálogo sempre vence conflito; a IA só preenche o que nem o ML nem o catálogo já cobrem. **Categoria não é alterada** — o Mercado Livre não permite trocar `category_id` de um anúncio já publicado via API; a revisão individual mostra a categoria sugerida como aviso informativo, sem aplicar. Anúncios avulsos (sem produto vinculado) são pulados, não travam o restante.
  - Importante: o ML às vezes aceita o PUT (HTTP 200) e ignora um campo silenciosamente — por exemplo, anúncios vinculados ao catálogo oficial do ML (`user_product_id`) têm título controlado por lá, não pelo vendedor. O app confere o valor devolvido pela API antes de considerar um campo realmente aplicado, e avisa quando algo foi ignorado.
- **Atualizar estoque (Meu Drop)**: sincroniza `available_quantity` com o estoque atual do produto Meu Drop vinculado. Estoque zerado lá pausa o anúncio automaticamente; a volta do estoque só atualiza a quantidade — **nunca reativa sozinho** (pode ter sido pausado por outro motivo).
- **Margem %**: tanto em massa (barra de seleção, já existente) quanto por linha (campo "margem %" ao lado do preço) — recalcula o preço do anúncio a partir do custo do produto Meu Drop vinculado e da margem informada.

### Modos de auto-sync (`autoSyncMode`)

| Modo | Comportamento |
|------|----------------|
| `always` (default) | PUT estoque + preço recalculado |
| `stock_only` | Só estoque |
| `respect_user_edits` | Estoque sempre; preço só se não foi editado pelo usuário |
| `manual` | Sem PUT automático (use Sync ML / MCP) |

`autoPauseWhenUnavailable` (default true): pausa o anúncio no ML quando o produto fica indisponível / estoque 0.

## Scripts

- `npm run dev` — escuta em `0.0.0.0:3000` + inicia túnel Cloudflare
- `npm run start` — produção na mesma interface + túnel
- `npm run tunnel` — Cloudflare Quick Tunnel standalone → `http://127.0.0.1:3000` (grava `.tunnel-url`)
- `npm run mcp` — servidor MCP stdio (Cursor)
- `npm test` — Vitest
- `npm run db:push` — schema Prisma

## Escopo

Hubla **não** está integrado neste ciclo (webhooks só outbound; sem API pública de criação de produtos).
Multi-usuário e APIs LLM externas ficam fora do escopo da evolução 2026-07-31.
