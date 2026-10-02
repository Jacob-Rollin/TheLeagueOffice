/** Quote-aware CSV parser returning one record per row keyed by header. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell.endsWith("\r") ? cell.slice(0, -1) : cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [head, ...body] = rows;
  if (!head) return [];
  return body
    .filter((r) => r.length === head.length)
    .map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]!])));
}

/** Numeric CSV cell; blanks and "NA" read as 0. */
export function num(v: string | undefined): number {
  if (!v || v === "NA") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
