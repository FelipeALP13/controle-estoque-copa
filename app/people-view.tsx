"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Mail from "lucide-react/icons/mail";
import Pencil from "lucide-react/icons/pencil";
import Phone from "lucide-react/icons/phone";
import Plus from "lucide-react/icons/plus";
import Search from "lucide-react/icons/search";
import Trash2 from "lucide-react/icons/trash-2";
import Users from "lucide-react/icons/users";
import Cake from "lucide-react/icons/cake";
import BriefcaseBusiness from "lucide-react/icons/briefcase-business";
import X from "lucide-react/icons/x";
import { Avatar, TeamChip } from "./tasks-view";
import { teamColorLabels, teamColors, type TeamColor } from "./teams";
import AbsencesView from "./absences-view";
import { absenceOn, describeAbsence } from "./absences";
import { useAbsences } from "./use-absences";

export type Person = { id: number; name: string; email: string; role: "admin" | "member" | "viewer"; active: boolean; avatarIcon: string; avatarKey: string | null; jobTitle: string; phone: string; birthday?: string | null; startedOn?: string | null };

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const birthdayLabel = (value: string) => `${Number(value.slice(3))} de ${MONTHS[Number(value.slice(0, 2)) - 1]}`;
function yearsSince(startedOn: string, today: string) {
  let years = Number(today.slice(0, 4)) - Number(startedOn.slice(0, 4));
  if (today.slice(5) < startedOn.slice(5)) years -= 1;
  return years;
}
export type Team = { id: number; name: string; color: TeamColor; description: string; members: { memberId: number; isLead: boolean }[] };
type PeopleData = { people: Person[]; teams: Team[]; me: { id: number; isAdmin: boolean } };

