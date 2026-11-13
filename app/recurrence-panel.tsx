"use client";

import { useState } from "react";
import RepeatIcon from "lucide-react/icons/repeat";
import { describeRecurrence, DUE_OPTIONS, isoWeekday, WEEKDAY_NAMES, type Frequency } from "./task-recurrence";
import { taskCode } from "./tasks";

export type Recurrence = { frequency: Frequency; day: number; dueDays: number | null; nextOn: string; active: boolean; lastTaskId: number | null };

const fullDate = (day: string) => day.split("-").reverse().join("/");
const todayInSaoPaulo = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

async function post(payload: Record<string, unknown>) {
  const response = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json() as { recurrence?: Recurrence | null; error?: string };
  if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
  return data.recurrence ?? null;
}

/** "Repetir esta demanda": cria uma cópia (com responsáveis e checklist) toda semana ou todo mês. */
export default function RecurrencePanel({ taskId, recurrence, canEdit, onChanged, onOpenTask }: { taskId: number; recurrence: Recurrence | null; canEdit: boolean; onChanged: (value: Recurrence | null) => void; onOpenTask?: (taskId: number) => void }) {
  const today = todayInSaoPaulo();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ frequency: recurrence?.frequency ?? "weekly" as Frequency, day: recurrence?.day ?? isoWeekday(today), dueDays: recurrence?.dueDays ?? null as number | null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!recurrence && !canEdit) return null;

  async function run(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível salvar."); } finally { setBusy(false); }
  }

  const setFrequency = (frequency: Frequency) => setForm({ ...form, frequency, day: frequency === "weekly" ? isoWeekday(today) : Math.min(Number(today.slice(8)), 28) });

  return <section className="recurrence">
    <div className="recurrence-head">
      <h3><RepeatIcon size={14} /> Repetir</h3>
      {!editing && canEdit && <button type="button" className="link-button" onClick={() => setEditing(true)}>{recurrence ? "Alterar" : "Repetir esta demanda"}</button>}
    </div>
    {!editing && (recurrence ? <p className="recurrence-status">
      <b>{describeRecurrence(recurrence.frequency, recurrence.day)}</b> · próxima cópia em {fullDate(recurrence.nextOn)}{recurrence.dueDays !== null && ` · prazo ${DUE_OPTIONS.find((option) => option.value === recurrence.dueDays)?.label.toLowerCase()}`}
      {recurrence.lastTaskId && (onOpenTask ? <> · <button type="button" className="link-button" onClick={() => onOpenTask(recurrence.lastTaskId!)}>última: {taskCode(recurrence.lastTaskId)}</button></> : <> · última cópia: {taskCode(recurrence.lastTaskId)}</>)}
    </p> : <p className="recurrence-hint">Para tarefas que voltam sempre (fechamento, backup, relatório): o Portal cria uma cópia com os mesmos responsáveis e checklist.</p>)}
    {editing && <div className="recurrence-form">
      <label><span>Frequência</span><select value={form.frequency} onChange={(event) => setFrequency(event.target.value as Frequency)}><option value="weekly">Toda semana</option><option value="monthly">Todo mês</option></select></label>
      <label><span>{form.frequency === "weekly" ? "Dia da semana" : "Dia do mês"}</span><select value={form.day} onChange={(event) => setForm({ ...form, day: Number(event.target.value) })}>
        {form.frequency === "weekly" ? WEEKDAY_NAMES.slice(1).map((name, index) => <option key={name} value={index + 1}>{name}</option>) : Array.from({ length: 28 }, (_, index) => <option key={index + 1} value={index + 1}>dia {index + 1}</option>)}
      </select></label>
      <label><span>Prazo da cópia</span><select value={form.dueDays === null ? "" : String(form.dueDays)} onChange={(event) => setForm({ ...form, dueDays: event.target.value === "" ? null : Number(event.target.value) })}>{DUE_OPTIONS.map((option) => <option key={String(option.value)} value={option.value === null ? "" : String(option.value)}>{option.label}</option>)}</select></label>
      <div className="recurrence-actions">
        <button type="button" className="primary-button" disabled={busy} onClick={() => run(async () => { onChanged(await post({ action: "saveRecurrence", taskId, ...form })); setEditing(false); })}>Salvar</button>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => setEditing(false)}>Cancelar</button>
        {recurrence && <button type="button" className="link-button danger" disabled={busy} onClick={() => run(async () => { if (!window.confirm("Parar de repetir esta demanda? As cópias já criadas continuam.")) return; onChanged(await post({ action: "removeRecurrence", taskId })); setEditing(false); })}>Parar de repetir</button>}
      </div>
      {form.frequency === "monthly" && <small className="form-hint">Até o dia 28, para valer em todos os meses.</small>}
    </div>}
    {error && <p className="modal-error">{error}</p>}
  </section>;
}
