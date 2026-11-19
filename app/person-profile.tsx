"use client";

// Perfil da pessoa como página (painel lateral): foto grande, cargo, times, contato, ausências,
// datas, elogios e (para a própria pessoa ou administradores) o mapa de calor da atividade.
import { useEffect } from "react";
import { createPortal } from "react-dom";
import BriefcaseBusiness from "lucide-react/icons/briefcase-business";
import Cake from "lucide-react/icons/cake";
import CalendarOff from "lucide-react/icons/calendar-off";
import Mail from "lucide-react/icons/mail";
import Pencil from "lucide-react/icons/pencil";
import Phone from "lucide-react/icons/phone";
import X from "lucide-react/icons/x";
import { Avatar, TeamChip } from "./tasks-view";
import { describeAbsence, type Absence } from "./absences";
import { PersonKudos } from "./team-wall";
import { ActivityHeatmap } from "./activity-heatmap";
import type { Person, Team } from "./people-view";

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function PersonProfile({ person, memberships, absences, today, isMe, isAdmin, kudosCount, onEdit, onClose }: {
  person: Person; memberships: { team: Team; isLead: boolean }[]; absences: Absence[]; today: string; isMe: boolean; isAdmin: boolean; kudosCount: number;
  onEdit?: () => void; onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const upcoming = absences.filter((absence) => absence.memberId === person.id && absence.endDate >= today).sort((a, b) => a.startDate.localeCompare(b.startDate)).slice(0, 4);
  const awayNow = upcoming.find((absence) => absence.startDate <= today);
  const years = person.startedOn ? Number(today.slice(0, 4)) - Number(person.startedOn.slice(0, 4)) - (today.slice(5) < person.startedOn.slice(5) ? 1 : 0) : null;
  const firstName = person.name.split(/\s+/)[0];

  return createPortal(<div className="modal-layer profile-layer">
    <button className="backdrop" onClick={onClose} aria-label="Fechar perfil" />
    <aside className="person-profile" role="dialog" aria-modal="true" aria-labelledby="profile-name">
      <header className="profile-cover">
        <button type="button" className="profile-close" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        <Avatar member={person} size={88} />
        <h2 id="profile-name">{person.name}{isMe && <small> (você)</small>}</h2>
        <p>{person.jobTitle || "Cargo não informado"}</p>
        <div className="profile-status">
          {!person.active && <span className="person-inactive">Desativado</span>}
          {awayNow ? <span className="person-away">{describeAbsence(awayNow, today)}</span> : person.active && <span className="profile-here">Disponível hoje</span>}
        </div>
        <div className="profile-actions">
          <a className="secondary-button" href={`mailto:${person.email}`}><Mail size={15} /> E-mail</a>
          {person.phone && <a className="secondary-button" href={`tel:${person.phone.replace(/[^\d+]/g, "")}`}><Phone size={15} /> Ligar</a>}
          {onEdit && <button type="button" className="secondary-button" onClick={onEdit}><Pencil size={15} /> Editar</button>}
        </div>
      </header>

      <div className="profile-body">
        <section>
          <h3>Times</h3>
          <div className="person-teams">{memberships.length ? memberships.map(({ team, isLead }) => <TeamChip key={team.id} team={team} lead={isLead} />) : <span className="person-noteam">Sem time</span>}</div>
        </section>

        <section>
          <h3>Contato</h3>
          <dl className="profile-facts">
            <div><dt>E-mail</dt><dd><a href={`mailto:${person.email}`}>{person.email}</a></dd></div>
            {person.phone && <div><dt>Telefone</dt><dd><a href={`tel:${person.phone.replace(/[^\d+]/g, "")}`}>{person.phone}</a></dd></div>}
            {person.birthday && <div><dt><Cake size={13} /> Aniversário</dt><dd>{Number(person.birthday.slice(3))} de {MONTHS[Number(person.birthday.slice(0, 2)) - 1]}</dd></div>}
            {years !== null && <div><dt><BriefcaseBusiness size={13} /> Na empresa</dt><dd>{years >= 1 ? `${years} ${years === 1 ? "ano" : "anos"} de casa` : "Chegou este ano"}</dd></div>}
          </dl>
        </section>

        <section>
          <h3>Férias e ausências</h3>
          {upcoming.length ? <ul className="profile-absences">{upcoming.map((absence) => <li key={absence.id}><CalendarOff size={14} />{describeAbsence(absence, today)}</li>)}</ul> : <p className="muted">Nenhuma ausência marcada.</p>}
        </section>

        {kudosCount > 0 && <section>
          <h3>Elogios</h3>
          <PersonKudos memberId={person.id} count={kudosCount} />
        </section>}

        {(isMe || isAdmin) && person.active && <section>
          <ActivityHeatmap memberId={isMe ? undefined : person.id} title={isMe ? "Sua atividade no último ano" : `Atividade de ${firstName} no último ano`} />
        </section>}
      </div>
    </aside>
  </div>, document.body);
}
