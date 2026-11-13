"use client";

import { useEffect, useState } from "react";
import { MyTasksPanel } from "./tasks-view";
import { MyTicketsPanel } from "./tickets-view";
import LifeBuoy from "lucide-react/icons/life-buoy";
import NoticeBoard from "./notice-board";
import CelebrationsCard from "./celebrations-card";
import { OnboardingCard, useOnboardings } from "./onboarding-view";
import { shoppingList } from "./stock-forecast";
import { monthLabel } from "./people-tools";
import NotebookPen from "lucide-react/icons/notebook-pen";
import VideoIcon from "lucide-react/icons/video";
import { isoToLocal, isTeamsJoinLink } from "./agenda";
import { expandAgenda, useNow, type AgendaEvent } from "./use-agenda";
import { type NavCounts } from "./sidebar-nav";
import ListTodo from "lucide-react/icons/list-todo";
import CalendarOff from "lucide-react/icons/calendar-off";
import { describeAbsence, splitAbsences } from "./absences";
import { useAbsences } from "./use-absences";
import { nextSupportWeek, supportWeekForDate } from "./support-schedule";
import Archive from "lucide-react/icons/archive";
import CalendarClock from "lucide-react/icons/calendar-clock";
import History from "lucide-react/icons/history";
import Plus from "lucide-react/icons/plus";
import Search from "lucide-react/icons/search";
import Sun from "lucide-react/icons/sun";
import Sprout from "lucide-react/icons/sprout";
import ClipboardCheck from "lucide-react/icons/clipboard-check";
import Smile from "lucide-react/icons/smile";
import { type CurrentUser, type Item, type Movement, type Schedule, movementCopy, fmt, toForecast, exactDate, ItemVisual, todayLong, isoDateInSaoPaulo, weekLabel, findTeam } from "./dashboard-shared";

