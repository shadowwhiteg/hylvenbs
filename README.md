# hylvenbs.xyz

Site de https://hylvenbs.xyz/ — uma landing estática na raiz e o app de
integrações de marketplace em `/market-integrations`.

## Estrutura

```
index.html              landing "Em desenvolvimento" (raiz)
style.css               layout, tipografia e animações
assets/fundo.jpg
robots.txt              bloqueia /market-integrations na indexação
sitemap.xml
CNAME                   domínio customizado (legado do GitHub Pages)
.htaccess               redirects e fallback da landing (Apache)

market-integrations/    app Next.js (catálogo, Mercado Livre e Shopee)

deploy/
  deploy.sh                      script de deploy na VPS
  market-integrations.service    unit do systemd
  market-integrations.env.example modelo de /etc/market-integrations.env
  apache-hylvenbs.conf           vhost do Apache com reverse proxy
  nginx-hylvenbs.conf            alternativa em nginx
```

Landing e app rodam na **mesma VPS**: o Apache (ou nginx) serve os arquivos
estáticos da raiz e encaminha `/market-integrations` para o Next.js em
`127.0.0.1:3000`. Não há link nem menu entre eles — o app só é alcançado
digitando a URL.

O app roda como **processo único e persistente**. É isso que permite usar
SQLite e `node-cron` sem adaptação. Não replique o serviço: duas instâncias
escrevendo no mesmo arquivo SQLite corrompem o banco.

## Rodar localmente

**Landing:**

```bash
python3 -m http.server 8777
```

**App** (sem basePath, fica em `http://localhost:3000/`):

```bash
npm run dev --prefix market-integrations
```

Para reproduzir o caminho de produção localmente:

```bash
NEXT_PUBLIC_BASE_PATH=/market-integrations npm run dev --prefix market-integrations
```

## Publicar na VPS

**1. Preparar a máquina** (uma vez)

```bash
sudo apt install -y nodejs npm apache2 certbot python3-certbot-apache
sudo a2enmod proxy proxy_http headers rewrite ssl
```

**2. Código e dados**

```bash
sudo git clone https://github.com/shadowwhiteg/hylvenbs.git /var/www/hylvenbs
sudo mkdir -p /var/lib/market-integrations
sudo chown -R www-data:www-data /var/www/hylvenbs /var/lib/market-integrations
```

**3. Configuração**

```bash
sudo cp /var/www/hylvenbs/deploy/market-integrations.env.example /etc/market-integrations.env
sudo chown www-data:www-data /etc/market-integrations.env
sudo chmod 600 /etc/market-integrations.env
sudo nano /etc/market-integrations.env   # preencher os segredos
```

O SQLite fica em `/var/lib/market-integrations/prod.db`, **fora** do diretório
do deploy — assim um `git pull` ou um re-clone nunca apaga o banco.

**4. Serviço e proxy**

```bash
sudo cp /var/www/hylvenbs/deploy/market-integrations.service /etc/systemd/system/
sudo cp /var/www/hylvenbs/deploy/apache-hylvenbs.conf /etc/apache2/sites-available/hylvenbs.conf
sudo a2ensite hylvenbs
sudo systemctl daemon-reload
```

**5. Certificado e DNS**

Aponte o A/AAAA de `hylvenbs.xyz` na Hostinger para o IP da VPS, depois:

```bash
sudo certbot --apache -d hylvenbs.xyz -d www.hylvenbs.xyz
```

**6. Deploy** (e a cada atualização)

```bash
sudo bash /var/www/hylvenbs/deploy/deploy.sh
```

## Após o primeiro deploy

Cadastre os *redirect URIs*, que agora incluem o basePath:

- Mercado Livre (DevCenter) → *URIs de redirect*:
  `https://hylvenbs.xyz/market-integrations/api/auth/ml/callback`
- Mercado Livre (DevCenter) → *URL de notificações*:
  `https://hylvenbs.xyz/market-integrations/api/ml/notifications`
- Shopee (open.shopee.com) → *Redirect URL*:
  `https://hylvenbs.xyz/market-integrations/api/auth/shopee/callback`

Todas essas URLs aparecem prontas para copiar em **Configurações**.

## Notas do app

- `basePath` vem de `NEXT_PUBLIC_BASE_PATH` (ver `market-integrations/next.config.ts`).
  `<Link>` e o router aplicam o prefixo sozinhos; `fetch`, `<a href>` e
  `window.location` usam o helper `BP` de `market-integrations/lib/base-path.ts`.
- `PUBLIC_BASE_URL` define a origem pública fixa. Quando presente, substitui o
  Cloudflare Quick Tunnel: os callbacks passam a derivar do domínio e param de
  mudar a cada reinício. O túnel fica desligado com `DISABLE_TUNNEL=1`.
- O reverse proxy **precisa** enviar `X-Forwarded-Proto: https`. Sem isso o app
  monta a origem como `http://` e o cookie `secure` do OAuth se perde. As duas
  configs em `deploy/` já fazem isso.
