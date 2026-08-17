"use client";

/** Exportação de grafo (SVG/PNG) e log (JSON/texto) — RQ-VIS-12, P2. */

function download(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Resolve as variáveis CSS (--accent etc.) em cores concretas para o SVG abrir fora da aplicação. */
function inlineComputedStyles(svg: SVGSVGElement): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const originalNodes = [svg, ...Array.from(svg.querySelectorAll("*"))];
  const cloneNodes = [clone, ...Array.from(clone.querySelectorAll("*"))];

  originalNodes.forEach((original, i) => {
    const computed = getComputedStyle(original as Element);
    const target = cloneNodes[i] as SVGElement | undefined;
    if (!target) return;
    for (const prop of ["fill", "stroke", "color", "background-color"]) {
      const value = computed.getPropertyValue(prop);
      if (value) target.style.setProperty(prop, value);
    }
  });

  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return clone;
}

export function exportSvg(svg: SVGSVGElement, filename = "fluxo.svg") {
  const resolved = inlineComputedStyles(svg);
  const serialized = new XMLSerializer().serializeToString(resolved);
  download(filename, new Blob([serialized], { type: "image/svg+xml" }));
}

export async function exportPng(svg: SVGSVGElement, filename = "fluxo.png") {
  const resolved = inlineComputedStyles(svg);
  const serialized = new XMLSerializer().serializeToString(resolved);
  const svgBlob = new Blob([serialized], { type: "image/svg+xml" });
  const url = URL.createObjectURL(svgBlob);

  const img = new Image();
  const box = svg.viewBox.baseVal;
  const scale = 2;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = url;
  });

  const canvas = document.createElement("canvas");
  canvas.width = box.width * scale;
  canvas.height = box.height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(url);

  canvas.toBlob((blob) => {
    if (blob) download(filename, blob);
  }, "image/png");
}

export function exportLogsJson(logs: unknown[], filename = "log.json") {
  download(filename, new Blob([JSON.stringify(logs, null, 2)], { type: "application/json" }));
}

export function exportLogsText(lines: string[], filename = "log.txt") {
  download(filename, new Blob([lines.join("\n")], { type: "text/plain" }));
}
