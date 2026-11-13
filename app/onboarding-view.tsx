"use client";

import { useCallback, useEffect, useState } from "react";
import Check from "lucide-react/icons/check";
import Plus from "lucide-react/icons/plus";
import Sprout from "lucide-react/icons/sprout";
import Trash2 from "lucide-react/icons/trash-2";
import X from "lucide-react/icons/x";
import { Avatar, relativeTime } from "./task-shared";

type Person = { id: number; name: string; avatarIcon: string; avatarKey: string | null };
type Item = { id: number; text: string; done: boolean; doneByName: string | null; doneAt: string | null };
type Onboarding = { id: number; memberId: number; buddyId: number | null; startDate: string; status: "active" | "done"; createdByName: string; completedAt: string | null; canEdit: boolean; canCheck: boolean; items: Item[] };
type Data = { onboardings: Onboarding[]; people: Person[]; defaultSteps: string[]; me: { id: number; isAdmin: boolean } };

async function post(payload: Record<string, unknown>) {
  const response = await fetch("/api/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json() as { error?: string };
  if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
}

export function useOnboardings(enabled = true) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/onboarding", { cache: "no-store" });
      const json = await response.json() as Data & { error?: string };
      if (!response.ok) throw new Error(json.error || "Não foi possível carregar.");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar.");
    }
  }, []);
  useEffect(() => { if (!enabled) return; const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load, enabled]);
  return { data, error, load };
}

const shortDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });

/** Aba "Integração" em Pessoas: checklist dos primeiros dias de quem chega, com padrinho. */
export default function OnboardingView() {
  const { data, error, load } = useOnboardings();
  const [creating, setCreating] = useState(false);
  const [showDone, setShowDone] = useState(false);
  if (!data) return error ? <div className="alert error"><span>{error}</span></div> : <div className="loading-list"><span /><span /></div>;
  const active = data.onboardings.filter((row) => row.status === "active");
  const done = data.onboardings.filter((row) => row.status === "done");
  return <div className="onboarding-page">
    <div className="onboarding-intro">
      <span className="handoff-icon"><Sprout size={18} /></span>
      <div><h3>Integração de quem chega</h3><p>Checklist dos primeiros dias (acessos, ambiente, apresentações), com um padrinho que acompanha. Quem chega e o padrinho recebem aviso no sino.</p></div>
      {data.me.isAdmin && <button className="primary-button" onClick={() => setCreating(true)}><Plus size={15} /> Nova integração</button>}
    </div>
    {active.length ? <div className="onboarding-grid">{active.map((row) => <OnboardingCard key={row.id} row={row} people={data.people} isAdmin={data.me.isAdmin} onChanged={load} />)}</div>
      : <p className="muted">{data.me.isAdmin ? "Nenhuma integração em andamento." : "Você não tem nenhuma integração em andamento."}</p>}
    {done.length > 0 && <button className="link-button" onClick={() => setShowDone((value) => !value)}>{showDone ? "Esconder concluídas" : `Ver ${done.length} concluída${done.length === 1 ? "" : "s"}`}</button>}
    {showDone && <div className="onboarding-grid">{done.map((row) => <OnboardingCard key={row.id} row={row} people={data.people} isAdmin={data.me.isAdmin} onChanged={load} />)}</div>}
    {creating && <NewOnboardingModal people={data.people} defaultSteps={data.defaultSteps} onClose={() => setCreating(false)} onCreated={async () => { setCreating(false); await load(); }} />}
  </div>;
}