export function HubView({ onOpenReviews, onOpenPulse, items, movements, schedule, currentUser, counts, agenda, onOpenAgenda, onMyDay, onOpen, onOpenTask, onOpenTicket, onNewTask, onNewTicket, onSearch }: { onOpenReviews: () => void; onOpenPulse: () => void; items: Item[]; movements: Movement[]; schedule: Schedule; currentUser: CurrentUser | null; counts: NavCounts | null; agenda: AgendaEvent[]; onOpenAgenda: (eventId?: number) => void; onMyDay: () => void; onOpen: (destination: "stock" | "schedule" | "people" | "calendar") => void; onOpenTask: (taskId?: number) => void; onOpenTicket: (ticketId?: number) => void; onNewTask: () => void; onNewTicket: () => void; onSearch: () => void }) {
  const today = isoDateInSaoPaulo();
  const currentWeek = supportWeekForDate(schedule.weeks, today);
  const nextWeek = nextSupportWeek(schedule.weeks, today);
  const featuredWeek = currentWeek ?? nextWeek;
  const featuredTeam = featuredWeek ? findTeam(schedule, featuredWeek.teamId) : null;
  const hubShopping = shoppingList(items.map(toForecast), today);
  const lowItems = items.filter((item) => hubShopping.some((line) => line.id === item.id));
  const canEdit = currentUser ? currentUser.role !== "viewer" : false;
  const away = useAbsences();
  const absenceGroups = splitAbsences(away.absences, today, 7);
  const nameOf = (id: number) => away.people.find((person) => person.id === id)?.name ?? "Alguém";
  const awayNames = [...new Set(absenceGroups.now.map((absence) => nameOf(absence.memberId)))];

  // Resumo de agora: o que pede atenção primeiro, cada um leva à tela certa.
  const summary = [
    { key: "tasks", icon: <ListTodo />, label: "Minhas demandas", value: counts?.tasks ?? null, detail: counts ? (counts.tasksOverdue ? `${counts.tasksOverdue} com prazo vencido` : "nenhuma vencida") : "carregando…", alert: Boolean(counts?.tasksOverdue), action: () => onOpenTask() },
    { key: "tickets", icon: <LifeBuoy />, label: "Fila de chamados", value: counts?.tickets ?? null, detail: counts ? (counts.ticketsLate ? `${counts.ticketsLate} fora do prazo` : counts.ticketsUnassigned ? `${counts.ticketsUnassigned} sem dono` : "tudo em dia") : "carregando…", alert: Boolean(counts?.ticketsLate), action: () => onOpenTicket() },
    { key: "away", icon: <CalendarOff />, label: "Fora hoje", value: awayNames.length, detail: awayNames.length ? awayNames.slice(0, 2).join(", ") + (awayNames.length > 2 ? ` e mais ${awayNames.length - 2}` : "") : "equipe completa", alert: false, action: () => onOpen("calendar") },
    { key: "stock", icon: <Archive />, label: "Copa: para comprar", value: lowItems.length, detail: lowItems.length ? lowItems.slice(0, 2).map((item) => item.name).join(", ") : "estoque em dia", alert: false, warn: lowItems.length > 0, action: () => onOpen("stock") },
  ];

  return <div className="hub">
    <section className="hub-hero">
      <div>
        
        <h2 className="hub-hero-date">{todayLong()}</h2>
      </div>
      <div className="hub-actions">
        {canEdit && <button className="primary-button" onClick={onNewTask}><Plus size={16} /> Nova demanda</button>}
        {canEdit && <button className="secondary-button" onClick={onNewTicket}><LifeBuoy size={16} /> Abrir chamado</button>}
        <button className="secondary-button" onClick={onMyDay}><Sun size={16} /> Meu dia</button>
        <button className="secondary-button" onClick={onSearch}><Search size={16} /> Buscar <kbd>Ctrl K</kbd></button>
      </div>
    </section>

    <div className="hub-summary">
      {summary.map((tile, index) => <button key={tile.key} className={`hub-stat ${tile.alert ? "is-danger" : "warn" in tile && tile.warn ? "is-warn" : ""}`} style={{ "--i": index } as React.CSSProperties} onClick={tile.action}>
        <span className="hub-stat-body"><small>{tile.label}</small><strong>{tile.value ?? "—"}</strong><em>{tile.detail}</em></span>
        <span className="hub-stat-go" aria-hidden="true">→</span>
      </button>)}
    </div>

    <HubReviews enabled={Boolean(currentUser?.active)} onOpen={onOpenReviews} />
    <HubPulse enabled={Boolean(currentUser?.active)} onOpen={onOpenPulse} />

    <NoticeBoard />

    <HubAgenda events={agenda} today={today} onOpen={onOpenAgenda} />

    <HubOnboarding enabled={Boolean(currentUser?.active)} onOpen={() => onOpen("people")} />

    <h3 className="hub-heading">Meu trabalho</h3>
    <div className="hub-work-grid">
      <MyTasksPanel onOpen={onOpenTask} />
      <MyTicketsPanel onOpen={onOpenTicket} />
    </div>

    <h3 className="hub-heading">Hoje na equipe</h3>
    <div className="hub-team-grid three">
      <article className={`hub-card hub-schedule ${featuredTeam?.color ?? "purple"}`}>
        <div className="hub-panel-title"><div><span><CalendarClock /></span><div><h3>{currentWeek ? "Atendimento desta semana" : "Próximo atendimento"}</h3><p>{featuredWeek ? weekLabel(featuredWeek) : "Escala sem semanas cadastradas"}</p></div></div><button onClick={() => onOpen("schedule")}>Ver escala</button></div>
        {featuredTeam ? <div className="hub-schedule-team"><strong>{featuredTeam.name}</strong><div>{featuredTeam.members.map((member) => <span key={member}>{member}</span>)}</div></div> : <p className="muted">Cadastre as semanas da escala para aparecer aqui.</p>}
      </article>
      <article className="hub-card">
        <div className="hub-panel-title"><div><span><CalendarOff /></span><div><h3>Ausências</h3><p>Hoje e nos próximos 7 dias</p></div></div><button onClick={() => onOpen("calendar")}>Ver calendário</button></div>
        {absenceGroups.now.length || absenceGroups.upcoming.length ? <ul className="hub-away-list">
          {absenceGroups.now.map((absence) => <li key={`n${absence.id}`} className="now"><b>{nameOf(absence.memberId)}</b><span>{describeAbsence(absence, today)}</span><em>Fora hoje</em></li>)}
          {absenceGroups.upcoming.map((absence) => <li key={`u${absence.id}`}><b>{nameOf(absence.memberId)}</b><span>{describeAbsence(absence, today)}</span></li>)}
        </ul> : <p className="hub-calm">Ninguém fora hoje nem nos próximos dias.</p>}
      </article>
      <CelebrationsCard today={today} onOpenPeople={() => onOpen("people")} />
    </div>

    <h3 className="hub-heading">Copa</h3>
    <div className="hub-team-grid">
      <article className="hub-card">
        <div className="hub-panel-title"><div><span><Archive /></span><div><h3>Para comprar</h3><p>{items.length} itens no estoque</p></div></div><button onClick={() => onOpen("stock")}>Abrir estoque</button></div>
        {lowItems.length ? <ul className="hub-restock">{lowItems.slice(0, 4).map((item) => <li key={item.id}><ItemVisual item={item} /><span>{item.name}</span><b>{fmt(item.unopenedQty + item.openedQty)} {item.unit}</b></li>)}{lowItems.length > 4 && <li className="more">e mais {lowItems.length - 4}</li>}</ul> : <p className="hub-calm">Tudo acima do mínimo.</p>}
      </article>
      <article className="hub-card">
        <div className="hub-panel-title"><div><span><History /></span><div><h3>Últimas movimentações</h3><p>Atividade recente da copa</p></div></div></div>
        {movements.length ? movements.slice(0, 3).map((movement) => <div className="hub-activity-row" key={movement.id}><span>{movementCopy[movement.type].label.slice(0, 1)}</span><div><strong>{movementCopy[movement.type].label} · {movement.itemName}</strong><small>{movement.createdByName || "Equipe"} · {exactDate(movement.createdAt)}</small></div><b>{fmt(Math.abs(movement.quantity))} {movement.unit}</b></div>) : <p className="hub-calm">Nenhuma movimentação ainda.</p>}
      </article>
    </div>
  </div>;
}

