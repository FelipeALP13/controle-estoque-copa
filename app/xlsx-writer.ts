// Gerador mínimo de .xlsx (abre no Excel e no Google Planilhas), sem bibliotecas.
// Cada aba tem cabeçalho em negrito fixo no topo, filtro nas colunas e larguras definidas.
// Os arquivos vão "armazenados" no ZIP (sem compactação): mais simples e suficiente para relatórios.

export type CellValue = string | number | null | undefined;
export type ColumnType = "text" | "number" | "date" | "percent";
export type Column = { header: string; width?: number; type?: ColumnType };
export type SheetData = { name: string; columns: Column[]; rows: CellValue[][] };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStored(files: [string, string][]) {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = encoder.encode(content);
    const nameBytes = encoder.encode(name);
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, 0, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    const header = new Uint8Array(46 + nameBytes.length);
    const hv = new DataView(header.buffer);
    hv.setUint32(0, 0x02014b50, true); hv.setUint16(4, 20, true); hv.setUint16(6, 20, true); hv.setUint16(8, 0x0800, true); hv.setUint16(10, 0, true);
    hv.setUint32(16, crc, true); hv.setUint32(20, data.length, true); hv.setUint32(24, data.length, true); hv.setUint16(28, nameBytes.length, true); hv.setUint32(42, offset, true);
    header.set(nameBytes, 46);
    parts.push(local, data);
    central.push(header);
    offset += local.length + data.length;
  }
  const centralSize = central.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + 22);
  let cursor = 0;
  for (const part of [...parts, ...central, end]) { out.set(part, cursor); cursor += part.length; }
  return out;
}

/** Texto seguro para XML: escapa símbolos e remove caracteres de controle que o Excel recusa. */
export function xmlText(value: string) {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function columnLetter(index: number) {
  let letters = "";
  let n = index + 1;
  while (n > 0) { const rest = (n - 1) % 26; letters = String.fromCharCode(65 + rest) + letters; n = Math.floor((n - 1) / 26); }
  return letters;
}

/** "2026-11-11" → número de série do Excel. Datas inválidas viram null. */
export function excelDate(isoDate: string) {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(time) ? null : time / 86400000 + 25569;
}

/** Nome de aba válido: até 31 caracteres, sem : \ / ? * [ ] e sem repetir. */
export function safeSheetName(name: string, used: Set<string>) {
  let base = name.replace(/[:\\/?*[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Planilha";
  let candidate = base;
  for (let n = 2; used.has(candidate.toLowerCase()); n += 1) { const suffix = ` (${n})`; candidate = base.slice(0, 31 - suffix.length) + suffix; }
  used.add(candidate.toLowerCase());
  return candidate;
}

// Estilos: 0 normal, 1 cabeçalho, 2 data, 3 número, 4 percentual.
const STYLE: Record<ColumnType, number> = { text: 0, date: 2, number: 3, percent: 4 };

function sheetXml(sheet: SheetData) {
  const lastColumn = columnLetter(Math.max(sheet.columns.length - 1, 0));
  const lastRow = sheet.rows.length + 1;
  const header = !sheet.columns.length ? "" : `<row r="1">${sheet.columns.map((column, c) => `<c r="${columnLetter(c)}1" t="inlineStr" s="1"><is><t>${xmlText(column.header)}</t></is></c>`).join("")}</row>`;
  const rows = sheet.rows.map((row, r) => {
    const cells = sheet.columns.map((column, c) => {
      const value = row[c];
      if (value === null || value === undefined || value === "") return "";
      const ref = `${columnLetter(c)}${r + 2}`;
      const type = column.type ?? "text";
      if (type === "date" && typeof value === "string") {
        const serial = excelDate(value);
        return serial === null ? `<c r="${ref}" t="inlineStr"><is><t>${xmlText(value)}</t></is></c>` : `<c r="${ref}" s="${STYLE.date}"><v>${serial}</v></c>`;
      }
      if ((type === "number" || type === "percent") && typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}" s="${STYLE[type]}"><v>${value}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlText(String(value))}</t></is></c>`;
    }).join("");
    return `<row r="${r + 2}">${cells}</row>`;
  }).join("");
  const cols = sheet.columns.map((column, c) => `<col min="${c + 1}" max="${c + 1}" width="${column.width ?? Math.min(60, Math.max(10, column.header.length + 2))}" customWidth="1"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
    + `<dimension ref="A1:${lastColumn}${lastRow}"/>`
    + `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    + `<sheetFormatPr defaultRowHeight="15"/>`
    + (cols ? `<cols>${cols}</cols>` : "")
    + `<sheetData>${header}${rows}</sheetData>`
    + (sheet.columns.length ? `<autoFilter ref="A1:${lastColumn}${lastRow}"/>` : "")
    + `</worksheet>`;
}

// O Excel guarda a área do filtro de cada aba como um nome oculto.
function filterNames(sheets: SheetData[]) {
  const names = sheets.map((sheet, index) => sheet.columns.length
    ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${index}" hidden="1">'${xmlText(sheet.name.replace(/'/g, "''"))}'!$A$1:$${columnLetter(sheet.columns.length - 1)}$${sheet.rows.length + 1}</definedName>`
    : "").join("");
  return names ? `<definedNames>${names}</definedNames>` : "";
}

/** Monta o arquivo .xlsx com as abas informadas. */
export function buildXlsx(sheets: SheetData[]) {
  const used = new Set<string>();
  const named = sheets.map((sheet) => ({ ...sheet, name: safeSheetName(sheet.name, used) }));
  const files: [string, string][] = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${named.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${named.map((sheet, i) => `<sheet name="${xmlText(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>${filterNames(named)}</workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${named.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF172A46"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
    ...named.map((sheet, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheet)] as [string, string]),
  ];
  return zipStored(files);
}

/** Baixa o arquivo no navegador. */
export function downloadXlsx(fileName: string, sheets: SheetData[]) {
  const blob = new Blob([buildXlsx(sheets) as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
