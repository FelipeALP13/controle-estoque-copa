"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Cake from "lucide-react/icons/cake";
import CalendarClock from "lucide-react/icons/calendar-clock";
import CalendarOff from "lucide-react/icons/calendar-off";
import Maximize from "lucide-react/icons/maximize";
import PartyPopper from "lucide-react/icons/party-popper";
import Repeat from "lucide-react/icons/repeat-2";
import ServerCrash from "lucide-react/icons/server-crash";
import { compareTickets, formatMinutes, isTicketLate, resolutionStatus, slaStatus, ticketCode, ticketStatusLabels, ticketUrgencyLabels, type TicketStatus, type TicketUrgency } from "./tickets";
import { celebrationText, type Celebration } from "./team-tools";
import { APP_NAME } from "./brand";

type TvTicket = { id: number; title: string; urgency: TicketUrgency; status: TicketStatus; client: string; teamId: number | null; assigneeId: number | null; assigneeName: string | null; externalKey: string | null; createdAt: string; firstResponseAt: string | null; resolvedAt: string | null };
type Week = { start: string; end: string; note: string; teamName: string; color: string; members: string[] } | null;
type Data = { now: string; today: string; teamId: number | null; teams: { id: number; name: string; color: string }[]; tickets: TvTicket[]; openedToday: number; resolvedToday: number; onCall: Week; nextOnCall: Week; away: string[]; celebrations: Celebration[]; handoff: { teamName: string; body: string; createdByName: string; createdAt: string } | null; systemsDown?: { name: string; clientName: string; since: string | null }[] };

const REFRESH_MS = 30000;
const shortDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC", day: "2-digit", month: "2-digit" });

/** Prazo que importa agora: primeira resposta (se ainda não houve) ou solução. */
function deadline(ticket: TvTicket, now: Date) {
  const sla = slaStatus(ticket, now);
  if (sla.state === "ok" || sla.state === "warning" || sla.state === "breached") return { state: sla.state, text: sla.state === "breached" ? `Resposta atrasada ${formatMinutes(-sla.minutesLeft)}` : `Responder em ${formatMinutes(sla.minutesLeft)}` };
  const solve = resolutionStatus(ticket, now);
  if (!solve) return null;
  return { state: solve.state, text: solve.state === "breached" ? `Solução atrasada ${formatMinutes(-solve.minutesLeft)}` : `Resolver em ${formatMinutes(solve.minutesLeft)}` };
}

