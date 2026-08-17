/**
 * Sem dependências de Node/Prisma de propósito — importado pelo middleware,
 * que roda no Edge Runtime e não pode carregar node:crypto/@prisma/client.
 */
export const SESSION_COOKIE_NAME = "sid";
