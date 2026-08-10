/** Textos de ajuda (? ) para filtros do catálogo. */
export const CATALOG_FILTER_HELP = {
  q: "Busca por palavras no título do fornecedor ou no SKU do produto.",
  status:
    "Estado interno do produto: sincronizado, pronto para publicar, na fila, publicado, erro ou indisponível no Meu Drop.",
  published: "Filtra produtos que já possuem um anúncio ativo no Mercado Livre (mlItemId).",
  hasVideo: "Produtos com URL de vídeo capturada no scrape (YouTube ou arquivo .mp4/.mov).",
  hasImages: "Produtos com ao menos uma imagem no rascunho ou no catálogo.",
  stock: "Estoque usado no catálogo (já com o percentual do Meu Drop aplicado).",
  sourceStock: "Estoque bruto informado pelo Meu Drop Brasil no último sync.",
  hasCatalog: "Produtos vinculados a um item do catálogo oficial do Mercado Livre.",
  freeShipping: "Rascunhos marcados com frete grátis no anúncio.",
  listingType: "Tipo de exposição no ML: Premium (gold_pro), Clássico (gold_special) ou gold.",
  priceRange: "Filtra pelo preço de venda do rascunho (não pelo custo do fornecedor).",
  costRange: "Filtra pelo custo base vindo do Meu Drop (preço de compra).",
  sort: "Campo usado para ordenar a lista de produtos.",
  dir: "Ordem crescente (menor primeiro) ou decrescente (maior primeiro).",
  missingAttributes:
    "Mostra produtos sem características preenchidas no rascunho (útil antes de publicar).",
  missingCategory: "Mostra produtos sem categoryId (ID da categoria MLB) definido no rascunho.",
  bulkMargin:
    "Aplica a mesma margem percentual aos produtos selecionados e recalcula o preço sugerido.",
  pushAfterMargin:
    "Após aplicar a margem, envia PUT de preço/estoque ao ML para itens já publicados.",
  aiTitle:
    "Gera títulos de até 60 caracteres com IA quando o título original do fornecedor é longo.",
  aiAttributes:
    "Completa características do anúncio com IA usando título, descrição e dados do scrape.",
  catalogMatch:
    "Busca no catálogo do Mercado Livre produtos equivalentes para vincular catalog_product_id.",
  aiCategory:
    "Gera o categoryId (ex.: MLB1055) do anúncio: primeiro pelo preditor oficial do ML e, se falhar, com IA.",
  priceSync:
    "Rebusca o preço de cada produto selecionado direto na página do Meu Drop Brasil e atualiza o custo (e o preço do rascunho, se ele estava abaixo do novo custo).",
  stockSync:
    "Rebusca o estoque de cada produto selecionado direto na página do Meu Drop Brasil e atualiza o estoque (já com o percentual configurado aplicado).",
} as const;

