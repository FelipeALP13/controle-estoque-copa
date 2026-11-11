"use client";

import { useCallback, useEffect, useState } from "react";
import DatabaseBackup from "lucide-react/icons/database-backup";
import Download from "lucide-react/icons/download";
import Search from "lucide-react/icons/search";
import ShieldAlert from "lucide-react/icons/shield-alert";
import { auditGroupLabels, type AuditGroup } from "./audit-labels";
import { downloadXlsx, type SheetData } from "./xlsx-writer";

type Entry = { id: number; actorName: string; action: string; label: string; group: AuditGroup; sensitive: boolean; targetType: string; targetId: string | null; details: string; createdAt: string };

function todayInSaoPaulo() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function shiftDays(isoDate: string, days: number) {
  return new Date(Date.parse(`${isoDate}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

/** Início/fim do dia em Brasília, convertidos para o formato UTC do banco. */
function utcStamp(isoDate: string, endOfDay: boolean) {
  const local = new Date(`${isoDate}T${endOfDay ? "23:59:59" : "00:00:00"}-03:00`);
  return local.toISOString().slice(0, 19).replace("T", " ");
}

/** Data gravada pelo banco (UTC, sem fuso) → horário de Brasília para leitura. */
function localStamp(value: string) {
  const date = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value) ? `${value.replace(" ", "T")}Z` : value);
  return date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function AdminView() {
  const today = todayInSaoPaulo();
  const [filters, setFilters] = useState({ from: shiftDays(today, -29), to: today, group: "", q: "" });
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [limited, setLimited] = useState(false);
  const [error, setError] = useState("");
  const [backingUp, setBackingUp] = useState(false);
  const [backupInfo, setBackupInfo] = useState("");

  const load = useCallback(async () => {
    setError("");
    const params = new URLSearchParams({ view: "audit", from: utcStamp(filters.from, false), to: utcStamp(filters.to, true), limit: "1000" });
    if (filters.group) params.set("group", filters.group);
    if (filters.q.trim()) params.set("q", filters.q.trim());
    try {
      const response = await fetch(`/api/admin?${params}`, { cache: "no-store" });
      const data = await response.json() as { entries?: Entry[]; limited?: boolean; error?: string };
      if (!response.ok || !data.entries) throw new Error(data.error || "Não foi possível carregar o histórico.");
      setEntries(data.entries);
      setLimited(Boolean(data.limited));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar o histórico.");
      setEntries([]);
    }
  }, [filters]);
  // Busca ao mudar os filtros (com uma pequena espera para a digitação).
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 300); return () => window.clearTimeout(timer); }, [load]);

  function exportAudit() {
    if (!entries) return;
    downloadXlsx(`historico-acoes-${filters.from}-a-${filters.to}.xlsx`, [{
      name: "Histórico",
      columns: [{ header: "Quando", width: 18 }, { header: "Quem", width: 24 }, { header: "O que fez", width: 38 }, { header: "Área", width: 26 }, { header: "Detalhes", width: 60 }, { header: "Sensível", width: 10 }],
      rows: entries.map((entry) => [localStamp(entry.createdAt), entry.actorName, entry.label, auditGroupLabels[entry.group], entry.details, entry.sensitive ? "Sim" : ""]),
    }]);
    void fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "auditExported", details: `${entries.length} registros, ${filters.from} a ${filters.to}` }) });
  }

  async function downloadBackup() {
    setBackingUp(true);
    setError("");
    setBackupInfo("");
    try {
      const response = await fetch("/api/admin?view=backup", { cache: "no-store" });
      const data = await response.json() as { tables?: { name: string; columns: string[]; rows: unknown[][]; truncated: boolean }[]; generatedAt?: string; error?: string };
      if (!response.ok || !data.tables) throw new Error(data.error || "Não foi possível gerar a cópia.");
      const sheets: SheetData[] = [
        { name: "Sobre", columns: [{ header: "Informação", width: 28 }, { header: "Valor", width: 70 }], rows: [
          ["Gerado em", localStamp(data.generatedAt ?? new Date().toISOString())],
          ["Conteúdo", "Uma aba por tabela do Portal, com todas as linhas."],
          ["Fora da cópia", "Senhas, chaves de API do Jira, sessões de login e tentativas de login."],
          ...data.tables.filter((table) => table.truncated).map((table) => [`Atenção: ${table.name}`, "Tabela muito grande: só as primeiras 50.000 linhas."]),
        ] },
        ...data.tables.map((table) => ({
          name: table.name,
          columns: table.columns.map((column) => ({ header: column, width: Math.min(40, Math.max(10, column.length + 4)) })),
          rows: table.rows.map((row) => row.map((value) => (value === null || value === undefined ? null : typeof value === "number" ? value : String(value)))) as (string | number | null)[][],
        })),
      ];
      downloadXlsx(`copia-portal-${today}.xlsx`, sheets);
      const total = data.tables.reduce((sum, table) => sum + table.rows.length, 0);
      setBackupInfo(`Cópia baixada: ${data.tables.length} tabelas, ${total.toLocaleString("pt-BR")} linhas. Guarde o arquivo em local seguro: ele tem dados de clientes e da equipe.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível gerar a cópia.");
    } finally {
      setBackingUp(false);
    }
  }

  const sensitive = (entries ?? []).filter((entry) => entry.sensitive).length;
  const failedLogins = (entries ?? []).filter((entry) => entry.action === "login_failed" || entry.action === "login_blocked").length;

  return <div className="admin-page">
    <section className="admin-backup">
      <span><DatabaseBackup /></span>
      <div><h3>Cópia de segurança</h3><p>Baixa todos os dados do Portal num arquivo Excel, uma aba por tabela. Senhas, chaves do Jira e sessões de login ficam de fora. Recomendado uma vez por semana.</p>{backupInfo && <p className="admin-backup-ok">{backupInfo}</p>}</div>
      <button className="primary-button" onClick={downloadBackup} disabled={backingUp}><Download size={15} /> {backingUp ? "Gerando..." : "Baixar cópia"}</button>
    </section>

    <section className="report-card">
      <div className="report-card-head report-card-toolbar">
        <div><h3>Histórico de ações</h3><p>Quem fez o quê no Portal. Ações sensíveis (permissões, exclusões, senhas, Jira) ficam destacadas.</p></div>
        <div className="report-actions"><button className="secondary-button" onClick={exportAudit} disabled={!entries?.length}><Download size={15} /> Exportar Excel</button></div>
      </div>
      <div className="admin-filters">
        <label><span>De</span><input type="date" value={filters.from} max={filters.to} onChange={(event) => setFilters({ ...filters, from: event.target.value || filters.from })} /></label>
        <label><span>Até</span><input type="date" value={filters.to} min={filters.from} max={today} onChange={(event) => setFilters({ ...filters, to: event.target.value || filters.to })} /></label>
        <label><span>Área</span><select value={filters.group} onChange={(event) => setFilters({ ...filters, group: event.target.value })}><option value="">Todas</option>{(Object.keys(auditGroupLabels) as AuditGroup[]).map((group) => <option key={group} value={group}>{auditGroupLabels[group]}</option>)}</select></label>
        <label className="tasks-search admin-search"><Search size={14} /><input value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="Quem ou detalhe (nome, item, IP...)" /></label>
      </div>
      {error && <p className="modal-error">{error}</p>}
      {entries && <p className="admin-summary">{entries.length}{limited ? "+" : ""} registro{entries.length === 1 ? "" : "s"} · {sensitive} sensíve{sensitive === 1 ? "l" : "is"}{failedLogins > 0 && <b className="admin-alert"><ShieldAlert size={13} /> {failedLogins} tentativa{failedLogins === 1 ? "" : "s"} de login com senha errada</b>}{limited && " · mostrando os 1.000 mais recentes; diminua o período para ver o resto"}</p>}
      {!entries ? <div className="loading-list"><span /><span /></div> : entries.length ? <div className="report-table-wrap"><table className="report-table admin-table">
        <thead><tr><th>Quando</th><th>Quem</th><th>O que fez</th><th>Detalhes</th></tr></thead>
        <tbody>{entries.map((entry) => <tr key={entry.id} className={entry.sensitive ? "sensitive" : ""}>
          <td>{localStamp(entry.createdAt)}</td><td>{entry.actorName}</td><td>{entry.label}</td><td className="admin-details">{entry.details}</td>
        </tr>)}</tbody>
      </table></div> : <p className="muted">Nenhuma ação neste período.</p>}
    </section>
  </div>;
}
