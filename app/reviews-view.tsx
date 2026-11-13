"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Building2 from "lucide-react/icons/building-2";
import Check from "lucide-react/icons/check";
import ClipboardCheck from "lucide-react/icons/clipboard-check";
import Lock from "lucide-react/icons/lock";
import Pencil from "lucide-react/icons/pencil";
import Plus from "lucide-react/icons/plus";
import Star from "lucide-react/icons/star";
import Target from "lucide-react/icons/target";
import Trash2 from "lucide-react/icons/trash-2";
import UserRound from "lucide-react/icons/user-round";
import X from "lucide-react/icons/x";
import { goalStatus, goalStatusLabels, MAX_CRITERION_NOTE, MAX_REVIEW_COMMENT } from "./review-tools";
import Handshake from "lucide-react/icons/handshake";
import Smile from "lucide-react/icons/smile";
import OneOnOnesView from "./one-on-ones-view";
import PulseView from "./pulse-view";
import { Avatar, relativeTime } from "./task-shared";

type Me = { id: number; isAdmin: boolean };
type Cycle = { id: number; title: string; startDate: string; endDate: string; status: "open" | "closed"; criteria?: { peer: string[]; company: string[]; manager: string[] } };
type Pending = { target: string; kind: "member" | "company" | "manager"; label: string; subtitle: string; avatar?: { id: number; name: string; avatarIcon: string; avatarKey: string | null } | null; done: boolean };
type Manager = { id: number; name: string; title: string; active: boolean };
type ReviewData = { cycle: Cycle | null; cycles: Cycle[]; pending: Pending[]; participation: { memberId: number; name: string; done: number; total: number }[] | null; managers: Manager[]; defaults: { title: string; peer: string[]; company: string[]; manager: string[] }; minAnswers: number; me: Me };
type Result = { target: string; label: string; subtitle?: string; kind?: string; count: number; hidden: boolean; averages: { criterion: string; average: number }[]; overall: number | null; comments: string[]; notes?: { criterion: string; comments: string[] }[] };

async function call(path: string, payload: Record<string, unknown>) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json() as Record<string, unknown> & { error?: string };
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir.");
  return data;
}
const shortDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });
const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

export type ReviewsTab = "review" | "results" | "goals" | "oneonone" | "pulse";

export default function ReviewsView({ initialTab = "review" }: { initialTab?: ReviewsTab }) {
  const [tab, setTab] = useState<ReviewsTab>(initialTab);
  return <div className="sprints-page">
    <div className="tasks-scope" role="tablist" aria-label="Seções">
      <button role="tab" aria-selected={tab === "review"} className={tab === "review" ? "active" : ""} onClick={() => setTab("review")}><ClipboardCheck size={14} /> Avaliar</button>
      <button role="tab" aria-selected={tab === "results"} className={tab === "results" ? "active" : ""} onClick={() => setTab("results")}><Star size={14} /> Resultados</button>
      <button role="tab" aria-selected={tab === "goals"} className={tab === "goals" ? "active" : ""} onClick={() => setTab("goals")}><Target size={14} /> Metas</button>
      <button role="tab" aria-selected={tab === "oneonone"} className={tab === "oneonone" ? "active" : ""} onClick={() => setTab("oneonone")}><Handshake size={14} /> 1:1 e desenvolvimento</button>
      <button role="tab" aria-selected={tab === "pulse"} className={tab === "pulse" ? "active" : ""} onClick={() => setTab("pulse")}><Smile size={14} /> Clima</button>
    </div>
    {tab === "review" ? <ReviewTab /> : tab === "results" ? <ResultsTab /> : tab === "goals" ? <GoalsTab /> : tab === "oneonone" ? <OneOnOnesView /> : <PulseView />}
  </div>;
}

function useReviews() {
  const [data, setData] = useState<ReviewData | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/reviews", { cache: "no-store" });
      const json = await response.json() as ReviewData & { error?: string };
      if (!response.ok) throw new Error(json.error || "Não foi possível carregar a avaliação.");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar a avaliação.");
    }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  return { data, error, load, setError };
}

// ---------------- Avaliar ----------------

