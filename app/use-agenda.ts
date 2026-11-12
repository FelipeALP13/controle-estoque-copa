"use client";

import { useCallback, useEffect, useState } from "react";
import { reminderTimes } from "./agenda";
import { NOTIFY_REFRESH_EVENT } from "./notify-sound";

export type AgendaEvent = {
  id: number; ownerId: number; kind: "note" | "meeting"; title: string; notes: string; startsAt: string; endsAt: string | null;
  remindBefore: number | null; teamsUrl: string; done: boolean; createdAt: string; updatedAt: string; attendees: number[]; isOwner: boolean;
};

/** Avisa as outras partes da tela (visão geral, aviso na hora) que a agenda mudou. */
const CHANGED = "portal:agenda-changed";
export const agendaChanged = () => window.dispatchEvent(new Event(CHANGED));
export const onAgendaChanged = (listener: () => void) => { window.addEventListener(CHANGED, listener); return () => window.removeEventListener(CHANGED, listener); };

/** Hora atual que se atualiza sozinha (para "agora" e "já passou" na tela). */
export function useNow(step = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), step); return () => window.clearInterval(timer); }, [step]);
  return now;
}

// O navegador atrasa timers muito longos; acima disso, recarrega e reagenda.
const MAX_WAIT = 30 * 60000;

/**
 * Compromissos das próximas 24 h e o aviso na hora exata: quando chega o momento de um lembrete,
 * pede ao servidor para entregar (que grava no sino, uma vez só) e o sino toca o som.
 * Com o Portal fechado, o aviso sai assim que alguém da equipe abrir o Portal (até 2 h depois).
 */
export function useUpcomingAgenda(enabled: boolean) {
  const [events, setEvents] = useState<AgendaEvent[]>([]);
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/agenda?upcoming=1", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json() as { events: AgendaEvent[] };
      setEvents(data.events);
    } catch { /* tenta de novo no próximo ciclo */ }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const first = window.setTimeout(() => { void load(); }, 0);
    const interval = window.setInterval(() => { void load(); }, 5 * 60000);
    const stop = onAgendaChanged(() => { void load(); });
    return () => { window.clearTimeout(first); window.clearInterval(interval); stop(); };
  }, [enabled, load]);

  // Agenda um timer para o próximo aviso de cada compromisso.
  useEffect(() => {
    if (!enabled) return;
    const now = Date.now();
    const timers: number[] = [];
    let nearest = Infinity;
    for (const event of events) {
      for (const reminder of reminderTimes(event)) {
        // Só os que ainda vão acontecer (os que já passaram, o servidor entrega na próxima rodada).
        if (reminder.at > now) nearest = Math.min(nearest, reminder.at);
      }
    }
    // Ao abrir o Portal, entrega na hora algum aviso que tenha vencido enquanto estava fechado.
    const fire = async () => {
      try {
        const response = await fetch("/api/agenda", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "fireReminders" }) });
        const result = response.ok ? await response.json() as { reminded: number } : { reminded: 0 };
        if (result.reminded > 0) window.dispatchEvent(new Event(NOTIFY_REFRESH_EVENT));
      } catch { /* tenta de novo na próxima rodada */ }
    };
    if (version === 0 && events.length) timers.push(window.setTimeout(() => { void fire(); }, 500));
    if (nearest !== Infinity) {
      const wait = nearest - now;
      // Um pouco depois do momento exato, para o relógio do servidor já considerar vencido.
      timers.push(window.setTimeout(() => { if (wait <= MAX_WAIT) void fire().then(() => setVersion((value) => value + 1)); else void load(); }, Math.min(wait + 1500, MAX_WAIT)));
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [enabled, events, version, load]);

  return { events, reload: load };
}