export function OnboardingCard({ row, people, isAdmin, onChanged, compact = false }: { row: Onboarding; people: Person[]; isAdmin: boolean; onChanged: () => Promise<void>; compact?: boolean }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const person = people.find((entry) => entry.id === row.memberId);
  const buddy = people.find((entry) => entry.id === row.buddyId);
  const doneCount = row.items.filter((item) => item.done).length;
  const percent = row.items.length ? Math.round((doneCount / row.items.length) * 100) : 0;
  async function run(payload: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try { await post(payload); await onChanged(); return true; } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível salvar."); return false; } finally { setBusy(false); }
  }
  const items = compact ? row.items.filter((item) => !item.done).slice(0, 4) : row.items;
  return <article className={`onboarding-card ${row.status}`}>
    <header>
      <Avatar member={person} size={36} />
      <div><strong>{person?.name ?? "Pessoa removida"}</strong><small>Começou em {shortDate(row.startDate)}{buddy ? ` · padrinho: ${buddy.name}` : " · sem padrinho"}</small></div>
      {!compact && row.canEdit && (row.status === "active" ? <button className="secondary-button" disabled={busy} onClick={() => void run({ action: "finish", onboardingId: row.id })}><Check size={13} /> Concluir</button> : <button className="link-button" disabled={busy} onClick={() => void run({ action: "reopen", onboardingId: row.id })}>Reabrir</button>)}
      {!compact && isAdmin && <button className="person-edit" disabled={busy} onClick={() => { if (window.confirm(`Excluir a integração de ${person?.name ?? "esta pessoa"}?`)) void run({ action: "deleteOnboarding", onboardingId: row.id }); }} title="Excluir" aria-label="Excluir integração"><Trash2 size={13} /></button>}
    </header>
    <span className="checklist-bar" aria-hidden="true"><i style={{ width: `${percent}%` }} className={percent === 100 ? "complete" : ""} /></span>
    <p className="onboarding-progress">{doneCount} de {row.items.length} passos{row.completedAt ? ` · concluída ${relativeTime(row.completedAt)}` : ""}</p>
    <ul className="onboarding-items">{items.map((item) => <li key={item.id} className={item.done ? "done" : ""}>
      <label><input type="checkbox" checked={item.done} disabled={!row.canCheck || busy} onChange={(event) => void run({ action: "toggleItem", itemId: item.id, done: event.target.checked })} /><span>{item.text}</span></label>
      {item.done && item.doneByName && <small>{item.doneByName.split(" ")[0]}</small>}
      {!compact && row.canEdit && <button className="dep-remove" disabled={busy} onClick={() => void run({ action: "deleteItem", itemId: item.id })} title="Apagar passo" aria-label="Apagar passo"><X size={12} /></button>}
    </li>)}</ul>
    {compact && row.items.length - doneCount > items.length && <p className="muted">e mais {row.items.length - doneCount - items.length} passos</p>}
    {!compact && row.canEdit && row.status === "active" && <form className="checklist-add" onSubmit={async (event) => { event.preventDefault(); if (text.trim() && await run({ action: "addItem", onboardingId: row.id, text })) setText(""); }}><input value={text} maxLength={200} onChange={(event) => setText(event.target.value)} placeholder="Novo passo e Enter" aria-label="Novo passo" /><button className="secondary-button" disabled={busy || !text.trim()}><Plus size={13} /> Adicionar</button></form>}
    {error && <p className="modal-error">{error}</p>}
  </article>;
}

function NewOnboardingModal({ people, defaultSteps, onClose, onCreated }: { people: Person[]; defaultSteps: string[]; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ memberId: "", buddyId: "", startDate: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()), steps: defaultSteps.join("\n") });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><form className="modal" onSubmit={async (event) => { event.preventDefault(); setSaving(true); setError(""); try { await post({ action: "createOnboarding", ...form, memberId: Number(form.memberId), buddyId: form.buddyId ? Number(form.buddyId) : null }); onCreated(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível criar."); setSaving(false); } }}>
    <div className="modal-head"><div><p className="eyebrow">PESSOAS</p><h2>Nova integração</h2><p>Crie antes o usuário da pessoa em Usuários. Ela e o padrinho recebem aviso no sino.</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
    <div className="form-grid">
      <label><span>Quem está chegando</span><select required value={form.memberId} onChange={(event) => setForm({ ...form, memberId: event.target.value })}><option value="" disabled>Escolha</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
      <label><span>Padrinho ou madrinha</span><select value={form.buddyId} onChange={(event) => setForm({ ...form, buddyId: event.target.value })}><option value="">Sem padrinho</option>{people.filter((person) => String(person.id) !== form.memberId).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
      <label><span>Primeiro dia</span><input type="date" required value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></label>
      <label className="full"><span>Passos (um por linha)</span><textarea rows={11} value={form.steps} onChange={(event) => setForm({ ...form, steps: event.target.value })} /><small>Já vem com uma lista sugerida para software house; ajuste à vontade.</small></label>
    </div>
    {error && <p className="modal-error">{error}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={saving || !form.memberId}>{saving ? "Criando..." : "Começar integração"}</button></div>
  </form></div>;
}
