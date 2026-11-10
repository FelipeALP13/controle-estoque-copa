// Leitor mínimo de .xlsx (o arquivo que o Google Planilhas gera em "Fazer download").
// Um .xlsx é um ZIP com XMLs dentro; aqui só lemos o que precisamos: nomes das abas e o texto das células.
// A descompactação vem de fora (DecompressionStream no navegador, zlib nos testes), então o código é puro.

import type { RawSheet } from "./demand-import";

export type InflateRaw = (data: Uint8Array) => Promise<Uint8Array>;

type ZipEntry = { name: string; method: number; compressedSize: number; offset: number };

function readZipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error("O arquivo não parece ser um .xlsx válido.");
  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error("O índice do .xlsx está corrompido.");
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const offset = view.getUint32(cursor + 42, true);
    entries.push({ name: decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength)), method, compressedSize, offset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function readEntry(bytes: Uint8Array, entry: ZipEntry, inflateRaw: InflateRaw) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true);
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateRaw(data);
  throw new Error(`Compactação ${entry.method} não suportada no .xlsx.`);
}

export function decodeXml(text: string) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

/** Junta o texto de todas as tags <t> (ignora a leitura fonética <rPh>). */
function textOf(xml: string) {
  return decodeXml([...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => match[1]).join(""));
}

/** Formatos de número que representam data (embutidos do Excel ou personalizados com d/m/a). */
export function isDateFormat(id: number, code: string | undefined) {
  if ((id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58)) return true;
  if (!code) return false;
  const withoutText = code.replace(/"[^"]*"/g, "").replace(/\\./g, "").toLowerCase();
  // [h] e [mm] são durações (horas acumuladas), não datas; [$-416] e [Red] são só idioma/cor.
  const hasTime = /\[(h+|m+|s+)\]/.test(withoutText) || /[hs]/.test(withoutText.replace(/\[[^\]]*\]/g, ""));
  const clean = withoutText.replace(/\[[^\]]*\]/g, "");
  return /[dy]/.test(clean) || (/m/.test(clean) && !hasTime);
}

function serialToIso(serial: number) {
  const date = new Date(Math.round((serial - 25569) * 86400000));
  return date.toISOString().slice(0, 10);
}

export function columnIndex(ref: string) {
  const letters = ref.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? "A";
  return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10000) / 10000);
}

/** Lê todas as abas do .xlsx. Datas viram AAAA-MM-DD; números, texto simples. */
export async function readXlsx(bytes: Uint8Array, inflateRaw: InflateRaw): Promise<RawSheet[]> {
  const entries = readZipEntries(bytes);
  const read = async (name: string) => {
    const entry = entries.find((item) => item.name === name);
    return entry ? new TextDecoder().decode(await readEntry(bytes, entry, inflateRaw)) : "";
  };
  const workbook = await read("xl/workbook.xml");
  if (!workbook) throw new Error("O arquivo não tem uma planilha dentro. Use Arquivo → Fazer download → Microsoft Excel (.xlsx).");
  const rels = await read("xl/_rels/workbook.xml.rels");
  const targets = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((match) => [attr(match[0], "Id") ?? "", attr(match[0], "Target") ?? ""]));

  const shared = [...(await read("xl/sharedStrings.xml")).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => textOf(match[1]));
  const styles = await read("xl/styles.xml");
  const formats = new Map([...styles.matchAll(/<numFmt\b[^>]*>/g)].map((match) => [Number(attr(match[0], "numFmtId")), decodeXml(attr(match[0], "formatCode") ?? "")]));
  const cellXfs = styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? "";
  const dateStyles = [...cellXfs.matchAll(/<xf\b[^>]*>/g)].map((match) => {
    const id = Number(attr(match[0], "numFmtId") ?? 0);
    return isDateFormat(id, formats.get(id));
  });

  const sheets: RawSheet[] = [];
  for (const match of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = decodeXml(attr(match[0], "name") ?? "");
    const target = targets.get(attr(match[0], "r:id") ?? "") ?? "";
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    const xml = await read(path);
    const rows: string[][] = [];
    for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const rowNumber = Number(attr(rowMatch[0], "r") ?? rows.length + 1);
      const cells: string[] = [];
      for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const tag = `<c${cellMatch[1]}>`;
        const inner = cellMatch[2] ?? "";
        const column = columnIndex(attr(tag, "r") ?? "A");
        const type = attr(tag, "t");
        const raw = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let value = "";
        if (type === "s") value = shared[Number(raw)] ?? "";
        else if (type === "inlineStr") value = textOf(inner);
        else if (type === "str" || type === "e") value = decodeXml(raw ?? "");
        else if (type === "b") value = raw === "1" ? "VERDADEIRO" : "FALSO";
        else if (raw !== undefined && raw !== "") {
          const number = Number(raw);
          value = Number.isFinite(number) && dateStyles[Number(attr(tag, "s") ?? 0)] ? serialToIso(number) : Number.isFinite(number) ? formatNumber(number) : decodeXml(raw);
        }
        while (cells.length < column) cells.push("");
        cells[column] = value;
      }
      while (rows.length < rowNumber - 1) rows.push([]);
      rows[rowNumber - 1] = cells;
    }
    sheets.push({ name, rows });
  }
  return sheets;
}

/** Descompactação no navegador, sem bibliotecas. */
export const browserInflateRaw: InflateRaw = async (data) => {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};
