# Design 001 · Autenticação, cadastro por administrador e RBAC

**Cobre:** RQ-AUTH-01 … RQ-AUTH-14, RQ-NFR-05
**Depende de:** nada · **Bloqueia:** autoria em 002, `triggeredBy` em 004, auditoria de 005

## Decisões

| # | Decisão | Motivo |
| --- | --- | --- |
| D1 | Sessão opaca em banco + cookie `httpOnly` | Revogação imediata (RQ-AUTH-10). JWT exigiria lista de revogação — a mesma tabela, com mais complexidade. |
| D2 | `scrypt` do `node:crypto` | Sem dependência nativa (T1/RQ-NFR-04). `argon2`/`bcrypt` exigem build nativo, atrito no self-host. |
| D3 | Workspace único compartilhado + RBAC | O produto é uma plataforma de time sobre um catálogo comum de provedores e servidores MCP. Isolamento por usuário fragmentaria esse catálogo sem pedido real. |
| D4 | Token de API portador do papel do dono | A automação (Postman/CI) precisa das mesmas permissões da pessoa, sem um segundo modelo de permissão. |
| D5 | Negar por omissão, com mapa explícito rota→permissão | Endpoint novo sem entrada no mapa fica inacessível a não-admin em vez de aberto (RQ-AUTH-07). |
| D6 | Verificação em duas camadas: middleware + guarda por rota | O middleware do Next não acessa o banco; ele só valida presença/forma do cookie. A decisão real acontece no handler, com o usuário carregado. |

## Modelo de sessão

```
POST /api/auth/login  { email, password }
  → valida bloqueio  → verifica scrypt (timingSafeEqual)  → cria Session
  → Set-Cookie: sid=<token>; HttpOnly; SameSite=Lax; Path=/; Max-Age=…; Secure(se HTTPS)
```

- O token é 32 bytes aleatórios em base64url. O banco guarda **apenas** `sha256(token)`.
- Validade de 7 dias, renovada por deslize quando faltar menos de 1 dia (`lastSeenAt`).
- Logout revoga a sessão (`revokedAt`), não só apaga o cookie.
- Desativar usuário revoga sessões e tokens em uma transação (RQ-AUTH-11).

**Hash de senha** — `scrypt(N=2^15, r=8, p=1, dkLen=64)`, sal de 16 bytes por usuário,
formato `scrypt$N=32768,r=8,p=1$<sal>$<hash>`. Os parâmetros ficam gravados na própria
string para permitir aumentar o custo no futuro sem invalidar senhas antigas.

**Bloqueio (RQ-AUTH-12)** — `failedLoginCount` incrementa a cada falha; ao chegar a 5,
`lockedUntil = agora + 15min`. Login bem-sucedido zera o contador. A resposta de falha é
sempre genérica (`credenciais inválidas`) e leva o mesmo tempo com e-mail inexistente —
hash simulado para não vazar existência de conta.

## Tokens de API

```
POST /api/tokens { name, expiresAt? }
  → gera "oaa_<24 bytes base64url>"  → devolve o token UMA vez  → grava sha256 + prefix
```

Autenticação por `Authorization: Bearer oaa_…`. `lastUsedAt` é atualizado no máximo uma
vez por minuto por token, para não transformar cada requisição em escrita.

Cookie e token são mutuamente exclusivos na mesma requisição; havendo os dois, o
`Authorization` vence.

## Matriz de permissões

Permissões são verbos sobre recursos. Cada rota declara a que exige.

| Permissão | admin | editor | viewer |
| --- | :-: | :-: | :-: |
| `user.manage` (CRUD de usuários, reset de senha) | ✓ | — | — |
| `audit.read` | ✓ | — | — |
| `settings.manage` (retenção, concorrência, preços) | ✓ | — | — |
| `provider.write` / `secret.write` (chaves, env, headers) | ✓ | — | — |
| `provider.read` | ✓ | ✓ | ✓ |
| `mcp.write` (criar/editar/excluir servidor) | ✓ | ✓ | — |
| `mcp.probe` (testar conexão) | ✓ | ✓ | — |
| `agent.write` / `flow.write` | ✓ | ✓ | — |
| `flow.publish` / `flow.rollback` | ✓ | ✓ | — |
| `run.create` / `run.cancel` | ✓ | ✓ | — |
| `agent.read` / `flow.read` / `run.read` / `trace.read` | ✓ | ✓ | ✓ |
| `token.self` (emitir token próprio) | ✓ | ✓ | ✓ |

