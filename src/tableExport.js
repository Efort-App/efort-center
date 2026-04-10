function normalizeCell(value) {
  if (value === undefined || value === null) return "";
  return String(value);
}

function escapeCsvCell(value) {
  const normalized = normalizeCell(value);
  if (!/[",\n]/.test(normalized)) return normalized;
  return `"${normalized.replace(/"/g, "\"\"")}"`;
}

export function buildCsvContent(columns, rows, options = {}) {
  const metadataRows = Array.isArray(options.metadataRows) ? options.metadataRows : [];
  const header = columns.map((column) => escapeCsvCell(column.label)).join(",");
  const body = rows.map((row) => (
    columns
      .map((column) => escapeCsvCell(column.csvValue(row)))
      .join(",")
  ));
  const metadata = metadataRows
    .map((row) => row.map((cell) => escapeCsvCell(cell)).join(","));
  const lines = metadata.length > 0 ? [header, ...body, "", ...metadata] : [header, ...body];
  return lines.join("\n");
}

export function downloadCsv(filename, columns, rows, options = {}) {
  const content = buildCsvContent(columns, rows, options);
  const blob = new Blob([content], {type: "text/csv;charset=utf-8;"});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
