"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import AtSign from "lucide-react/icons/at-sign";
import Bell from "lucide-react/icons/bell";
import CalendarDays from "lucide-react/icons/calendar";
import CalendarClock from "lucide-react/icons/calendar-clock";
import CalendarPlus from "lucide-react/icons/calendar-plus";
import CircleDot from "lucide-react/icons/circle-dot";
import MessageSquare from "lucide-react/icons/message-square";
import UserPlus from "lucide-react/icons/user-plus";
import Volume2 from "lucide-react/icons/volume-2";
import VolumeX from "lucide-react/icons/volume-x";
import X from "lucide-react/icons/x";
import { notificationText, type NotificationKind } from "./notifications";
import AlarmClock from "lucide-react/icons/alarm-clock";
import { dueState, taskCode } from "./tasks";
import { ticketCode } from "./tickets";
import LifeBuoy from "lucide-react/icons/life-buoy";
import { relativeTime } from "./tasks-view";
import { canAskDesktop, desktopNotify, isMuted, NOTIFY_REFRESH_EVENT, playChime, setMuted, unlockSoundOnInteraction } from "./notify-sound";

type Item = { id: number; kind: NotificationKind; taskId: number | null; taskTitle: string | null; ticketId: number | null; ticketTitle: string | null; eventId: number | null; eventTitle: string | null; actorName: string; body: string; readAt: string | null; createdAt: string };
type DueTask = { id: number; title: string; dueDate: string };
type Data = { items: Item[]; unread: number; due: DueTask[] };


const kindIcon = { task_assigned: UserPlus, task_comment: MessageSquare, task_mention: AtSign, task_status: CircleDot, ticket_new: LifeBuoy, ticket_assigned: UserPlus, ticket_comment: MessageSquare, ticket_mention: AtSign, ticket_status: CircleDot, ticket_late: AlarmClock, agenda_reminder: CalendarClock, agenda_invite: CalendarPlus } as const;

function subject(item: Item) {
  if (item.ticketId) return `${ticketCode(item.ticketId)} · ${item.ticketTitle ?? "Chamado"}`;
  if (item.taskId) return `${taskCode(item.taskId)} · ${item.taskTitle ?? "Tarefa"}`;
  if (item.kind === "agenda_invite") return item.eventTitle ? item.body : "Compromisso excluído";
  if (item.kind === "agenda_reminder") return item.eventTitle ? "Agenda" : "Compromisso excluído";
  return "Item excluído";
}

function today() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

async function post(payload: Record<string, unknown>) {
  await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
}