function ReviewTab() {
  const { data, error, load, setError } = useReviews();
  const [reviewing, setReviewing] = useState<Pending | null>(null);
  const [opening, setOpening] = useState(false);
  const [managing, setManaging] = useState(false);
  if (!data) return error ? <div className="alert error"><span>{error}</span></div> : <div className="loading-list"><span /><span /></div>;
  const { cycle, me } = data;
  const done = data.pending.filter((item) => item.done).length;
  const groups = [
    { kind: "member", title: "Colegas e líderes do seu time", icon: <UserRound size={15} /> },
    { kind: "company", title: "A empresa", icon: <Building2 size={15} /> },
    { kind: "manager", title: "Gestão", icon: <Star size={15} /> },
  ] as const;

  async function admin(payload: Record<string, unknown>, confirm?: string) {
    if (confirm && !window.confirm(confirm)) return;
    try { await call("/api/reviews", payload); await load(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível concluir."); }
  }

  return <div className="reviews-tab">
    {error && <div className="alert error"><span>{error}</span><button onClick={() => setError("")} aria-label="Fechar aviso"><X size={16} /></button></div>}
    {cycle ? <section className="review-hero">
      <div>
        
        <h2>{cycle.title}</h2>
        <p>Aberta até {shortDate(cycle.endDate)} · <Lock size={12} /> anônima: ninguém vê quem avaliou. Depois de enviada, a avaliação não pode ser alterada.</p>
      </div>
      <div className="review-progress"><strong>{done}/{data.pending.length}</strong><span>avaliações feitas</span><i className="usage-bar"><b style={{ width: `${data.pending.length ? (done / data.pending.length) * 100 : 0}%` }} /></i></div>
    </section> : <div className="empty-state"><span><ClipboardCheck /></span><h3>Nenhuma avaliação aberta</h3><p>A cada 3 meses um administrador abre o ciclo e todos recebem aviso no sino. Cada pessoa avalia os colegas e líderes do próprio time, a empresa e a gestão.</p>{me.isAdmin && <div><button className="primary-button" onClick={() => setOpening(true)}><Plus size={16} /> Abrir ciclo de avaliação</button></div>}</div>}

    {cycle && groups.map((group) => {
      const items = data.pending.filter((item) => item.kind === group.kind);
      if (!items.length) return group.kind === "member" ? <p key={group.kind} className="muted">Você não está em nenhum time, então não avalia colegas neste ciclo. Peça a um administrador para incluir você no time certo em Pessoas → Times.</p> : null;
      return <section key={group.kind} className="client-section">
        <header><h3>{group.icon} {group.title}</h3><span className="muted">{items.filter((item) => item.done).length} de {items.length}</span></header>
        <div className="review-targets">{items.map((item) => <button key={item.target} className={`review-target ${item.done ? "done" : ""}`} disabled={item.done} onClick={() => setReviewing(item)}>
          {item.avatar ? <Avatar member={item.avatar} size={34} /> : <span className="review-target-icon">{item.kind === "company" ? <Building2 size={16} /> : <Star size={16} />}</span>}
          <span><strong>{item.label}</strong><small>{item.subtitle || " "}</small></span>
          {item.done ? <em className="review-done"><Check size={12} /> Avaliado</em> : <em className="review-go">Avaliar</em>}
        </button>)}</div>
      </section>;
    })}

    {me.isAdmin && <section className="client-section review-admin">
      <header><h3>Administração da avaliação</h3><span className="sprint-actions">
        {cycle ? <button className="secondary-button" onClick={() => void admin({ action: "closeCycle", cycleId: cycle.id }, `Encerrar "${cycle.title}"? Ninguém mais poderá avaliar e os resultados ficam disponíveis.`)}><Check size={14} /> Encerrar ciclo</button>
          : <button className="primary-button" onClick={() => setOpening(true)}><Plus size={14} /> Abrir ciclo</button>}
        <button className="secondary-button" onClick={() => setManaging(true)}><Pencil size={14} /> Gestão avaliada</button>
      </span></header>
      {data.participation ? <>
        <p className="muted">Participação (quantas avaliações cada pessoa já enviou; as notas não aparecem aqui).</p>
        <ul className="participation">{[...data.participation].sort((a, b) => a.done / Math.max(1, a.total) - b.done / Math.max(1, b.total)).map((row) => <li key={row.memberId}><span>{row.name}</span><i className="usage-bar"><b style={{ width: `${row.total ? (row.done / row.total) * 100 : 0}%` }} /></i><small>{row.done}/{row.total}</small></li>)}</ul>
      </> : <p className="muted">Ciclos anteriores: {data.cycles.length ? data.cycles.map((entry) => `${entry.title} (${entry.status === "open" ? "aberto" : "encerrado"})`).join(" · ") : "nenhum ainda"}.</p>}
    </section>}

    {reviewing && cycle?.criteria && <ReviewForm cycle={cycle} item={reviewing} onClose={() => setReviewing(null)} onSent={async () => { setReviewing(null); await load(); }} />}
    {opening && <OpenCycleModal defaults={data.defaults} onClose={() => setOpening(false)} onOpened={async () => { setOpening(false); await load(); }} />}
    {managing && <ManagersModal managers={data.managers} onClose={() => setManaging(false)} onChanged={load} />}
  </div>;
}

const SCORE_LABELS = ["", "Muito abaixo", "Abaixo", "Esperado", "Acima", "Excelente"];

function ReviewForm({ cycle, item, onClose, onSent }: { cycle: Cycle; item: Pending; onClose: () => void; onSent: () => void }) {
  const criteria = item.kind === "member" ? cycle.criteria!.peer : item.kind === "company" ? cycle.criteria!.company : cycle.criteria!.manager;
  const [scores, setScores] = useState<number[]>(() => criteria.map(() => 0));
  const [notes, setNotes] = useState<string[]>(() => criteria.map(() => ""));
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const complete = scores.every((score) => score > 0);
  return <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><form className="modal review-form" onSubmit={async (event) => { event.preventDefault(); if (!complete) return; setSaving(true); setError(""); try { await call("/api/reviews", { action: "submit", cycleId: cycle.id, target: item.target, scores, notes, comment }); onSent(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível enviar."); setSaving(false); } }}>
    <div className="modal-head"><div><h2>{item.kind === "company" ? "Avaliar a empresa" : item.label}</h2><p>{cycle.title} · <Lock size={12} /> Anônimo. Seja sincero e respeitoso: notas e justificativas chegam sem o seu nome.</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
    <div className="review-criteria">{criteria.map((criterion, index) => <div key={criterion} className="review-criterion">
      <span>{criterion}</span>
      <div role="radiogroup" aria-label={criterion}>{[1, 2, 3, 4, 5].map((value) => <button type="button" key={value} role="radio" aria-checked={scores[index] === value} className={scores[index] >= value ? "on" : ""} onClick={() => setScores((current) => current.map((score, position) => position === index ? value : score))} title={SCORE_LABELS[value]}><Star size={20} /></button>)}</div>
      <small>{SCORE_LABELS[scores[index]] || "Escolha de 1 a 5"}</small>
      <input className="review-note" maxLength={MAX_CRITERION_NOTE} value={notes[index]} onChange={(event) => setNotes((current) => current.map((note, position) => position === index ? event.target.value : note))} placeholder={`Por que essa nota em ${criterion.toLowerCase()}? (opcional)`} aria-label={`Justificativa de ${criterion}`} />
    </div>)}</div>
    <label className="full review-comment"><span>Comentário geral <em>opcional</em></span><textarea rows={4} maxLength={MAX_REVIEW_COMMENT} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="O que essa pessoa faz muito bem? O que poderia melhorar?" /></label>
    {error && <p className="modal-error">{error}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={saving || !complete}>{saving ? "Enviando..." : "Enviar avaliação"}</button></div>
  </form></div>;
}

function OpenCycleModal({ defaults, onClose, onOpened }: { defaults: ReviewData["defaults"]; onClose: () => void; onOpened: () => void }) {
  const [form, setForm] = useState({ title: defaults.title, endDate: new Date(Date.parse(`${todayIso()}T12:00:00Z`) + 14 * 86400000).toISOString().slice(0, 10), peerCriteria: defaults.peer.join("\n"), companyCriteria: defaults.company.join("\n"), managerCriteria: defaults.manager.join("\n") });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><form className="modal" onSubmit={async (event) => { event.preventDefault(); setSaving(true); setError(""); try { await call("/api/reviews", { action: "openCycle", ...form }); onOpened(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível abrir."); setSaving(false); } }}>
    <div className="modal-head"><div><h2>Abrir ciclo de avaliação</h2><p>Todos recebem aviso no sino. Cada pessoa avalia os colegas e líderes do próprio time, a empresa e a gestão. Dois dias antes do fim, quem não terminou recebe lembrete.</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
    <div className="form-grid">
      <label><span>Título</span><input autoFocus required maxLength={80} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
      <label><span>Avaliar até</span><input type="date" required min={todayIso()} value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} /></label>
      <label className="full"><span>Critérios para colegas (um por linha)</span><textarea rows={5} value={form.peerCriteria} onChange={(event) => setForm({ ...form, peerCriteria: event.target.value })} /></label>
      <label><span>Critérios para a empresa</span><textarea rows={5} value={form.companyCriteria} onChange={(event) => setForm({ ...form, companyCriteria: event.target.value })} /></label>
      <label><span>Critérios para a gestão</span><textarea rows={5} value={form.managerCriteria} onChange={(event) => setForm({ ...form, managerCriteria: event.target.value })} /></label>
    </div>
    {error && <p className="modal-error">{error}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={saving}>{saving ? "Abrindo..." : "Abrir e avisar todos"}</button></div>
  </form></div>;
}

function ManagersModal({ managers, onClose, onChanged }: { managers: Manager[]; onClose: () => void; onChanged: () => Promise<void> }) {
  const [form, setForm] = useState({ name: "", title: "" });
  const [error, setError] = useState("");
  async function save(payload: Record<string, unknown>) {
    setError("");
    try { await call("/api/reviews", { action: "saveManager", ...payload }); await onChanged(); return true; } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível salvar."); return false; }
  }
  return <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><div className="modal managers-modal">
    <div className="modal-head"><div><h2>Gestão avaliada</h2><p>Pessoas que todos avaliam, só com nome e cargo (não precisam de usuário no Portal).</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
    <ul className="templates-list">{managers.map((manager) => <li key={manager.id} className={manager.active ? "" : "inactive"}><div><strong>{manager.name}</strong><small>{manager.title || "Sem cargo"}</small></div><button className={`access-toggle ${manager.active ? "active" : "inactive"}`} onClick={() => void save({ managerId: manager.id, name: manager.name, title: manager.title, active: !manager.active })}>{manager.active ? "Avaliado" : "Fora da avaliação"}</button></li>)}</ul>
    <form className="clients-add" onSubmit={async (event) => { event.preventDefault(); if (await save(form)) setForm({ name: "", title: "" }); }}>
      <input value={form.name} maxLength={80} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Nome" aria-label="Nome" />
      <input value={form.title} maxLength={60} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Cargo (ex.: Diretor)" aria-label="Cargo" />
      <button className="primary-button" disabled={!form.name.trim()}><Plus size={15} /> Adicionar</button>
    </form>
    {error && <p className="modal-error">{error}</p>}
  </div></div>;
}

// ---------------- Resultados ----------------

function ResultsTab() {
  const { data, error } = useReviews();
  const closed = useMemo(() => (data?.cycles ?? []).filter((cycle) => cycle.status === "closed"), [data]);
  const [cycleId, setCycleId] = useState<number | null>(null);
  const selected = cycleId ?? closed[0]?.id ?? null;
  const [results, setResults] = useState<{ id: number; results: Result[]; minAnswers: number } | null>(null);
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    void fetch(`/api/reviews?results=${selected}`, { cache: "no-store" }).then(async (response) => {
      const json = await response.json() as { results?: Result[]; minAnswers?: number; error?: string };
      if (cancelled) return;
      if (!response.ok || !json.results) setLoadError(json.error || "Não foi possível carregar os resultados.");
      else { setLoadError(""); setResults({ id: selected, results: json.results, minAnswers: json.minAnswers ?? 3 }); }
    }).catch(() => { if (!cancelled) setLoadError("Não foi possível carregar os resultados."); });
    return () => { cancelled = true; };
  }, [selected]);

  if (!data) return error ? <div className="alert error"><span>{error}</span></div> : <div className="loading-list"><span /><span /></div>;
  if (!closed.length) return <div className="empty-state"><span><Star /></span><h3>Nenhum resultado ainda</h3><p>Os resultados aparecem quando o ciclo de avaliação é encerrado, para ninguém conseguir deduzir quem avaliou pela hora.</p></div>;
  const current = results?.id === selected ? results : null;
  const groups = data.me.isAdmin ? [
    { title: "Empresa e gestão", rows: current?.results.filter((row) => row.kind === "company" || row.kind === "manager") ?? [] },
    { title: "Pessoas", rows: current?.results.filter((row) => row.kind === "member") ?? [] },
  ] : [{ title: "Como seus colegas avaliaram você", rows: current?.results ?? [] }];
  return <div className="reviews-tab">
    <div className="client-report"><select aria-label="Ciclo" value={selected ?? ""} onChange={(event) => setCycleId(Number(event.target.value))}>{closed.map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.title}</option>)}</select>
      <span className="muted"><Lock size={12} /> Médias só aparecem com pelo menos {data.minAnswers} avaliações; comentários vêm sem nome.</span></div>
    {loadError && <div className="alert error"><span>{loadError}</span></div>}
    {!current ? <div className="loading-list"><span /></div> : groups.map((group) => group.rows.length > 0 && <section key={group.title} className="client-section">
      <header><h3>{group.title}</h3></header>
      <div className="result-grid">{group.rows.map((row) => <ResultCard key={row.target} row={row} minAnswers={current.minAnswers} />)}</div>
    </section>)}
  </div>;
}

function ResultCard({ row, minAnswers }: { row: Result; minAnswers: number }) {
  const [open, setOpen] = useState(false);
  const notes = row.notes ?? [];
  const total = row.comments.length + notes.reduce((sum, group) => sum + group.comments.length, 0);
  return <article className="result-card">
    <header><div><strong>{row.label}</strong>{row.subtitle && <small>{row.subtitle}</small>}</div>{row.overall !== null ? <b className="result-overall">{row.overall.toFixed(1).replace(".", ",")}</b> : null}</header>
    {row.hidden ? <p className="muted">{row.count ? `${row.count} avaliação${row.count === 1 ? "" : "ões"} — precisa de pelo menos ${minAnswers} para mostrar.` : "Nenhuma avaliação recebida."}</p> : <>
      <ul className="result-bars">{row.averages.map((item) => <li key={item.criterion}><span>{item.criterion}</span><i><b style={{ width: `${(item.average / 5) * 100}%` }} className={item.average < 3 ? "low" : item.average >= 4 ? "high" : ""} /></i><em>{item.average.toFixed(1).replace(".", ",")}</em></li>)}</ul>
      <p className="muted">{row.count} avaliações{total ? ` · ${total} comentário${total === 1 ? "" : "s"}` : ""}</p>
      {total > 0 && <button className="link-button" onClick={() => setOpen((value) => !value)}>{open ? "Esconder comentários" : "Ver comentários"}</button>}
      {open && <div className="result-notes">
        {notes.map((group) => <section key={group.criterion}><h4>{group.criterion}</h4><ul className="result-comments">{group.comments.map((comment, index) => <li key={index}>“{comment}”</li>)}</ul></section>)}
        {row.comments.length > 0 && <section><h4>Comentário geral</h4><ul className="result-comments">{row.comments.map((comment, index) => <li key={index}>“{comment}”</li>)}</ul></section>}
      </div>}
    </>}
  </article>;
}

// ---------------- Metas ----------------

type Goal = { id: number; year: number; scope: "team" | "person"; teamId: number | null; memberId: number | null; title: string; description: string; unit: string; direction: "up" | "down"; startValue: number; target: number; current: number; updatedAt: string; canManage: boolean; updates: { id: number; value: number; note: string; byName: string; at: string }[] };
type GoalsData = { year: number; goals: Goal[]; teams: { id: number; name: string; color: string }[]; people: { id: number; name: string; avatarIcon: string; avatarKey: string | null }[]; me: { id: number; isAdmin: boolean; ledTeamIds: number[]; canManageSomeone: boolean } };
const fmt = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

function GoalsTab() {
  const thisYear = Number(todayIso().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [data, setData] = useState<GoalsData | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Goal | "new" | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/goals?year=${year}`, { cache: "no-store" });
      const json = await response.json() as GoalsData & { error?: string };
      if (!response.ok) throw new Error(json.error || "Não foi possível carregar as metas.");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar as metas.");
    }
  }, [year]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  if (!data) return error ? <div className="alert error"><span>{error}</span></div> : <div className="loading-list"><span /><span /></div>;
  const teamGoals = data.goals.filter((goal) => goal.scope === "team");
  const personGoals = data.goals.filter((goal) => goal.scope === "person");
  const nameOf = (id: number | null) => data.people.find((person) => person.id === id)?.name ?? "Pessoa";
  return <div className="reviews-tab">
    <div className="client-report">
      <select aria-label="Ano" value={year} onChange={(event) => setYear(Number(event.target.value))}>{[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map((value) => <option key={value} value={value}>Metas de {value}</option>)}</select>
      {data.me.canManageSomeone && <button className="primary-button" onClick={() => setEditing("new")}><Plus size={15} /> Nova meta</button>}
      <span className="muted">Metas dos times: todos veem. Individuais: só a pessoa, os líderes do time dela e administradores.</span>
    </div>
    {error && <div className="alert error"><span>{error}</span><button onClick={() => setError("")} aria-label="Fechar aviso"><X size={16} /></button></div>}
    {data.teams.map((team) => { const list = teamGoals.filter((goal) => goal.teamId === team.id); return list.length ? <section key={team.id} className="client-section">
      <header><h3><span className={`team-chip-dot ${team.color}`} /> Metas do time {team.name}</h3></header>
      <div className="goal-grid">{list.map((goal) => <GoalCard key={goal.id} goal={goal} today={todayIso()} onEdit={() => setEditing(goal)} onChanged={load} />)}</div>
    </section> : null; })}
    {personGoals.length > 0 && <section className="client-section">
      <header><h3><UserRound size={15} /> Metas individuais</h3></header>
      <div className="goal-grid">{[...personGoals].sort((a, b) => Number(b.memberId === data.me.id) - Number(a.memberId === data.me.id) || nameOf(a.memberId).localeCompare(nameOf(b.memberId))).map((goal) => <GoalCard key={goal.id} goal={goal} owner={nameOf(goal.memberId)} today={todayIso()} onEdit={() => setEditing(goal)} onChanged={load} />)}</div>
    </section>}
    {!data.goals.length && <div className="empty-state"><span><Target /></span><h3>Nenhuma meta para {year}</h3><p>{data.me.canManageSomeone ? "Defina as metas anuais do time (ex.: 95% dos chamados respondidos no prazo, 12 entregas) e as individuais. O progresso é atualizado ao longo do ano." : "Os líderes ainda não definiram as metas deste ano."}</p></div>}
    {editing && <GoalModal goal={editing === "new" ? null : editing} year={year} data={data} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />}
  </div>;
}

function GoalCard({ goal, owner, today, onEdit, onChanged }: { goal: Goal; owner?: string; today: string; onEdit: () => void; onChanged: () => Promise<void> }) {
  const [updating, setUpdating] = useState(false);
  const [value, setValue] = useState(String(goal.current).replace(".", ","));
  const [note, setNote] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState("");
  const status = goalStatus(goal, goal.year, goal.year < Number(today.slice(0, 4)) ? `${goal.year}-12-31` : today);
  const unit = goal.unit ? (goal.unit === "%" ? "%" : ` ${goal.unit}`) : "";
  return <article className={`goal-card ${status.status}`}>
    <header>
      <div>{owner && <small className="goal-owner">{owner}</small>}<strong>{goal.title}</strong>{goal.description && <p>{goal.description}</p>}</div>
      <em className={`goal-status ${status.status}`}>{goalStatusLabels[status.status]}</em>
    </header>
    <div className="goal-numbers"><b>{fmt(goal.current)}{unit}</b><span>{goal.direction === "down" ? "meta: reduzir para" : "meta:"} {fmt(goal.target)}{unit}{goal.startValue ? ` · começou em ${fmt(goal.startValue)}${unit}` : ""}</span></div>
    <div className="goal-bar" title={`${status.progress}% atingido · esperado até hoje: ${status.expected}%`}><b style={{ width: `${Math.min(100, status.progress)}%` }} /><i style={{ left: `${status.expected}%` }} /></div>
    <p className="goal-meta">{status.progress}% atingido · o esperado até hoje seria {status.expected}% · atualizada {relativeTime(goal.updatedAt)}</p>
    {goal.canManage && (updating ? <form className="goal-update" onSubmit={async (event) => { event.preventDefault(); setError(""); try { await call("/api/goals", { action: "updateProgress", goalId: goal.id, value, note }); setUpdating(false); setNote(""); await onChanged(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível salvar."); } }}>
      <input autoFocus aria-label="Valor atual" inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} />
      <input aria-label="Observação" maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Observação (opcional)" />
      <button className="primary-button">Salvar</button><button type="button" className="secondary-button" onClick={() => setUpdating(false)}>Cancelar</button>
    </form> : <div className="goal-actions">
      <button className="secondary-button" onClick={() => setUpdating(true)}>Atualizar progresso</button>
      <button className="person-edit" onClick={onEdit} title="Editar meta" aria-label="Editar meta"><Pencil size={13} /></button>
      <button className="person-edit" onClick={async () => { if (!window.confirm(`Excluir a meta “${goal.title}”?`)) return; try { await call("/api/goals", { action: "deleteGoal", goalId: goal.id }); await onChanged(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível excluir."); } }} title="Excluir meta" aria-label="Excluir meta"><Trash2 size={13} /></button>
    </div>)}
    {goal.updates.length > 0 && <button className="link-button" onClick={() => setShowHistory((current) => !current)}>{showHistory ? "Esconder histórico" : `Histórico (${goal.updates.length})`}</button>}
    {showHistory && <ul className="goal-history">{goal.updates.map((update) => <li key={update.id}><b>{fmt(update.value)}{unit}</b> <span>{update.byName.split(" ")[0]} · {relativeTime(update.at)}</span>{update.note && <em>{update.note}</em>}</li>)}</ul>}
    {error && <p className="modal-error">{error}</p>}
  </article>;
}

function GoalModal({ goal, year, data, onClose, onSaved }: { goal: Goal | null; year: number; data: GoalsData; onClose: () => void; onSaved: () => void }) {
  const teams = data.me.isAdmin ? data.teams : data.teams.filter((team) => data.me.ledTeamIds.includes(team.id));
  const people = data.people.filter((person) => data.me.isAdmin || person.id !== data.me.id || data.me.ledTeamIds.length > 0);
  const [form, setForm] = useState({ scope: goal?.scope ?? (teams.length ? "team" : "person"), teamId: String(goal?.teamId ?? teams[0]?.id ?? ""), memberId: String(goal?.memberId ?? ""), title: goal?.title ?? "", description: goal?.description ?? "", unit: goal?.unit ?? "", direction: goal?.direction ?? "up", startValue: goal ? String(goal.startValue).replace(".", ",") : "0", target: goal ? String(goal.target).replace(".", ",") : "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><form className="modal" onSubmit={async (event) => { event.preventDefault(); setSaving(true); setError(""); try { await call("/api/goals", { action: "saveGoal", goalId: goal?.id, year, ...form, teamId: Number(form.teamId) || null, memberId: Number(form.memberId) || null }); onSaved(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível salvar."); setSaving(false); } }}>
    <div className="modal-head"><div><h2>{goal ? "Editar meta" : `Nova meta de ${year}`}</h2><p>Defina o valor de partida e o alvo; o progresso é atualizado ao longo do ano.</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
    <div className="form-grid">
      <label><span>Tipo</span><select value={form.scope} disabled={Boolean(goal)} onChange={(event) => setForm({ ...form, scope: event.target.value as "team" | "person" })}>{teams.length > 0 && <option value="team">Meta do time</option>}<option value="person">Meta individual</option></select></label>
      {form.scope === "team" ? <label><span>Time</span><select required value={form.teamId} onChange={(event) => setForm({ ...form, teamId: event.target.value })}>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
        : <label><span>Pessoa</span><select required value={form.memberId} onChange={(event) => setForm({ ...form, memberId: event.target.value })}><option value="" disabled>Escolha</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>}
      <label className="full"><span>Meta</span><input autoFocus required maxLength={120} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Ex.: Chamados respondidos no prazo" /></label>
      <label className="full"><span>Como medir <em>opcional</em></span><textarea rows={2} maxLength={1000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Ex.: % de chamados com primeira resposta dentro do prazo, pelo relatório de qualidade do Suporte" /></label>
      <label><span>Sentido</span><select value={form.direction} onChange={(event) => setForm({ ...form, direction: event.target.value as "up" | "down" })}><option value="up">Quanto mais, melhor</option><option value="down">Quanto menos, melhor</option></select></label>
      <label><span>Unidade <em>opcional</em></span><input maxLength={20} value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} placeholder="%, entregas, horas…" /></label>
      <label><span>Valor de partida</span><input inputMode="decimal" value={form.startValue} onChange={(event) => setForm({ ...form, startValue: event.target.value })} /></label>
      <label><span>Valor-alvo</span><input required inputMode="decimal" value={form.target} onChange={(event) => setForm({ ...form, target: event.target.value })} placeholder="Ex.: 95" /></label>
    </div>
    {error && <p className="modal-error">{error}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={saving || !form.title.trim() || !form.target.trim()}>{saving ? "Salvando..." : "Salvar meta"}</button></div>
  </form></div>;
}