export default function TvBoard() {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [team, setTeam] = useState<string | null>(null);
  const [clock, setClock] = useState(() => new Date());
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  // Time escolhido fica no endereço (?team=), para a TV abrir sempre igual.
  useEffect(() => {
    const timer = window.setTimeout(() => setTeam(new URLSearchParams(window.location.search).get("team") ?? ""), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const load = useCallback(async () => {
    if (team === null) return;
    try {
      const response = await fetch(`/api/tv${team ? `?team=${encodeURIComponent(team)}` : ""}`, { cache: "no-store" });
      if (response.status === 401) { router.replace("/"); return; }
      const json = await response.json() as Data & { error?: string };
      if (!response.ok) throw new Error(json.error || "Não foi possível carregar.");
      setData(json);
      setError("");
      setUpdatedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sem conexão. Tentando de novo…");
    }
  }, [team, router]);

  useEffect(() => {
    const first = window.setTimeout(() => { void load(); }, 0);
    const interval = window.setInterval(() => { void load(); }, REFRESH_MS);
    return () => { window.clearTimeout(first); window.clearInterval(interval); };
  }, [load]);
  useEffect(() => {
    const interval = window.setInterval(() => setClock(new Date()), 10000);
    return () => window.clearInterval(interval);
  }, []);

  function chooseTeam(value: string) {
    setTeam(value);
    const url = new URL(window.location.href);
    if (value) url.searchParams.set("team", value); else url.searchParams.delete("team");
    window.history.replaceState(null, "", url);
  }

  const tickets = [...(data?.tickets ?? [])].sort(compareTickets);
  const late = tickets.filter((ticket) => isTicketLate(ticket, clock));
  const stats = [
    { label: "Abertos", value: tickets.filter((ticket) => ticket.status === "open").length, hint: "esperando alguém assumir" },
    { label: "Em atendimento", value: tickets.filter((ticket) => ticket.status === "in_progress").length, hint: "com alguém trabalhando" },
    { label: "Aguardando", value: tickets.filter((ticket) => ticket.status === "waiting").length, hint: "esperando retorno" },
    { label: "Fora do prazo", value: late.length, hint: "sem resposta ou solução no prazo", tone: late.length ? "danger" : "" },
    { label: "Abertos hoje", value: data?.openedToday ?? 0, hint: "chamados novos" },
    { label: "Resolvidos hoje", value: data?.resolvedToday ?? 0, hint: "encerrados hoje", tone: "good" },
  ];
  const teamName = data?.teamId ? data.teams.find((entry) => entry.id === data.teamId)?.name ?? "Time" : "Todos os times";
  const shown = tickets.slice(0, 12);

  return <div className="tv">
    <header className="tv-head">
      <div><p>{APP_NAME}</p><h1>Fila de chamados · {teamName}</h1></div>
      <div className="tv-controls">
        {data && <select aria-label="Time" value={team || (data.teamId ? String(data.teamId) : "all")} onChange={(event) => chooseTeam(event.target.value)}>
          <option value="all">Todos os times</option>
          {data.teams.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select>}
        <button onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.(); }} title="Tela cheia (F11 também funciona)"><Maximize size={18} /> Tela cheia</button>
      </div>
      <div className="tv-clock"><strong>{clock.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}</strong><span>{clock.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "long" })}</span></div>
    </header>

    {error && <p className="tv-error">{error}</p>}

    <section className="tv-stats">
      {stats.map((stat) => <article key={stat.label} className={stat.tone ?? ""}><small>{stat.label}</small><strong>{data ? stat.value : "—"}</strong><span>{stat.hint}</span></article>)}
    </section>

    <div className="tv-main">
      <section className="tv-queue">
        <h2>Na fila agora {tickets.length > shown.length && <small>mostrando {shown.length} de {tickets.length}</small>}</h2>
        {!data ? <p className="tv-empty">Carregando…</p> : shown.length ? <ol>
          {shown.map((ticket) => {
            const due = deadline(ticket, clock);
            return <li key={ticket.id} className={`tv-ticket urgency-${ticket.urgency} ${isTicketLate(ticket, clock) ? "late" : ""}`}>
              <span className="tv-code">{ticket.externalKey ?? ticketCode(ticket.id)}</span>
              <span className="tv-title"><b>{ticket.title}</b><small>{ticketUrgencyLabels[ticket.urgency]}{ticket.client ? ` · ${ticket.client}` : ""}</small></span>
              <span className={`tv-status ${ticket.status}`}>{ticketStatusLabels[ticket.status]}</span>
              <span className="tv-owner">{ticket.assigneeName ? ticket.assigneeName.split(" ").slice(0, 2).join(" ") : <em>sem dono</em>}</span>
              <span className={`tv-due ${due?.state ?? ""}`}>{due?.text ?? ""}</span>
            </li>;
          })}
        </ol> : <p className="tv-empty">Nenhum chamado em aberto. 🎉</p>}
      </section>

      <aside className="tv-side">
        {data?.systemsDown && data.systemsDown.length > 0 && <section className="tv-card tv-down">
          <h3><ServerCrash size={18} /> Fora do ar</h3>
          <ul>{data.systemsDown.map((system) => <li key={`${system.clientName}-${system.name}`}><b>{system.clientName}</b> · {system.name}{system.since ? <small> desde {new Date(system.since).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}</small> : null}</li>)}</ul>
        </section>}
        <section className={`tv-card tv-oncall ${data?.onCall?.color ?? "purple"}`}>
          <h3><CalendarClock size={18} /> {data?.onCall ? "De plantão nesta semana" : "Próximo plantão"}</h3>
          {(data?.onCall ?? data?.nextOnCall) ? (() => { const week = (data?.onCall ?? data?.nextOnCall)!; return <>
            <strong>{week.teamName}</strong>
            <small>{shortDate(week.start)} a {shortDate(week.end)}{week.note ? ` · ${week.note}` : ""}</small>
            <ul>{week.members.map((name) => <li key={name} className={data?.away.some((away) => away.toLocaleLowerCase("pt-BR").startsWith(name.toLocaleLowerCase("pt-BR").replace(/\.$/, ""))) ? "away" : ""}>{name}</li>)}</ul>
          </>; })() : <p>Escala sem semanas cadastradas.</p>}
          {data?.onCall && data.nextOnCall && <p className="tv-next">Depois: <b>{data.nextOnCall.teamName}</b> a partir de {shortDate(data.nextOnCall.start)}</p>}
        </section>

        <section className="tv-card">
          <h3><CalendarOff size={18} /> Fora hoje</h3>
          {data?.away.length ? <p className="tv-names">{data.away.join(", ")}</p> : <p className="tv-muted">Equipe completa.</p>}
        </section>

        {data && data.celebrations.length > 0 && <section className="tv-card tv-party">
          <h3><PartyPopper size={18} /> Comemorações</h3>
          <ul>{data.celebrations.slice(0, 4).map((entry) => <li key={`${entry.kind}-${entry.memberId}`} className={entry.daysAway === 0 ? "today" : ""}>{entry.kind === "birthday" ? <Cake size={15} /> : <PartyPopper size={15} />} {celebrationText(entry)}</li>)}</ul>
        </section>}

        {data?.handoff && <section className="tv-card">
          <h3><Repeat size={18} /> Última passagem de plantão</h3>
          <p className="tv-handoff">{data.handoff.body}</p>
          <small className="tv-muted">{data.handoff.createdByName}{data.handoff.teamName ? ` · ${data.handoff.teamName}` : ""}</small>
        </section>}
      </aside>
    </div>

    <footer className="tv-foot">Atualiza sozinha a cada 30 segundos{updatedAt ? ` · última às ${updatedAt.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : ""}</footer>
  </div>;
}
