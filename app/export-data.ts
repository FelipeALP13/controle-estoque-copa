// Exportação de dados para análise fora do Portal (Excel, Power BI): conjuntos, colunas e CSV. Regras puras.
import type { CellValue, Column } from "./xlsx-writer";

export const EXPORT_DATASETS = [
  { key: "tickets", label: "Chamados", hint: "Todos os chamados, com prazos, quem atendeu e a nota de satisfação." },
  { key: "tasks", label: "Demandas", hint: "Demandas com status, time, cliente, projeto, prazos e horas." },
  { key: "hours", label: "Horas lançadas", hint: "Cada lançamento de horas: pessoa, dia, demanda e cliente." },
  { key: "projects", label: "Projetos", hint: "Projetos grandes com farol, fase e datas." },
  { key: "maintenance", label: "Manutenção do escritório", hint: "Pedidos de manutenção e quanto tempo levaram." },
] as const;
export type ExportDataset = (typeof EXPORT_DATASETS)[number]["key"];
export const isExportDataset = (value: unknown): value is ExportDataset => EXPORT_DATASETS.some((entry) => entry.key === value);
export const EXPORT_FORMATS = ["xlsx", "csv", "json"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export const isExportFormat = (value: unknown): value is ExportFormat => (EXPORT_FORMATS as readonly unknown[]).includes(value);
/** Teto de linhas por arquivo (o Worker tem limite de memória). */
export const MAX_EXPORT_ROWS = 20000;

export type Table = { columns: Column[]; rows: CellValue[][] };

const validDay = (value: string | null) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));

/** Período pedido (AAAA-MM-DD). Sem datas = tudo. */
export function exportPeriod(from: string | null, to: string | null) {
  return { from: validDay(from) ? from! : null, to: validDay(to) ? to! : null };
}

/** Dia de Brasília (AAAA-MM-DD) de um instante salvo em ISO ou no formato do SQLite. */
export function localDay(value: string | null) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const ms = Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isFinite(ms) ? new Date(ms - 3 * 3600000).toISOString().slice(0, 10) : value.slice(0, 10);
}

/** Dentro do período (pelo dia de Brasília). */
export const inPeriod = (value: string | null, period: { from: string | null; to: string | null }) => {
  const day = localDay(value);
  if (!day) return !period.from && !period.to;
  return (!period.from || day >= period.from) && (!period.to || day <= period.to);
};

/** Horas entre dois instantes (1 casa decimal), ou null. */
export function hoursBetween(start: string | null, end: string | null) {
  if (!start || !end) return null;
  const toMs = (value: string) => Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  const diff = (toMs(end) - toMs(start)) / 3600000;
  return Number.isFinite(diff) && diff >= 0 ? Math.round(diff * 10) / 10 : null;
}

/** CSV no padrão do Excel brasileiro: ponto e vírgula, aspas quando precisa e BOM para os acentos. */
export function toCsv(table: Table) {
  const cell = (value: CellValue) => {
    if (value === null || value === undefined) return "";
    const text = typeof value === "number" ? String(value).replace(".", ",") : String(value);
    // Evita que o Excel interprete o texto como fórmula (injeção de CSV).
    const safe = /^[=+\-@\t\r]/.test(text) && typeof value !== "number" ? `'${text}` : text;
    return /[;"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [table.columns.map((column) => cell(column.header)), ...table.rows.map((row) => row.map(cell))].map((row) => row.join(";"));
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** JSON para o Power BI: lista de objetos com os nomes das colunas. */
export function toRecords(table: Table) {
  return table.rows.map((row) => Object.fromEntries(table.columns.map((column, index) => [column.header, row[index] ?? null])));
}