/** Textos de ajuda para Configurações. */
export const SETTINGS_HELP = {
  publicUrl:
    "Domínio fixo em que o app é servido (PUBLIC_BASE_URL). Substitui o túnel Cloudflare: os callbacks de OAuth passam a apontar para ele e não mudam mais a cada reinício.",
  tunnel:
    "URL pública HTTPS gerada pelo Cloudflare Quick Tunnel. Necessária para OAuth do Mercado Livre.",
  callback:
    "Cadastre esta URL exata (sem barra final) no DevCenter em URIs de redirect. Se o túnel mudar, atualize o DevCenter antes de reconectar.",
  notifications:
    "Cadastre esta URL no DevCenter em URL de notificações — NÃO use o callback OAuth aqui.",
  openViaTunnel:
    "Abra o app pela URL pública HTTPS (domínio próprio ou túnel) ao clicar em Conectar. IP/localhost fazem o ML falhar ou o cookie do OAuth se perder.",
  mlSecret:
    "Secret Key do app no Mercado Livre. Fica salvo só no servidor e nunca é exibido de volta.",
  margin:
    "Margem padrão usada pelo simulador para calcular o preço de venda a partir do custo.",
  catalogStockPercent:
    "Percentual do estoque do Meu Drop usado no catálogo e nos anúncios. Ex.: 25% de 30 unidades = 7 no catálogo.",
  listingType:
    "Tipo de anúncio aplicado automaticamente a novos rascunhos criados pelo sync.",
  shippingMode: "Forma de entrega padrão nos novos anúncios (recomendado: Mercado Envios).",
  warrantyType: "Tipo de garantia padrão nos anúncios (ex.: Garantia de fábrica).",
  warrantyTime: "Prazo padrão da garantia quando o fornecedor não informa outro.",
  freeShipping: "Novos rascunhos já nascem com frete grátis marcado.",
  localPickUp:
    "Se desmarcado, o anúncio indica que você não oferece retirada pessoalmente.",
  autoSyncMode:
    "Define o que é atualizado automaticamente no ML após cada sync do catálogo.",
  autoPause:
    "Quando o produto some do Meu Drop, zera estoque ou pausa o anúncio no Mercado Livre.",
  ollamaUrl: "Endereço do servidor Ollama local usado pelo agente e pelas ações de IA.",
  ollamaModel: "Modelo de linguagem usado para chat, títulos e características com IA.",
  aiProvider:
    "Provedor de IA usado por todas as funcionalidades do app (títulos, características, kits, categorização e o chat do Agente). Cursor e Claude Code rodam localmente via CLI e não suportam as ferramentas do Agente.",
  aiBaseUrl: "URL base do endpoint compatível com a API de chat da OpenAI (ex.: http://localhost:1234/v1).",
  aiModel: "Nome/ID do modelo no provedor escolhido (ex.: gpt-4o-mini, anthropic/claude-3.5-sonnet, gemini-2.0-flash).",
  aiApiKey: "API key do provedor de IA. Fica salva só no servidor e nunca é exibida de volta.",
  aiMaxTokens:
    "Limite de tokens de saída por chamada à IA (OpenAI max_tokens / Ollama num_predict). Afeta títulos, atributos, correção de publicação e o chat do Agente.",
  aiCliCommand: "Nome ou caminho do binário do CLI instalado nesta máquina.",
  aiCliArgs:
    "Argumentos extras passados ao CLI, separados por espaço (o prompt é enviado pelo stdin).",
  shopeePartnerKey:
    "Partner Key do app cadastrado em open.shopee.com. Fica salva só no servidor e nunca é exibida de volta.",
  shopeeDefaultWeightKg:
    "Peso padrão (kg) aplicado a rascunhos Shopee sem peso definido — a Shopee exige peso pra publicar.",
  shopeeDefaultDaysToShip:
    "Dias pra despachar (DTS) padrão dos rascunhos Shopee quando o produto não define um prazo próprio.",
} as const;

/** Textos de ajuda para o editor de anúncio. */
export const LISTING_HELP = {
  originalTitle:
    "Título completo vindo do Meu Drop Brasil, sem limite de caracteres. Não é enviado ao ML.",
  mlTitle:
    "Título publicado no Mercado Livre. Máximo de 60 caracteres. Use IA se o original for longo.",
  listingType: "Nível de exposição do anúncio no Mercado Livre (Premium tem mais visibilidade).",
  buyingMode: "Compra imediata (preço fixo) ou leilão.",
  condition: "Estado do produto anunciado: novo ou usado.",
  shippingMode: "Modalidade de envio integrada ao Mercado Envios ou customizada.",
  freeShipping: "Oferece frete grátis ao comprador no anúncio.",
  localPickUp:
    "Marcado = permite retirada; desmarcado = 'Não ofereço retirada pessoalmente'.",
  categoryId:
    "categoryId obrigatório para publicar no Mercado Livre (ex.: MLB1055). Use os botões para gerar automaticamente.",
  catalogProductId:
    "Vincula o anúncio a um produto do catálogo oficial do ML para padronizar ficha técnica.",
  gtin:
    "Código de barras real da embalagem (GTIN/EAN). O Mercado Livre valida o dígito verificador — não use número inventado.",
  warrantyType: "Tipo de garantia exibido no anúncio (ex.: Garantia de fábrica).",
  warrantyTime: "Prazo da garantia (ex.: 90 dias, 12 meses).",
  quantity: "Quantidade disponível para venda no Mercado Livre.",
  videoId: "ID de vídeo do YouTube aceito pela API do Mercado Livre.",
  videoUrl: "URL do vídeo do produto (referência; MP4 não vira video_id automaticamente).",
  marginOverride:
    "Margem individual deste produto; substitui a margem global do simulador.",
  shippingCost: "Custo de envio estimado usado apenas no cálculo do simulador.",
  salePrice: "Preço final do anúncio. Pode ser ajustado manualmente ou pelo simulador.",
  description: "Texto completo do anúncio enviado ao Mercado Livre na publicação.",
  pictures: "Lista JSON de URLs das imagens do anúncio (mínimo 1 para publicar).",
  attributes:
    "Características técnicas no formato JSON aceito pela API do Mercado Livre. Se incluir \"Formato de venda\": \"Kit\", o ML também exige \"Unidades por kit\" preenchido — sem isso a publicação é bloqueada.",
  variations: "Variações do produto (cor, tamanho etc.) com fotos, em JSON.",
  regulatory: "Campos regulatórios exigidos por algumas categorias, em JSON.",
  shippingJson: "Campos extras de envio mesclados ao objeto shipping do ML.",
} as const;
