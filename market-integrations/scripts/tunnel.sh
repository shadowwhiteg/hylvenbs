#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/bin/cloudflared"
PORT="${TUNNEL_PORT:-3000}"
URL="http://127.0.0.1:${PORT}"
URL_FILE="$ROOT/.tunnel-url"
STATUS_FILE="$ROOT/.tunnel-status"
LOCK_FILE="$ROOT/.tunnel-${PORT}.lock"

# Garante um único cloudflared por porta: o servidor dev já sobe o túnel
# automaticamente (instrumentation.ts -> startTunnelIfNeeded). Sem este lock,
# uma segunda chamada manual (ex.: `npm run tunnel`) criaria um túnel
# duplicado com URL pública diferente do que o app está anunciando.
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Já existe um túnel rodando para a porta ${PORT} (lock: $LOCK_FILE)."
  echo "URL atual:"
  cat "$URL_FILE" 2>/dev/null || echo "  (ainda não disponível, veja $STATUS_FILE)"
  exit 0
fi

write_status() {
  local st="$1"
  local err="${2:-}"
  printf '{"status":"%s","error":%s,"updatedAt":"%s"}\n' \
    "$st" \
    "$(if [[ -n "$err" ]]; then printf '"%s"' "${err//\"/\\\"}"; else echo null; fi)" \
    "$(date -Iseconds 2>/dev/null || date)" > "$STATUS_FILE"
}

download_cloudflared() {
  mkdir -p "$ROOT/bin"
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64) ASSET="cloudflared-linux-amd64" ;;
    aarch64|arm64) ASSET="cloudflared-linux-arm64" ;;
    *)
      echo "Arquitetura não suportada para download automático: $ARCH"
      echo "Instale cloudflared manualmente (ex.: pacman -S cloudflared) e rode npm run tunnel"
      exit 1
      ;;
  esac
  echo "Baixando cloudflared ($ASSET)..."
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/${ASSET}" -o "$BIN"
  chmod +x "$BIN"
}

resolve_bin() {
  if [[ -x "$BIN" ]]; then
    echo "$BIN"
    return
  fi
  if command -v cloudflared >/dev/null 2>&1; then
    command -v cloudflared
    return
  fi
  download_cloudflared
  echo "$BIN"
}

# Parse trycloudflare URL from cloudflared output and persist for the Web UI.
capture_and_run() {
  local cf_bin="$1"
  rm -f "$URL_FILE"
  write_status "starting"
  set +e
  stdbuf -oL -eL "$cf_bin" tunnel --url "$URL" 2>&1 | while IFS= read -r line || [[ -n "$line" ]]; do
    printf '%s\n' "$line"
    if [[ "$line" =~ https://[a-zA-Z0-9-]+\.trycloudflare\.com ]]; then
      printf '%s\n' "${BASH_REMATCH[0]}" > "$URL_FILE"
      write_status "up"
      printf '\n  \033[36m- Tunnel:\033[0m      \033[4m%s\033[0m\n\n' "${BASH_REMATCH[0]}"
    fi
  done
  local code="${PIPESTATUS[0]:-0}"
  if [[ "$code" -ne 0 ]]; then
    write_status "error" "cloudflared exit $code"
  else
    write_status "stopped"
  fi
  exit "$code"
}

CF="$(resolve_bin)"
echo "Túnel → $URL (URL pública será gravada em .tunnel-url)"
capture_and_run "$CF"
