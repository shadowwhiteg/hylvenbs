# Feature: Mercado Livre OAuth

## Objective

Conectar a conta do vendedor via OAuth e manter access/refresh tokens válidos para publicação.

## Requirements

1. Fluxo Authorization Code com `ML_APP_ID`, `ML_CLIENT_SECRET`, `ML_REDIRECT_URI`.
2. Persistir tokens em `MlToken` (accessToken, refreshToken, expiresAt, userId).
3. Refresh automático quando `expiresAt` estiver próximo (< 5 min).
4. UI em Config: botão "Conectar Mercado Livre" + status conectado/desconectado.
5. Rotas: `GET /api/auth/ml` (redirect) e `GET /api/auth/ml/callback`.

## Internal API

- `GET /api/auth/ml` → redirect to ML authorize URL
- `GET /api/auth/ml/callback?code=` → exchange + store + redirect `/settings`
- `GET /api/auth/ml/status` → `{ connected: boolean, userId?: string }`

## Acceptance criteria

- [ ] Callback com code válido salva tokens
- [ ] Client HTTP renova token expirado antes de chamar `/items`
- [ ] Status endpoint reflete conexão real no DB

## Errors

- Code inválido → redirect settings com `?error=oauth`
- Refresh falhou → marcar desconectado; publish retorna erro claro
