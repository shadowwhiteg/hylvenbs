/**
 * Prefixo em que o app é servido (ver `basePath` em next.config.ts).
 *
 * O <Link> e o router do Next já aplicam o basePath sozinhos, mas `fetch`,
 * `<a href>` e `window.location` não — nesses casos use `BP` explicitamente.
 */
export const BP = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
