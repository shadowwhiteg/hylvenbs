const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  times: "×",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  eacute: "é",
  aacute: "á",
  atilde: "ã",
  ccedil: "ç",
  deg: "°",
  reg: "®",
  trade: "™",
  laquo: "«",
  raquo: "»",
  bull: "•",
};

export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      String.fromCodePoint(Number.parseInt(dec, 10))
    )
    .replace(/&([a-z]+);/gi, (match, name: string) => {
      const decoded = NAMED_ENTITIES[name.toLowerCase()];
      return decoded ?? match;
    });
}

/** Remove tags and collapse whitespace into a single line. */
export function stripTags(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** Convert an HTML fragment into readable multi-line plain text. */
export function htmlToPlainText(html: string): string {
  const withBreaks = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|tr|h[1-6])>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/(li|td|th)>/gi, "\n")
    .replace(/<[^>]+>/g, "");

  return decodeHtmlEntities(withBreaks)
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Extract the full inner HTML of the element starting at `openTagIndex`,
 * counting nested open/close tags of the same name.
 */
export function extractTagBlock(
  html: string,
  openTagIndex: number,
  tagName: string
): string {
  const openEnd = html.indexOf(">", openTagIndex);
  if (openEnd === -1) return "";
  if (html.slice(openTagIndex, openEnd).endsWith("/")) return "";

  const tagRegex = new RegExp(`<(/?)${tagName}\\b`, "gi");
  tagRegex.lastIndex = openEnd + 1;

  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(html)) !== null) {
    depth += match[1] === "/" ? -1 : 1;
    if (depth === 0) return html.slice(openEnd + 1, match.index);
  }
  return html.slice(openEnd + 1);
}

/** Find the first element matching `pattern` and return its inner HTML. */
export function findBlock(
  html: string,
  pattern: RegExp,
  tagName: string
): string | null {
  const regex = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  const match = regex.exec(html);
  if (!match) return null;
  return extractTagBlock(html, match.index, tagName);
}
