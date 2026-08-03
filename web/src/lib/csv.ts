const FORMULA_PREFIX = /^[=+\-@]/;

export function safeCsvCell(value: unknown): string {
    let text = value == null ? "" : value instanceof Date ? value.toISOString() : String(value);
    if (FORMULA_PREFIX.test(text.trimStart())) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
}

export function buildClientCsv(
    headers: string[],
    rows: unknown[][],
    metadata: Record<string, unknown> = {},
): string {
    const lines: string[] = [];
    Object.entries(metadata).forEach(([key, value]) => {
        lines.push([safeCsvCell(`# ${key}`), safeCsvCell(value)].join(","));
    });
    if (Object.keys(metadata).length) lines.push("");
    lines.push(headers.map(safeCsvCell).join(","));
    rows.forEach((row) => lines.push(row.map(safeCsvCell).join(",")));
    return `\uFEFF${lines.join("\r\n")}`;
}

export function downloadClientCsv(
    filename: string,
    headers: string[],
    rows: unknown[][],
    metadata: Record<string, unknown> = {},
) {
    const blob = new Blob([buildClientCsv(headers, rows, metadata)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
}