async function post(payload: Record<string, unknown>) {
  const response = await fetch("/api/people", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json() as { error?: string };
  if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
}

const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");

export default function PeopleView({ initialSearch = "" }: { initialSearch?: string }) {
  const [data, setData] = useState<PeopleData | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"people" | "teams" | "absences">("people");
  const { absences } = useAbsences();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const [search, setSearch] = useState(initialSearch);
  const [teamFilter, setTeamFilter] = useState("");
  const [editingPerson, setEditingPerson] = useState<Person | null>(null);
  const [editingTeam, setEditingTeam] = useState<Team | "new" | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/people", { cache: "no-store" });
      const json = await response.json() as PeopleData & { error?: string };
      if (!response.ok) throw new Error(json.error || "Não foi possível carregar as pessoas.");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar as pessoas.");
    }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  const teamsOf = useCallback((personId: number) => (data?.teams ?? []).flatMap((team) => {
    const row = team.members.find((entry) => entry.memberId === personId);
    return row ? [{ team, isLead: row.isLead }] : [];
  }), [data]);

  const people = useMemo(() => {
    if (!data) return [];
    const query = fold(search.trim());
    return data.people.filter((person) => {
      if (teamFilter === "none" && teamsOf(person.id).length) return false;
      if (teamFilter && teamFilter !== "none" && !teamsOf(person.id).some(({ team }) => team.id === Number(teamFilter))) return false;
      return !query || fold(`${person.name} ${person.jobTitle} ${person.email}`).includes(query);
    });
  }, [data, search, teamFilter, teamsOf]);

  if (!data) return error ? <div className="alert error"><span>{error}</span></div> : <div className="loading-list">{[1, 2, 3].map((line) => <span key={line} />)}</div>;

  return <div className="people-page">
    <div className="people-toolbar">
      <div className="tasks-scope" role="tablist" aria-label="Seções">
        <button role="tab" aria-selected={tab === "people"} className={tab === "people" ? "active" : ""} onClick={() => setTab("people")}>Pessoas <b className="count">{data.people.filter((person) => person.active).length}</b></button>
        <button role="tab" aria-selected={tab === "teams"} className={tab === "teams" ? "active" : ""} onClick={() => setTab("teams")}>Times <b className="count">{data.teams.length}</b></button>
        <button role="tab" aria-selected={tab === "absences"} className={tab === "absences" ? "active" : ""} onClick={() => setTab("absences")}>Férias e ausências{absences.some((absence) => absence.startDate <= today && absence.endDate >= today) && <b className="count">{new Set(absences.filter((absence) => absence.startDate <= today && absence.endDate >= today).map((absence) => absence.memberId)).size}</b>}</button>
      </div>
      {tab === "absences" ? null : tab === "people" ? <>
        <label className="tasks-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome, cargo ou e-mail" /></label>
        <select aria-label="Filtrar por time" value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}>
          <option value="">Todos os times</option>
          {data.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          <option value="none">Sem time</option>
        </select>
      </> : data.me.isAdmin && <button className="primary-button people-new" onClick={() => setEditingTeam("new")}><Plus size={16} /> Novo time</button>}
    </div>

    {error && <div className="alert error"><span>{error}</span><button onClick={() => setError("")} aria-label="Fechar aviso"><X size={16} /></button></div>}

    {tab === "absences" ? <AbsencesView people={data.people} /> : tab === "people" ? (
      people.length ? <div className="people-grid">
        {people.map((person) => {
          const memberships = teamsOf(person.id);
          const canEdit = data.me.isAdmin || person.id === data.me.id;
          return <article key={person.id} className={`person-card ${person.active ? "" : "inactive"}`}>
            <div className="person-head">
              <Avatar member={person} size={44} />
              <div><strong>{person.name}{person.id === data.me.id && <small> (você)</small>}</strong><span>{person.jobTitle || <em>Cargo não informado</em>}</span></div>
              {canEdit && <button className="person-edit" onClick={() => setEditingPerson(person)} aria-label={`Editar ${person.name}`} title="Editar"><Pencil size={14} /></button>}
            </div>
            <div className="person-teams">{memberships.length ? memberships.map(({ team, isLead }) => <TeamChip key={team.id} team={team} lead={isLead} />) : <span className="person-noteam">Sem time</span>}{!person.active && <span className="person-inactive">Desativado</span>}{(() => { const away = absenceOn(absences, person.id, today); return away ? <span className="person-away">{describeAbsence(away, today)}</span> : null; })()}</div>
            <div className="person-contact">
              <a href={`mailto:${person.email}`}><Mail size={13} />{person.email}</a>
              {person.phone && <a href={`tel:${person.phone.replace(/[^\d+]/g, "")}`}><Phone size={13} />{person.phone}</a>}
            </div>
            {(person.birthday || person.startedOn) && <p className="person-dates">{person.birthday && <span><Cake size={12} /> {birthdayLabel(person.birthday)}</span>}{person.startedOn && <span><BriefcaseBusiness size={12} /> {(() => { const years = yearsSince(person.startedOn, today); return years >= 1 ? `${years} ${years === 1 ? "ano" : "anos"} de casa` : "Chegou este ano"; })()}</span>}</p>}
          </article>;
        })}
      </div> : <div className="empty-state compact"><Search /><h3>Ninguém encontrado</h3><p>Ajuste a busca ou o filtro de time.</p></div>
    ) : (
      data.teams.length ? <div className="teams-grid">
        {data.teams.map((team) => {
          const roster = team.members.map((row) => ({ ...row, person: data.people.find((person) => person.id === row.memberId) })).filter((row) => row.person?.active);
          const leads = roster.filter((row) => row.isLead);
          return <article key={team.id} className={`team-card ${team.color}`}>
            <div className="team-card-head"><span className="team-dot" /><div><strong>{team.name}</strong><small>{roster.length} {roster.length === 1 ? "pessoa" : "pessoas"}</small></div>{data.me.isAdmin && <button className="person-edit" onClick={() => setEditingTeam(team)} aria-label={`Editar ${team.name}`} title="Editar time"><Pencil size={14} /></button>}</div>
            {team.description && <p className="team-description">{team.description}</p>}
            <p className="team-leads"><span>Liderança</span>{leads.length ? leads.map((row) => row.person!.name).join(", ") : "Não definida"}</p>
            <div className="team-roster">{roster.length ? roster.map((row) => <span key={row.memberId} className="team-roster-person" title={`${row.person!.name}${row.isLead ? " (líder)" : ""}`}><Avatar member={row.person} size={26} />{row.isLead && <i className="lead-dot" />}</span>) : <span className="person-noteam">{data.me.isAdmin ? "Edite o time para adicionar pessoas." : "Ninguém neste time ainda."}</span>}</div>
          </article>;
        })}
      </div> : <div className="empty-state"><span><Users /></span><h3>Nenhum time cadastrado</h3><p>{data.me.isAdmin ? "Crie os times da empresa para organizar pessoas, demandas e chamados." : "Os administradores ainda não cadastraram os times."}</p></div>
    )}

    {editingPerson && <PersonModal person={editingPerson} teams={data.teams} isAdmin={data.me.isAdmin} currentTeamIds={teamsOf(editingPerson.id).map(({ team }) => team.id)} onClose={() => setEditingPerson(null)} onSaved={async () => { setEditingPerson(null); await load(); }} />}
    {editingTeam && <TeamModal team={editingTeam === "new" ? null : editingTeam} people={data.people.filter((person) => person.active)} onClose={() => setEditingTeam(null)} onSaved={async () => { setEditingTeam(null); await load(); }} />}
  </div>;
}