export default function NotificationsBell({ onOpenTask, onOpenTicket, onOpenEvent }: { onOpenTask: (taskId: number) => void; onOpenTicket: (ticketId: number) => void; onOpenEvent: (eventId: number) => void }) {
  const [data, setData] = useState<Data>({ items: [], unread: 0, due: [] });
  const [open, setOpen] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [askDesktop, setAskDesktop] = useState(false);
  const [toasts, setToasts] = useState<Item[]>([]);
  const root = useRef<HTMLDivElement>(null);
  // Maior id já visto: o que vier acima disso é novo (toca o som e mostra o aviso na tela).
  const seen = useRef<number | null>(null);

  const dismissToast = useCallback((id: number) => setToasts((current) => current.filter((item) => item.id !== id)), []);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications", { cache: "no-store" });
      if (!response.ok) return;
      const next = await response.json() as Data;
      setData(next);
      const top = next.items.reduce((max, item) => Math.max(max, item.id), 0);
      if (seen.current === null) { seen.current = top; return; }
      const fresh = next.items.filter((item) => item.id > (seen.current ?? 0) && !item.readAt);
      seen.current = Math.max(seen.current, top);
      if (!fresh.length) return;
      playChime(fresh.some((item) => item.kind === "agenda_reminder" && item.body.startsWith("Agora:")));
      const newest = fresh[0];
      desktopNotify("Portal da Equipe", notificationText(newest.kind, newest.actorName, newest.body));
      setToasts((current) => [...fresh.slice(0, 3), ...current].slice(0, 3));
      for (const item of fresh.slice(0, 3)) window.setTimeout(() => dismissToast(item.id), item.kind === "agenda_reminder" ? 30000 : 9000);
    } catch { /* tenta de novo no próximo ciclo */ }
  }, [dismissToast]);

  useEffect(() => {
    const prefs = window.setTimeout(() => { setMutedState(isMuted()); setAskDesktop(canAskDesktop()); }, 0);
    const release = unlockSoundOnInteraction();
    const first = window.setTimeout(() => { void load(); }, 0);
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    // Com a aba escondida o navegador desacelera os timers; ainda assim busca, para o som/aviso do sistema.
    const interval = window.setInterval(() => { void load(); }, 20000);
    const onRefresh = () => { void load(); };
    window.addEventListener("focus", refresh);
    window.addEventListener(NOTIFY_REFRESH_EVENT, onRefresh);
    return () => { window.clearTimeout(prefs); window.clearTimeout(first); window.clearInterval(interval); release(); window.removeEventListener("focus", refresh); window.removeEventListener(NOTIFY_REFRESH_EVENT, onRefresh); };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);

  function openItem(item: Item) {
    setOpen(false);
    dismissToast(item.id);
    if (!item.readAt) {
      setData((current) => ({ ...current, unread: Math.max(0, current.unread - 1), items: current.items.map((entry) => entry.id === item.id ? { ...entry, readAt: new Date().toISOString() } : entry) }));
      void post({ action: "markRead", ids: [item.id] });
    }
    if (item.ticketId) onOpenTicket(item.ticketId);
    else if (item.taskId) onOpenTask(item.taskId);
    else if (item.eventId && item.eventTitle) onOpenEvent(item.eventId);
  }

  async function markAll() {
    setData((current) => ({ ...current, unread: 0, items: current.items.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })) }));
    await post({ action: "markAllRead" });
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
    if (!next) playChime(false, true);
  }

  async function enableDesktop() {
    try { await Notification.requestPermission(); } catch { /* navegador sem suporte */ }
    setAskDesktop(canAskDesktop());
  }

  const badge = data.unread + data.due.length;
  const now = today();

  return <div className="bell" ref={root}>
    <button className={`bell-button ${open ? "open" : ""}`} onClick={() => { setOpen((value) => !value); if (!open) void load(); }} aria-label={badge ? `Avisos: ${data.unread} não lidos, ${data.due.length} prazos` : "Avisos"} aria-expanded={open}>
      <Bell size={18} />
      {badge > 0 && <b>{badge > 9 ? "9+" : badge}</b>}
    </button>
    {open && <div className="bell-panel" role="dialog" aria-label="Avisos">
      <header>
        <strong>Avisos</strong>
        <span className="bell-head-actions">
          {data.unread > 0 && <button onClick={markAll}>Marcar todas como lidas</button>}
          <button className="bell-sound" onClick={toggleMute} aria-label={muted ? "Ligar o som dos avisos" : "Desligar o som dos avisos"} title={muted ? "Som desligado" : "Som ligado"}>{muted ? <VolumeX size={15} /> : <Volume2 size={15} />}</button>
        </span>
      </header>
      {askDesktop && <button className="bell-desktop" onClick={enableDesktop}>Receber avisos também com o Portal minimizado</button>}
      <div className="bell-scroll">
        {data.due.length > 0 && <section>
          <h4>Prazos</h4>
          {data.due.map((task) => {
            const state = dueState(task.dueDate, now);
            return <button key={`due-${task.id}`} className="bell-item" onClick={() => { setOpen(false); onOpenTask(task.id); }}>
              <span className={`bell-icon due ${state}`}><CalendarDays size={14} /></span>
              <span className="bell-text"><strong>{state === "overdue" ? "Prazo vencido" : state === "today" ? "Vence hoje" : "Vence amanhã"}</strong><small>{taskCode(task.id)} · {task.title}</small></span>
            </button>;
          })}
        </section>}
        <section>
          {data.due.length > 0 && <h4>Atividade</h4>}
          {data.items.length === 0 ? <p className="bell-empty">Nenhum aviso por enquanto. Você será avisado sobre demandas e chamados (atribuições, comentários, menções, chamados novos para o seu time) e sobre os compromissos da sua agenda.</p> : data.items.map((item) => {
            const Icon = kindIcon[item.kind] ?? Bell;
            return <button key={item.id} className={`bell-item ${item.readAt ? "" : "unread"}`} onClick={() => openItem(item)}>
              <span className={`bell-icon ${item.kind}`}><Icon size={14} /></span>
              <span className="bell-text">
                <strong>{notificationText(item.kind, item.actorName, item.body)}</strong>
                <small>{subject(item)}</small>
                {["task_comment", "task_mention", "ticket_comment", "ticket_mention"].includes(item.kind) && item.body && <em>“{item.body}”</em>}
              </span>
              <span className="bell-time">{relativeTime(item.createdAt)}</span>
            </button>;
          })}
        </section>
      </div>
    </div>}
    {/* Fora do cabeçalho (que tem efeito de vidro e prenderia a posição): vai direto no corpo da página. */}
    {toasts.length > 0 && createPortal(<div className="bell-toasts" role="status" aria-live="polite">
      {toasts.map((item) => {
        const Icon = kindIcon[item.kind] ?? Bell;
        return <div key={item.id} className={`bell-toast ${item.kind}`}>
          <button className="bell-toast-body" onClick={() => openItem(item)}>
            <span className={`bell-icon ${item.kind}`}><Icon size={15} /></span>
            <span className="bell-text"><strong>{notificationText(item.kind, item.actorName, item.body)}</strong><small>{subject(item)}</small></span>
          </button>
          <button className="bell-toast-close" onClick={() => dismissToast(item.id)} aria-label="Fechar aviso"><X size={14} /></button>
        </div>;
      })}
    </div>, document.body)}
  </div>;
}
