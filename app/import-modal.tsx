"use client";

import { useState } from "react";
import CircleCheck from "lucide-react/icons/circle-check";
import FileSpreadsheet from "lucide-react/icons/file-spreadsheet";
import TriangleAlert from "lucide-react/icons/triangle-alert";
import X from "lucide-react/icons/x";
import type { Issue, RawSheet, WorkbookKind } from "./demand-import";
import { taskStatusLabels, type TaskStatus } from "./tasks";
import { browserInflateRaw, readXlsx } from "./xlsx-reader";

type Slot = { kind: WorkbookKind; label: string; hint: string };
const slots: Slot[] = [
  { kind: "support", label: "Demandas Diárias | Suporte", hint: "Abas por pessoa + Configurações" },
  { kind: "development", label: "Demandas Diárias | Desenvolvimento", hint: "Abas por pessoa + Configurações" },
  { kind: "leadership", label: "Gestão de Demandas | Liderança", hint: "Usa a aba Projetos Grandes" },
];

type Loaded = { fileName: string; sheets: RawSheet[]; personTabs: number; rows: number };
type Report = {
  rowsRead: number; demandsToImport: number; mergedGroups: number; mergedRows: number; alreadyImported: number; byStatus: Partial<Record<TaskStatus, number>>;
  projectsRead: number; projectsToImport: number; projectsAlreadyImported: number; newPeople: { name: string; team: string | null }[]; newClients: string[];
  hoursFlagged: number; errors: Issue[]; warnings: Issue[]; totalErrors: number; totalWarnings: number;
};

const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR").trim();

/** Fica só com as abas que a importação usa, e corta colunas e linhas vazias para enviar menos dados. */
function relevantSheets(sheets: RawSheet[]) {
  return sheets.flatMap((sheet) => {
    const first = fold(sheet.rows[0]?.[0] ?? "");
    const name = fold(sheet.name);
    const keep = first.startsWith("minhas demandas") || name === "configuracoes" || name === "projetos grandes";
    const title = first.startsWith("demandas diarias |");
    if (!keep && !title) return [];
    const rows = (title ? sheet.rows.slice(0, 2) : sheet.rows).map((row) => {
      const cells = row.slice(0, 20);
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      return cells;
    });
    while (rows.length && !rows[rows.length - 1].length) rows.pop();
    return [{ name: sheet.name, rows }];
  });
}

