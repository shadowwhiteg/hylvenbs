import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";

export function ok(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(message: string, status = 400, code?: string) {
  return NextResponse.json({ error: message, ...(code ? { code } : {}) }, { status });
}

/** Valida o corpo JSON; devolve `{ error }` pronto para retorno quando inválido. */
export async function parseBody<S extends ZodType>(
  request: Request,
  schema: S,
): Promise<{ data: S["_output"]; error: null } | { data: null; error: NextResponse }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { data: null, error: fail("Corpo JSON inválido") };
  }

  try {
    return { data: schema.parse(raw), error: null };
  } catch (err) {
    const issues =
      err instanceof ZodError
        ? err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ")
        : String(err);
    return { data: null, error: fail(issues, 422) };
  }
}

export function handleError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return fail(message, 500);
}
