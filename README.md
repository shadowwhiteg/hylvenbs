# hylvenbs.xyz

Página estática "Em desenvolvimento" para https://hylvenbs.xyz/

Sem build, sem dependências: HTML + CSS + uma imagem.

## Estrutura

```
index.html      marcação, canonical e Open Graph
style.css       layout, tipografia e animações
assets/fundo.jpg
.htaccess       redirect http→https e www→raiz (somente Apache)
robots.txt
sitemap.xml
CNAME           domínio customizado do GitHub Pages
```

## Rodar localmente

```bash
python3 -m http.server 8777
```

Depois abra http://localhost:8777

## Publicar

**Servidor próprio (Apache):** copie tudo para a raiz do site. O `.htaccess` cuida
do HTTPS e do domínio canônico. Emita o certificado com Let's Encrypt/Certbot.

**Nginx:** o `.htaccess` é ignorado; as mesmas regras precisam ir para o
`server {}` do Nginx.

**GitHub Pages:** Settings → Pages → branch `main` / root. O arquivo `CNAME`
já aponta para `hylvenbs.xyz`; falta criar o registro DNS na Hostinger e
marcar "Enforce HTTPS".
