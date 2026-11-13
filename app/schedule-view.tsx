"use client";

import { useState } from "react";
import CalendarOff from "lucide-react/icons/calendar-off";
import { absentInSchedule, describeAbsence } from "./absences";
import { useAbsences } from "./use-absences";
import { nextSupportWeek, supportWeekForDate, type SupportTeam, type SupportWeek } from "./support-schedule";
import CalendarClock from "lucide-react/icons/calendar-clock";
import HandoffPanel from "./handoff-panel";
import Pencil from "lucide-react/icons/pencil";
import Plus from "lucide-react/icons/plus";
import Sparkles from "lucide-react/icons/sparkles";
import UserPlus from "lucide-react/icons/user-plus";
import { type Schedule, isoDateInSaoPaulo, scheduleDate, weekLabel, findTeam, scheduleRangeLabel, LoadingRows } from "./dashboard-shared";

export function ScheduleView({ schedule, loading, canEdit, onNewTeam, onEditTeam, onNewWeek, onEditWeek, onGenerate }: { schedule: Schedule; loading: boolean; canEdit: boolean; onNewTeam: () => void; onEditTeam: (team: SupportTeam) => void; onNewWeek: () => void; onEditWeek: (week: SupportWeek) => void; onGenerate: () => void }) {
  const [showPast, setShowPast] = useState(false);
  const away = useAbsences();
  if (loading) return <LoadingRows />;
  const today = isoDateInSaoPaulo();
  // Quem da equipe estará de férias/folga no período da semana.
  const absentIn = (week: Pick<SupportWeek, "start" | "end">, team: SupportTeam) => absentInSchedule(team.members, away.people, away.absences, week.start, week.end);
  const weeks = [...schedule.weeks].sort((a, b) => a.start.localeCompare(b.start));
  const currentWeek = supportWeekForDate(weeks, today);
  const nextWeek = nextSupportWeek(weeks, today);
  const highlightedWeek = currentWeek ?? nextWeek ?? weeks.at(-1) ?? null;
  const highlightedTeam = highlightedWeek ? findTeam(schedule, highlightedWeek.teamId) : null;
  const pastWeeks = weeks.filter((week) => week.end < today);
  const visibleWeeks = showPast ? weeks : weeks.filter((week) => week.end >= today);

  return (
    <>
      {canEdit && <div className="schedule-toolbar">
        <div><strong>Edição da escala</strong><small>As mudanças aparecem para toda a equipe na hora.</small></div>
        <div className="schedule-toolbar-actions">
          <button className="secondary-button" onClick={onNewTeam}><UserPlus size={16} /> Nova equipe</button>
          <button className="secondary-button" disabled={!schedule.teams.length} onClick={onGenerate}><Sparkles size={16} /> Gerar semanas</button>
          <button className="primary-button" disabled={!schedule.teams.length} onClick={onNewWeek}><Plus size={16} /> Nova semana</button>
        </div>
      </div>}

      {highlightedWeek && highlightedTeam ? <section className={`schedule-hero ${highlightedTeam.color}`}>
        <div className="schedule-hero-copy">
          <p className="eyebrow">{currentWeek ? "ATENDIMENTO DE HOJE" : nextWeek ? "PRÓXIMO ATENDIMENTO" : "ÚLTIMO PERÍODO DA ESCALA"}</p>
          <h2>{highlightedTeam.name}</h2>
          <p>{currentWeek ? `Responsável pela semana de ${weekLabel(highlightedWeek)}.` : nextWeek ? `A próxima escala começa em ${scheduleDate(highlightedWeek.start, { weekday: "long", day: "2-digit", month: "long" })}.` : `A escala cadastrada terminou em ${scheduleDate(highlightedWeek.end, { day: "2-digit", month: "long" })}. Cadastre as próximas semanas.`}</p>
          {highlightedWeek.note && <p className="schedule-hero-note">{highlightedWeek.note}</p>}
          <div className="schedule-member-list">{highlightedTeam.members.map((member) => <span key={member}>{member}</span>)}</div>
          {absentIn(highlightedWeek, highlightedTeam).map(({ name, absence }) => <p key={name} className="schedule-away"><CalendarOff size={14} /> {name}: {describeAbsence(absence, today).toLowerCase()}. Combine quem cobre.</p>)}

        </div>
        <div className="schedule-hero-date"><CalendarClock /><small>{currentWeek ? "Semana atual" : nextWeek ? "Próxima semana" : "Último período"}</small><strong>{weekLabel(highlightedWeek)}</strong><span>Escala {highlightedWeek.start.slice(0, 4)}</span></div>
      </section> : <div className="empty-state"><span><CalendarClock /></span><h3>Nenhuma semana cadastrada</h3><p>{canEdit ? (schedule.teams.length ? "Cadastre uma semana ou gere várias de uma vez com o rodízio das equipes." : "Comece criando as equipes de atendimento.") : "A escala ainda não foi preenchida. Fale com um administrador."}</p></div>}

      {weeks.length > 0 && <HandoffPanel />}

      {schedule.teams.length > 0 && <div className="schedule-teams">
        {schedule.teams.map((team) => <article key={team.id} className={`schedule-team-card ${team.color}`}>
          <div><span className="schedule-team-dot" /><div><small>Time de atendimento</small><strong>{team.name}</strong></div>{canEdit && <button className="schedule-edit-button" onClick={() => onEditTeam(team)} aria-label={`Editar ${team.name}`} title="Editar equipe"><Pencil size={14} /></button>}</div>
          <ul>{team.members.map((member) => <li key={member}>{member}</li>)}</ul>
        </article>)}
      </div>}

      {weeks.length > 0 && <>
        <div className="section-heading schedule-title"><div><h2>{showPast ? "Todas as semanas" : "Próximas semanas"}</h2><p>Dias fora dos períodos cadastrados ficam sem atendimento.</p></div><div className="schedule-title-actions">{pastWeeks.length > 0 && <button className="schedule-past-toggle" onClick={() => setShowPast((value) => !value)}>{showPast ? "Ocultar concluídas" : `Ver concluídas (${pastWeeks.length})`}</button>}<span className="schedule-year">{scheduleRangeLabel(weeks)}</span></div></div>
        {visibleWeeks.length ? <div className="schedule-weeks">
          {visibleWeeks.map((week) => {
            const team = findTeam(schedule, week.teamId);
            const state = week.id === currentWeek?.id ? "current" : week.end < today ? "past" : "upcoming";
            return <article key={week.id} className={`schedule-week ${team?.color ?? "purple"} ${state}`}>
              <div className="schedule-week-date"><small>{scheduleDate(week.start, { month: "short" }).replace(".", "")}</small><strong>{scheduleDate(week.start, { day: "2-digit" })}</strong></div>
              <div><span>{state === "current" ? "Esta semana" : state === "past" ? "Concluída" : "Programada"}</span><h3>{team?.name ?? "Equipe removida"}</h3><p>{weekLabel(week)}{week.note ? ` · ${week.note}` : ""}</p></div>
              <div className="schedule-week-side">
                <div className="schedule-week-members">{team?.members.map((member) => { const out = absentIn(week, team).find((entry) => entry.name === member); return <span key={member} className={out ? "away" : ""} title={out ? describeAbsence(out.absence, today) : undefined}>{member}{out && <CalendarOff size={11} />}</span>; })}</div>
                {canEdit && <button className="schedule-edit-button" onClick={() => onEditWeek(week)} aria-label={`Editar semana de ${weekLabel(week)}`} title="Editar semana"><Pencil size={14} /></button>}
              </div>
            </article>;
          })}
        </div> : <div className="empty-state compact"><CalendarClock /><h3>Nenhuma semana futura</h3><p>{canEdit ? "Use “Gerar semanas” para continuar o rodízio." : "As próximas semanas ainda não foram cadastradas."}</p></div>}
      </>}
    </>
  );
}
