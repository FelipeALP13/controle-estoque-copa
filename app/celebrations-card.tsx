"use client";

import { useEffect, useState } from "react";
import Cake from "lucide-react/icons/cake";
import PartyPopper from "lucide-react/icons/party-popper";
import { upcomingCelebrations, type Celebration } from "./team-tools";

type Person = { id: number; name: string; active: boolean; birthday?: string | null; startedOn?: string | null };

/** Pessoas ativas com aniversário e data de entrada (para a visão geral). */
export function useCelebrations(today: string, days = 14) {
  const [list, setList] = useState<Celebration[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/people", { cache: "no-store" })
      .then(async (response) => (response.ok ? ((await response.json()) as { people: Person[] }).people : []))
      .then((people) => { if (!cancelled) setList(upcomingCelebrations(people.filter((person) => person.active).map((person) => ({ id: person.id, name: person.name, birthday: person.birthday ?? null, startedOn: person.startedOn ?? null })), today, days)); })
      .catch(() => { if (!cancelled) setList([]); });
    return () => { cancelled = true; };
  }, [today, days]);
  return list;
}

export function whenLabel(entry: Celebration) {
  if (entry.daysAway === 0) return "Hoje";
  if (entry.daysAway === 1) return "Amanhã";
  return new Date(`${entry.date}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" });
}

/** Visão geral: aniversários e tempo de casa das próximas duas semanas. */
export default function CelebrationsCard({ today, onOpenPeople }: { today: string; onOpenPeople: () => void }) {
  const list = useCelebrations(today);
  if (!list) return null;
  return <article className="hub-card hub-celebrations">
    <div className="hub-panel-title"><div><span><PartyPopper /></span><div><h3>Comemorações</h3><p>Próximos 14 dias</p></div></div><button onClick={onOpenPeople}>Pessoas</button></div>
    {list.length ? <ul className="celebration-list">{list.slice(0, 5).map((entry) => <li key={`${entry.kind}-${entry.memberId}`} className={entry.daysAway === 0 ? "today" : ""}>
      <span className={`celebration-icon ${entry.kind}`}>{entry.kind === "birthday" ? <Cake size={14} /> : <PartyPopper size={14} />}</span>
      <span><b>{entry.name}</b><small>{entry.kind === "birthday" ? "Aniversário" : `${entry.years} ${entry.years === 1 ? "ano" : "anos"} de casa`}</small></span>
      <em>{whenLabel(entry)}</em>
    </li>)}{list.length > 5 && <li className="more">e mais {list.length - 5}</li>}</ul>
      : <p className="hub-calm">Nada nas próximas duas semanas. Cada pessoa pode informar o aniversário e a data de entrada em Pessoas → editar perfil.</p>}
  </article>;
}