Notas de fronteira:
- `mcp.write` é de `editor` porque cadastrar servidor é trabalho de construção do fluxo —
  mas o **valor** de `env`/`headers` é segredo e cai em `secret.write` (só `admin`).
  Um `editor` cria o servidor declarando os **nomes** das variáveis; o `admin` preenche
  os valores. Isso mantém RQ-SEC-07 sem travar o dia a dia.
- `run.create` é escrita porque gasta dinheiro e aciona sistemas externos (RQ-AUTH-08).

Implementação:

```ts
// src/lib/auth/permissions.ts
export const ROUTE_PERMISSIONS: Record<string, Permission> = {
  "POST /api/runs": "run.create",
  "GET  /api/runs": "run.read",
  // …uma entrada por rota do api-registry
};
// Rota ausente do mapa → exige "admin". Teste garante cobertura total do registry.
```

## Fluxo de bootstrap (RQ-AUTH-05)

```
zero usuários ─┬─ npm run create-admin           (interativo, sempre disponível)
               └─ GET /setup → POST /api/setup   (só enquanto count(User) == 0)
```

`POST /api/setup` executa dentro de uma transação com re-checagem de `count == 0`, para
não haver corrida entre duas requisições simultâneas. Depois do primeiro usuário, ambas
as rotas passam a responder 404 (não 403 — não revelam a existência do recurso).

## Contratos de API

| Método | Rota | Permissão | Notas |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | pública | 200 + cookie · 401 · 429 (bloqueio) |
| POST | `/api/auth/logout` | autenticado | revoga a sessão |
| GET | `/api/auth/me` | autenticado | usuário, papel, permissões efetivas |
| POST | `/api/auth/change-password` | autenticado | exige senha atual; limpa `mustChangePassword` |
| GET/POST | `/api/users` | `user.manage` | POST devolve a senha temporária uma vez |
| PATCH/DELETE | `/api/users/:id` | `user.manage` | DELETE = desativar (lógico) |
| POST | `/api/users/:id/reset-password` | `user.manage` | nova senha temporária |
| GET/POST | `/api/tokens` | `token.self` | lista só os próprios; `admin` vê todos |
| DELETE | `/api/tokens/:id` | `token.self` | revoga |
| GET | `/api/audit` | `audit.read` | filtros por autor, ação, período |
| GET/POST | `/api/setup` | pública **enquanto** não há usuários | 404 depois |

Erros seguem `{ error, code }` com códigos estáveis: `unauthorized`, `forbidden`,
`password_change_required`, `account_locked`, `account_disabled`.

## Impacto na aplicação existente

- **Middleware** (`src/middleware.ts`): redireciona página sem cookie para `/login`;
  responde 401 JSON para `/api/*`. Não consulta o banco.
- **Guarda por handler** (`src/lib/auth/guard.ts`): `requireUser(req, permission)`
  resolve sessão/token, verifica papel, `mustChangePassword` e status, e devolve o autor
  para preencher `createdById`/`triggeredById`.
- **Postman (RQ-NFR-05)**: a collection ganha `auth: { type: "bearer", bearer: "{{apiToken}}" }`
  no nível raiz e a variável `apiToken`; as rotas de auth entram no `api-registry`.
- **UI**: `/login`, `/setup`, `/admin/usuarios`, `/conta/tokens`; a sidebar exibe o
  usuário e esconde ações sem permissão — o backend continua sendo a autoridade.

## Alternativas rejeitadas

- **NextAuth/Auth.js** — traz provedores OAuth e um modelo de conta que não usaremos, e
  o requisito é explicitamente "sem auto-cadastro". Custo maior que o benefício.
- **JWT sem estado** — impede revogação imediata (RQ-AUTH-10) e obrigaria tokens curtos
  com refresh, mais peças para o mesmo resultado.
- **Basic auth por variável de ambiente** — não atende cadastro por administrador,
  papéis nem auditoria.
- **Isolamento total por usuário (multi-tenant)** — duplicaria provedores e servidores
  MCP por pessoa; ninguém pediu isolamento, e ele pode ser acrescentado depois com uma
  coluna `workspaceId` sem refazer este design.

## Plano de verificação

1. Tabela de testes (papel × rota) gerada a partir do `api-registry` — falha se alguma
   rota não estiver no mapa de permissões.
2. Login: sucesso, senha errada, conta desativada, conta bloqueada, tempo constante para
   e-mail inexistente.
3. Bootstrap: com banco vazio, com usuário existente, e duas requisições simultâneas.
4. Revogação: token revogado e sessão encerrada recusados na requisição seguinte.
5. Collection do Postman importada e executada ponta a ponta só com `apiToken`.