export default function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => Promise<void> }) {
  const [files, setFiles] = useState<Partial<Record<WorkbookKind, Loaded>>>({});
  const [reading, setReading] = useState<WorkbookKind | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [result, setResult] = useState<{ demands: number; projects: number; people: number; clients: number } | null>(null);
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);
  const [error, setError] = useState("");
  const [warningFilter, setWarningFilter] = useState("");

  async function pick(kind: WorkbookKind, file: File | undefined) {
    if (!file) return;
    setError("");
    setReport(null);
    setResult(null);
    if (!/\.xlsx$/i.test(file.name)) { setError(`"${file.name}" não é um .xlsx. No Google Planilhas use Arquivo → Fazer download → Microsoft Excel (.xlsx).`); return; }
    if (file.size > 25 * 1024 * 1024) { setError(`"${file.name}" tem mais de 25 MB.`); return; }
    setReading(kind);
    try {
      const sheets = relevantSheets(await readXlsx(new Uint8Array(await file.arrayBuffer()), browserInflateRaw));
      const personTabs = sheets.filter((sheet) => fold(sheet.rows[0]?.[0] ?? "").startsWith("minhas demandas")).length;
      const rows = sheets.reduce((total, sheet) => total + sheet.rows.length, 0);
      setFiles((current) => ({ ...current, [kind]: { fileName: file.name, sheets, personTabs, rows } }));
    } catch (err) {
      setError(err instanceof Error ? `Não consegui ler "${file.name}": ${err.message}` : `Não consegui ler "${file.name}".`);
    } finally {
      setReading(null);
    }
  }

  async function send(confirm: boolean) {
    setBusy(confirm ? "import" : "preview");
    setError("");
    try {
      const workbooks = slots.filter((slot) => files[slot.kind]).map((slot) => ({ kind: slot.kind, fileName: files[slot.kind]!.fileName, sheets: files[slot.kind]!.sheets }));
      const response = await fetch("/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workbooks, confirm }) });
      const data = await response.json() as { error?: string; preview?: Report; imported?: typeof result };
      if (data.preview) setReport(data.preview);
      if (!response.ok) throw new Error(data.error || "Não foi possível processar as planilhas.");
      if (confirm && data.imported) { setResult(data.imported); await onImported(); }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível processar as planilhas.");
    } finally {
      setBusy(null);
    }
  }

  const chosen = slots.filter((slot) => files[slot.kind]).length;
  const warnings = (report?.warnings ?? []).filter((issue) => !warningFilter || fold(`${issue.sheet} ${issue.message}`).includes(fold(warningFilter)));
  const canImport = report && !report.totalErrors && (report.demandsToImport > 0 || report.projectsToImport > 0) && !result;

  return <div className="modal-layer"><button className="backdrop" onClick={busy ? undefined : onClose} aria-label="Fechar janela" /><div className="modal import-modal">
    <div className="modal-head"><div><p className="eyebrow">IMPORTAÇÃO</p><h2>Importar planilhas de demandas</h2><p>No Google Planilhas, abra cada planilha e use Arquivo → Fazer download → Microsoft Excel (.xlsx). Nada é gravado até você confirmar a prévia.</p></div><button type="button" onClick={onClose} disabled={Boolean(busy)} aria-label="Fechar"><X /></button></div>

    <div className="import-body">
      <div className="import-slots">
        {slots.map((slot) => {
          const loaded = files[slot.kind];
          return <label key={slot.kind} className={`import-slot ${loaded ? "loaded" : ""}`}>
            <FileSpreadsheet size={20} />
            <span><strong>{slot.label}</strong><small>{reading === slot.kind ? "Lendo o arquivo..." : loaded ? `${loaded.fileName} · ${slot.kind === "leadership" ? "Projetos Grandes" : `${loaded.personTabs} abas de pessoas`}` : slot.hint}</small></span>
            <em>{loaded ? "Trocar" : "Escolher .xlsx"}</em>
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={Boolean(busy) || Boolean(reading)} onChange={(event) => { void pick(slot.kind, event.target.files?.[0]); event.target.value = ""; }} />
          </label>;
        })}
      </div>

      {error && <p className="modal-error import-error">{error}</p>}

      {report && <div className="import-report">
        {result ? <div className="import-done"><CircleCheck size={22} /><div><strong>Importação concluída</strong><p>{result.demands} demandas, {result.projects} projetos, {result.people} pessoas e {result.clients} clientes novos. As demandas já aparecem na lista.</p></div></div>
          : report.totalErrors ? <div className="import-blocked"><TriangleAlert size={20} /><div><strong>{report.totalErrors} erro{report.totalErrors > 1 ? "s" : ""} impede{report.totalErrors > 1 ? "m" : ""} a importação</strong><p>Corrija as linhas abaixo direto na planilha, baixe o .xlsx de novo e gere outra prévia.</p></div></div>
          : !report.demandsToImport && !report.projectsToImport ? <div className="import-ready"><CircleCheck size={20} /><div><strong>Nada novo para importar</strong><p>Todas as demandas e projetos destes arquivos já estão no Portal. Nada será duplicado.</p></div></div>
          : <div className="import-ready"><CircleCheck size={20} /><div><strong>Tudo pronto para importar</strong><p>Confira os números e os avisos. Linhas já importadas antes não entram de novo.</p></div></div>}

        <div className="import-stats">
          <article><small>Linhas lidas</small><strong>{report.rowsRead}</strong><p>nas abas de pessoas</p></article>
          <article><small>Demandas novas</small><strong>{report.demandsToImport}</strong><p>{report.alreadyImported ? `${report.alreadyImported} já existiam` : "nenhuma repetida no Portal"}</p></article>
          <article><small>Repetidas unidas</small><strong>{report.mergedGroups}</strong><p>{report.mergedRows} linhas viraram {report.mergedGroups} demandas</p></article>
          <article><small>Projetos</small><strong>{report.projectsToImport}</strong><p>{report.projectsRead ? `de ${report.projectsRead} em Projetos Grandes` : "planilha da Liderança não enviada"}</p></article>
          <article className={report.hoursFlagged ? "warn" : ""}><small>Horas suspeitas</small><strong>{report.hoursFlagged}</strong><p>marcadas para revisão</p></article>
        </div>

        {Object.keys(report.byStatus).length > 0 && <p className="import-status">{Object.entries(report.byStatus).map(([status, count]) => <span key={status}>{taskStatusLabels[status as TaskStatus]}: <b>{count}</b></span>)}</p>}

        <div className="import-lists">
          <section><h4>Pessoas novas ({report.newPeople.length})</h4><p>Entram sem senha. Libere o acesso em Usuários quando quiser.</p><ul>{report.newPeople.length ? report.newPeople.map((person) => <li key={person.name}>{person.name}{person.team && <small>{person.team}</small>}</li>) : <li className="muted">Ninguém novo</li>}</ul></section>
          <section><h4>Clientes novos ({report.newClients.length})</h4><p>Nomes que ainda não estão na lista de clientes.</p><ul>{report.newClients.length ? report.newClients.map((client) => <li key={client}>{client}</li>) : <li className="muted">Nenhum</li>}</ul></section>
        </div>

        {report.errors.length > 0 && <section className="import-issues errors"><h4>Erros ({report.totalErrors})</h4><ul>{report.errors.map((issue, index) => <li key={index}><span>{issue.sheet}{issue.row ? ` · linha ${issue.row}` : ""}</span>{issue.message}</li>)}</ul></section>}
        {report.totalWarnings > 0 && <details className="import-issues warnings"><summary>Avisos ({report.totalWarnings}): não impedem a importação</summary>
          <input value={warningFilter} onChange={(event) => setWarningFilter(event.target.value)} placeholder="Filtrar avisos (ex.: horas, Angelo, data)" />
          <ul>{warnings.map((issue, index) => <li key={index}><span>{issue.sheet}{issue.row ? ` · linha ${issue.row}` : ""}</span>{issue.message}</li>)}</ul>
          {report.totalWarnings > report.warnings.length && <p className="muted">Mostrando os primeiros {report.warnings.length} avisos.</p>}
        </details>}
      </div>}
    </div>

    <div className="modal-actions">
      <button type="button" className="secondary-button" onClick={onClose} disabled={Boolean(busy)}>{result ? "Fechar" : "Cancelar"}</button>
      {!result && <button type="button" className="secondary-button" disabled={!chosen || Boolean(busy) || Boolean(reading)} onClick={() => void send(false)}>{busy === "preview" ? "Conferindo..." : report ? "Gerar prévia de novo" : "Gerar prévia"}</button>}
      {!result && <button type="button" className="primary-button" disabled={!canImport || Boolean(busy)} onClick={() => void send(true)}>{busy === "import" ? "Importando..." : report ? `Importar ${report.demandsToImport} demandas${report.projectsToImport ? ` e ${report.projectsToImport} projetos` : ""}` : "Importar"}</button>}
    </div>
  </div></div>;
}
