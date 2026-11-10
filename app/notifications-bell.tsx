"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AtSign from "lucide-react/icons/at-sign";
import Bell from "lucide-react/icons/bell";
import CalendarDays from "lucide-react/icons/calendar";
import CircleDot from "lucide-react/icons/circle-dot";
import MessageSquare from "lucide-react/icons/message-square";
import UserPlus from "lucide-react/icons/user-plus";
import { notificationText, type NotificationKind } from "./notifications";
import { dueState, taskCode } from "./tasks";
import { ticketCode } from "./tickets";
import LifeBuoy from "lucide-react/icons/life-buoy";
import { relativeTime } from "./tasks-view";

type Item = { id: number; kind: NotificationKind; taskId: number | null; taskTitle: string | null; ticketId: number | null; ticketTitle: string | null; actorName: string; body: string; readAt: string | null; createdAt: string };
type DueTask = { id: number; title: string; dueDate: string };
type Data = { items: Item[]; unread: number; due: DueTask[] };

const kindIcon = { task_assigned: UserPlus, task_comment: MessageSquare, task_mention: AtSign, task_status: CircleDot, ticket_new: LifeBuoy, ticket_assigned: UserPlus, ticket_comment: MessageSquare, ticket_mention: AtSign, ticket_status: CircleDot } as const;

function subject(item: Item) {
  if (item.ticketId) return `${ticketCode(item.ticketId)} · ${item.ticketTitle ?? "Chamado"}`;
  if (item.taskId) return `${taskCode(item.taskId)} · ${item.taskTitle ?? "Tarefa"}`;
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

export default function NotificationsBell({ onOpenTask, onOpenTicket }: { onOpenTask: (taskId: number) => void; onOpenTicket: (ticketId: number) => void }) {
  const [data, setData] = useState<Data>({ items: [], unread: 0, due: [] });
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications", { cache: "no-store" });
      if (response.ok) setData(await response.json() as Data);
    } catch { /* tenta de novo no próximo ciclo */ }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => { void load(); }, 0);
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    const interval = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => { window.clearTimeout(first); window.clearInterval(interval); window.removeEventListener("focus", refresh); };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);

  async function openItem(item: Item) {
    setOpen(false);
    if (!item.readAt) {
      setData((current) => ({ ...current, unread: Math.max(0, current.unread - 1), items: current.items.map((entry) => entry.id === item.id ? { ...entry, readAt: new Date().toISOString() } : entry) }));
      void post({ action: "markRead", ids: [item.id] });
    }
    if (item.ticketId) onOpenTicket(item.ticketId);
    else if (item.taskId) onOpenTask(item.taskId);
  }

  async function markAll() {
    setData((current) => ({ ...current, unread: 0, items: current.items.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })) }));
    await post({ action: "markAllRead" });
  }

  const badge = data.unread + data.due.length;
  const now = today();

  return <div className="bell" ref={root}>
    <button className={`bell-button ${open ? "open" : ""}`} onClick={() => { setOpen((value) => !value); if (!open) void load(); }} aria-label={badge ? `Avisos: ${data.unread} não lidos, ${data.due.length} prazos` : "Avisos"} aria-expanded={open}>
      <Bell size={18} />
      {badge > 0 && <b>{badge > 9 ? "9+" : badge}</b>}
    </button>
    {open && <div className="bell-panel" role="dialog" aria-label="Avisos">
      <header><strong>Avisos</strong>{data.unread > 0 && <button onClick={markAll}>Marcar todas como lidas</button>}</header>
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
          {data.items.length === 0 ? <p className="bell-empty">Nenhum aviso por enquanto. Você será avisado sobre demandas e chamados: atribuições, comentários, menções e chamados novos para o seu time.</p> : data.items.map((item) => {
            const Icon = kindIcon[item.kind];
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
  </div>;
}