/** Minha agenda de hoje: o que ainda vai acontecer, com o botão de entrar na reunião. */
function HubAgenda({ events, today, onOpen }: { events: AgendaEvent[]; today: string; onOpen: (eventId?: number) => void }) {
  const now = useNow();
  const dayStart = Date.parse(`${today}T00:00:00-03:00`);
  const list = expandAgenda(events, dayStart, dayStart + 86400000 - 1).filter((event) => !event.done && isoToLocal(event.startsAt).day === today && Date.parse(event.endsAt ?? event.startsAt) + (event.endsAt ? 0 : 30 * 60000) >= now);
  if (!list.length) return <div className="hub-agenda empty"><NotebookPen size={15} /><span>Nada mais na sua agenda hoje.</span><button onClick={() => onOpen()}>Anotar compromisso</button></div>;
  return <article className="hub-card hub-agenda">
    <div className="hub-panel-title"><div><span><NotebookPen /></span><div><h3>Minha agenda de hoje</h3><p>{list.length} {list.length === 1 ? "compromisso" : "compromissos"} pela frente</p></div></div><button onClick={() => onOpen()}>Ver agenda</button></div>
    <ul>{list.slice(0, 4).map((event) => {
      const live = Date.parse(event.startsAt) <= now;
      return <li key={`${event.id}-${event.startsAt}`} className={live ? "live" : ""}>
        <button onClick={() => onOpen(event.id)}><b>{isoToLocal(event.startsAt).time}</b><span>{event.title}</span>{live && <em>agora</em>}</button>
        {event.teamsUrl && isTeamsJoinLink(event.teamsUrl) && <a href={event.teamsUrl} target="_blank" rel="noopener noreferrer" title="Entrar na reunião do Teams"><VideoIcon size={14} /> Entrar</a>}
      </li>;
    })}{list.length > 4 && <li className="more"><button onClick={() => onOpen()}>e mais {list.length - 4}</button></li>}</ul>
  </article>;
}

/** Integração em andamento de quem está logado (como quem chega ou como padrinho). */
function HubOnboarding({ enabled, onOpen }: { enabled: boolean; onOpen: () => void }) {
  const { data, load } = useOnboardings(enabled);
  const meId = data?.me.id ?? null;
  const mine = (data?.onboardings ?? []).filter((row) => row.status === "active" && (row.memberId === meId || row.buddyId === meId));
  if (!data || !mine.length) return null;
  return <section className="hub-onboarding">
    <div className="hub-panel-title"><div><span><Sprout /></span><div><h3>{mine.some((row) => row.memberId === meId) ? "Seus primeiros passos" : "Integração que você acompanha"}</h3><p>Marque os passos conforme forem feitos</p></div></div><button onClick={onOpen}>Ver tudo</button></div>
    <div className="onboarding-grid">{mine.map((row) => <OnboardingCard key={row.id} row={row} people={data.people} isAdmin={false} onChanged={load} compact />)}</div>
  </section>;
}

/** Avaliação aberta com pendências: aviso no topo da visão geral. */
function HubReviews({ enabled, onOpen }: { enabled: boolean; onOpen: () => void }) {
  const [state, setState] = useState<{ title: string; endDate: string; left: number } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void fetch("/api/reviews", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as { cycle: { title: string; endDate: string } | null; pending: { done: boolean }[] };
      const left = data.pending.filter((item) => !item.done).length;
      if (!cancelled) setState(data.cycle && left ? { title: data.cycle.title, endDate: data.cycle.endDate, left } : null);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [enabled]);
  if (!state) return null;
  return <button className="hub-review-banner" onClick={onOpen}>
    <span><ClipboardCheck size={18} /></span>
    <span><strong>{state.title}: faltam {state.left} avaliaç{state.left === 1 ? "ão" : "ões"}</strong><small>Anônimo · até {new Date(`${state.endDate}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC" })}</small></span>
    <em>Avaliar →</em>
  </button>;
}

/** Pesquisa de clima do mês ainda sem a resposta de quem está logado. */
function HubPulse({ enabled, onOpen }: { enabled: boolean; onOpen: () => void }) {
  const [month, setMonth] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void fetch("/api/pulse", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as { current: { month: string; answered: boolean } | null };
      if (!cancelled) setMonth(data.current && !data.current.answered ? data.current.month : null);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [enabled]);
  if (!month) return null;
  return <button className="hub-review-banner pulse" onClick={onOpen}>
    <span><Smile size={18} /></span>
    <span><strong>Pesquisa de clima de {monthLabel(month)}</strong><small>3 perguntas, 1 minuto, anônima</small></span>
    <em>Responder →</em>
  </button>;
}
