/**
 * Leitura tolerante de JSON vindo de LLM local: modelos pequenos costumam
 * embrulhar a resposta em markdown, deixar vírgula sobrando ou misturar o
 * raciocínio (<think>) com o payload.
 */

export function stripReasoning(content: string): string {
  let text = content || "";
  const lastClose = text.lastIndexOf("</think>");
  if (lastClose >= 0) text = text.slice(lastClose + "</think>".length);
  return text.replace(/<\/?think>/gi, "").trim();
}

export function stripFences(content: string): string {
  const fence = content.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  return fence ? fence[1].trim() : content;
}

export function tryParseJson(slice: string): unknown | null {
  try {
    return JSON.parse(slice);
  } catch {
    // tolera vírgula sobrando antes de } ou ]
    try {
      return JSON.parse(slice.replace(/,\s*([}\]])/g, "$1"));
    } catch {
      return null;
    }
  }
}

/**
 * Varre o texto procurando o primeiro objeto/array JSON balanceado que passe
 * no teste de forma — evita casar com um exemplo citado antes da resposta real.
 */
export function extractJsonPayload(
  text: string,
  isExpectedShape: (parsed: unknown) => boolean
): unknown | null {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{" && text[i] !== "[") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = i; j < text.length; j++) {
      const char = text[j];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === "{" || char === "[") depth += 1;
      else if (char === "}" || char === "]") {
        depth -= 1;
        if (depth === 0) {
          const parsed = tryParseJson(text.slice(i, j + 1));
          if (parsed !== null && isExpectedShape(parsed)) return parsed;
          break;
        }
      }
    }
  }
  return null;
}

/** Limpa a resposta e extrai o payload esperado numa tacada só. */
export function readLlmJson(
  content: string,
  isExpectedShape: (parsed: unknown) => boolean
): unknown | null {
  const text = stripFences(stripReasoning(content || ""));
  if (!text.trim()) return null;
  return extractJsonPayload(text, isExpectedShape);
}