function PersonModal({ person, teams, isAdmin, currentTeamIds, onClose, onSaved }: { person: Person; teams: Team[]; isAdmin: boolean; currentTeamIds: number[]; onClose: () => void; onSaved: () => void }) {
  const [jobTitle, setJobTitle] = useState(person.jobTitle);
  const [phone, setPhone] = useState(person.phone);
  const [teamIds, setTeamIds] = useState<number[]>(currentTeamIds);
  const [birthDay, setBirthDay] = useState(person.birthday ? String(Number(person.birthday.slice(3))) : "");
  const [birthMonth, setBirthMonth] = useState(person.birthday ? String(Number(person.birthday.slice(0, 2))) : "");
  const [startedOn, setStartedOn] = useState(person.startedOn ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (Boolean(birthDay) !== Boolean(birthMonth)) throw new Error("Escolha o dia e o mês do aniversário (ou deixe os dois vazios).");
      const birthday = birthDay && birthMonth ? `${birthMonth.padStart(2, "0")}-${birthDay.padStart(2, "0")}` : null;
      await post({ action: "updatePerson", memberId: person.id, jobTitle, phone, birthday, startedOn: startedOn || null, ...(isAdmin ? { teamIds } : {}) });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
      setSaving(false);
    }
  }

  return <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><form className="modal" onSubmit={submit}>
    <div className="modal-head"><div><p className="eyebrow">PESSOAS</p><h2>{person.name}</h2><p>Cargo e contato aparecem no diretório para toda a empresa.</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
    <div className="form-grid">
      <label><span>Cargo</span><input autoFocus maxLength={60} value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} placeholder="Ex.: Analista de Suporte" /></label>
      <label><span>Telefone ou ramal</span><input maxLength={30} value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Ex.: (11) 98765-4321" inputMode="tel" /></label>
      <label><span>Aniversário <em>opcional, sem o ano</em></span><span className="birthday-pick"><select aria-label="Dia" value={birthDay} onChange={(event) => setBirthDay(event.target.value)}><option value="">Dia</option>{Array.from({ length: 31 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select><select aria-label="Mês" value={birthMonth} onChange={(event) => setBirthMonth(event.target.value)}><option value="">Mês</option>{MONTHS.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}</select></span></label>
      <label><span>Na empresa desde <em>opcional</em></span><input type="date" max={new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date())} value={startedOn} onChange={(event) => setStartedOn(event.target.value)} /></label>
      <p className="full form-hint">A equipe recebe um aviso no sino no dia do aniversário e quando você completa mais um ano de casa.</p>
      {isAdmin && <div className="full generate-teams"><span className="field-label">Times</span><div>{teams.map((team) => <label key={team.id} className={`generate-team ${team.color}`}><input type="checkbox" checked={teamIds.includes(team.id)} onChange={(event) => setTeamIds((current) => event.target.checked ? [...current, team.id] : current.filter((id) => id !== team.id))} /><i />{team.name}</label>)}</div><small className="form-hint">Para definir quem lidera, edite o time na aba Times.</small></div>}
    </div>
    {error && <p className="modal-error">{error}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={saving}>{saving ? "Salvando..." : "Salvar"}</button></div>
  </form></div>;
}

function TeamModal({ team, people, onClose, onSaved }: { team: Team | null; people: Person[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(team?.name ?? "");
  const [color, setColor] = useState<TeamColor>(team?.color ?? "blue");
  const [description, setDescription] = useState(team?.description ?? "");
  const [roster, setRoster] = useState<Map<number, boolean>>(new Map((team?.members ?? []).map((row) => [row.memberId, row.isLead])));
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function toggle(personId: number, checked: boolean) {
    setRoster((current) => { const next = new Map(current); if (checked) next.set(personId, false); else next.delete(personId); return next; });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await post({ action: "saveTeam", teamId: team?.id, name, color, description, members: [...roster].map(([memberId, isLead]) => ({ memberId, isLead })) });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar o time.");
      setSaving(false);
    }
  }

  async function remove() {
    if (!team || !window.confirm(`Excluir o time ${team.name}? As pessoas continuam no sistema, e as demandas deste time ficam sem time.`)) return;
    try { await post({ action: "deleteTeam", teamId: team.id }); onSaved(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível excluir."); }
  }

  const visible = people.filter((person) => !filter || fold(`${person.name} ${person.jobTitle}`).includes(fold(filter)));

  return <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><form className="modal" onSubmit={submit}>
    <div className="modal-head"><div><p className="eyebrow">TIMES</p><h2>{team ? "Editar time" : "Novo time"}</h2><p>Defina quem faz parte do time e quem lidera.</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
    <div className="form-grid">
      <label><span>Nome do time</span><input autoFocus required maxLength={40} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Suporte" /></label>
      <label><span>Descrição <em>opcional</em></span><input maxLength={200} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="O que este time faz" /></label>
      <div className="full team-color-field"><span className="field-label">Cor</span><div className="team-color-options">{teamColors.map((option) => <button type="button" key={option} className={`team-color-swatch ${option} ${color === option ? "active" : ""}`} onClick={() => setColor(option)} aria-pressed={color === option}><i />{teamColorLabels[option]}</button>)}</div></div>
      <div className="full roster-editor">
        <div className="roster-head"><span className="field-label">Integrantes ({roster.size})</span><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filtrar pessoas" /></div>
        <ul>{visible.map((person) => {
          const inTeam = roster.has(person.id);
          return <li key={person.id} className={inTeam ? "selected" : ""}>
            <label className="roster-person"><input type="checkbox" checked={inTeam} onChange={(event) => toggle(person.id, event.target.checked)} /><Avatar member={person} size={26} /><span><strong>{person.name}</strong><small>{person.jobTitle || "Cargo não informado"}</small></span></label>
            {inTeam && <label className="roster-lead"><input type="checkbox" checked={roster.get(person.id) ?? false} onChange={(event) => setRoster((current) => new Map(current).set(person.id, event.target.checked))} />Líder</label>}
          </li>;
        })}</ul>
      </div>
    </div>
    {error && <p className="modal-error">{error}</p>}
    <div className="modal-actions">{team && <button type="button" className="secondary-button modal-delete" onClick={remove}><Trash2 size={15} /> Excluir</button>}<button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={saving || !name.trim()}>{saving ? "Salvando..." : team ? "Salvar time" : "Criar time"}</button></div>
  </form></div>;
}
