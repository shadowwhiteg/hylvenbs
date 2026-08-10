#!/usr/bin/env bash
# Deploy do hylvenbs.xyz na VPS. Rode no servidor, como root ou via sudo:
#   sudo bash deploy/deploy.sh
#
# Idempotente: pode rodar a cada atualização.

set -euo pipefail

REPO_DIR="${REPO_DIR:-/var/www/hylvenbs}"
APP_DIR="$REPO_DIR/market-integrations"
DATA_DIR="${DATA_DIR:-/var/lib/market-integrations}"
ENV_FILE="${ENV_FILE:-/etc/market-integrations.env}"
SERVICE="market-integrations"
OWNER="${OWNER:-www-data}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERRO: $ENV_FILE não existe." >&2
  echo "Copie deploy/market-integrations.env.example, preencha e proteja com chmod 600." >&2
  exit 1
fi

echo "==> Atualizando código em $REPO_DIR"
git -C "$REPO_DIR" pull --ff-only

echo "==> Garantindo diretório de dados em $DATA_DIR"
install -d -o "$OWNER" -g "$OWNER" -m 750 "$DATA_DIR"

echo "==> Instalando dependências"
cd "$APP_DIR"
npm ci --omit=dev --ignore-scripts
npx prisma generate

echo "==> Aplicando schema no SQLite"
# db push é seguro para rodar repetidamente; não apaga dados existentes.
set -a; . "$ENV_FILE"; set +a
npx prisma db push --skip-generate

echo "==> Build de produção"
# As dependências de build são necessárias aqui; reinstalamos completas e
# podamos depois para manter o runtime enxuto.
npm ci --ignore-scripts
npx prisma generate
npm run build
npm prune --omit=dev

echo "==> Ajustando permissões"
chown -R "$OWNER:$OWNER" "$APP_DIR/.next" "$DATA_DIR"

echo "==> Reiniciando serviço"
systemctl restart "$SERVICE"
sleep 3
systemctl --no-pager --lines=15 status "$SERVICE"

echo
echo "==> Checagem rápida"
curl -fsS -o /dev/null -w "localhost:3000/market-integrations -> %{http_code}\n" \
  http://127.0.0.1:3000/market-integrations || {
    echo "App não respondeu. Veja: journalctl -u $SERVICE -n 50" >&2
    exit 1
  }

echo "Deploy concluído."
