"use client";

import { useCallback, useEffect, useState } from "react";
import Play from "lucide-react/icons/play";
import Square from "lucide-react/icons/square";
import Timer from "lucide-react/icons/timer";
import TriangleAlert from "lucide-react/icons/triangle-alert";
import { taskCode } from "./tasks";
import { TIMER_SUSPICIOUS_HOURS, timerClock, timerMinutes, timerSuggestion } from "./team-tools";

export type RunningTimer = { taskId: number; startedAt: string; title: string };

/** Avisa as outras partes da tela (cabeçalho e demanda aberta) que o cronômetro mudou. */
export const TIMER_CHANGED = "portal:timer-changed";

async function post(payload: Record<string, unknown>) {
  const response = await fetch("/api/time-entries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json() as { error?: string; timer?: RunningTimer | null; message?: string };
  if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
  window.dispatchEvent(new Event(TIMER_CHANGED));
  return data;
}

/** Cronômetro de quem está logado (atualiza a cada minuto e quando muda em outra parte da tela). */
export function useMyTimer(enabled = true) {
  const [timer, setTimer] = useState<RunningTimer | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/time-entries?timer=1", { cache: "no-store" });
      if (response.ok) setTimer(((await response.json()) as { timer: RunningTimer | null }).timer);
    } catch { /* tenta de novo depois */ }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const first = window.setTimeout(() => { void load(); }, 0);
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60000);
    const onChange = () => { void load(); };
    window.addEventListener(TIMER_CHANGED, onChange);
    window.addEventListener("focus", onChange);
    return () => { window.clearTimeout(first); window.clearInterval(interval); window.removeEventListener(TIMER_CHANGED, onChange); window.removeEventListener("focus", onChange); };
  }, [enabled, load]);
  return timer;
}

/** Relógio que anda a cada segundo enquanto o cronômetro está ligado. */
function useTick(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [active]);
  return now;
}

/** No cabeçalho: mostra o cronômetro ligado; clicar abre a demanda. */
export function TimerBadge({ onOpenTask }: { onOpenTask: (taskId: number) => void }) {
  const timer = useMyTimer();
  const now = useTick(Boolean(timer));
  if (!timer) return null;
  return <button className="timer-badge" onClick={() => onOpenTask(timer.taskId)} title={`Cronômetro em ${taskCode(timer.taskId)} · ${timer.title}. Clique para abrir e parar.`}>
    <span className="timer-dot" aria-hidden="true" /><Timer size={14} /><b>{timerClock(timer.startedAt, now)}</b><small>{taskCode(timer.taskId)}</small>
  </button>;
}

/** Na demanda: iniciar, ver o tempo correndo e parar (com as horas conferidas antes de lançar). */
export function TimerControl({ taskId, canEdit, onLogged }: { taskId: number; canEdit: boolean; onLogged: (message: string) => Promise<void> | void }) {
  const timer = useMyTimer(canEdit);
  const here = timer?.taskId === taskId;
  const now = useTick(here);
  const [stopping, setStopping] = useState<{ hours: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try { await action(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível concluir."); } finally { setBusy(false); }
  }

  if (!canEdit) return null;
  if (timer && !here) return <p className="timer-control muted"><Timer size={13} /> Seu cronômetro está rodando em <b>{taskCode(timer.taskId)}</b>. Pare ele lá para começar aqui.</p>;
  if (!timer) return <div className="timer-control">
    <button type="button" className="secondary-button" disabled={busy} onClick={() => void run(async () => { await post({ action: "startTimer", taskId }); })}><Play size={13} /> Iniciar cronômetro</button>
    <small>Conta o tempo enquanto você trabalha; ao parar, vira um lançamento de hoje.</small>
    {error && <p className="modal-error">{error}</p>}
  </div>;

  const long = timerMinutes(timer.startedAt, now) > TIMER_SUSPICIOUS_HOURS * 60;
  return <div className="timer-control running">
    <span className="timer-face"><span className="timer-dot" aria-hidden="true" /><b>{timerClock(timer.startedAt, now)}</b><small>desde {new Date(timer.startedAt).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}</small></span>
    {!stopping ? <button type="button" className="primary-button" disabled={busy} onClick={() => setStopping({ hours: timerSuggestion(timer.startedAt, Date.now()), note: "" })}><Square size={12} /> Parar</button> : null}
    {stopping && <form className="timer-stop" onSubmit={(event) => { event.preventDefault(); void run(async () => { const result = await post({ action: "stopTimer", hours: stopping.hours, note: stopping.note }); setStopping(null); await onLogged(result.message ?? "Horas lançadas."); }); }}>
      {long && <p className="hours-warning"><TriangleAlert size={13} /> O cronômetro ficou ligado mais de {TIMER_SUSPICIOUS_HOURS} h. Confira as horas antes de lançar.</p>}
      <label>Horas <input aria-label="Horas a lançar" className="time-log-hours" value={stopping.hours} onChange={(event) => setStopping({ ...stopping, hours: event.target.value })} required /></label>
      <input aria-label="O que foi feito" className="time-log-note" maxLength={300} placeholder="O que foi feito (opcional)" value={stopping.note} onChange={(event) => setStopping({ ...stopping, note: event.target.value })} />
      <button className="primary-button" disabled={busy || !stopping.hours.trim()}>{busy ? "Lançando..." : "Lançar"}</button>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => setStopping(null)}>Continuar contando</button>
      <button type="button" className="link-button danger" disabled={busy} onClick={() => { if (window.confirm("Descartar o tempo do cronômetro sem lançar?")) void run(async () => { await post({ action: "discardTimer" }); setStopping(null); }); }}>Descartar</button>
    </form>}
    {error && <p className="modal-error">{error}</p>}
  </div>;
}
