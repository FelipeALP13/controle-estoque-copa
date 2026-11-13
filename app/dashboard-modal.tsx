"use client";

import ThemePicker from "./theme-picker";
import { useEffect, useMemo, useState } from "react";
import { passwordPolicyError } from "./auth-policy";
import { marketCategories, marketUnits } from "./inventory-standards";
import { parseMovementDate } from "./movement-policy";
import { TeamChip } from "./tasks-view";
import SessionsPanel from "./sessions-panel";
import { addDays, findOverlappingWeek, generateRotation, normalizeTeamMembers, supportTeamColorLabels, supportTeamColors, weekRangeError, type SupportTeamColor } from "./support-schedule";
import Trash2 from "lucide-react/icons/trash-2";
import TriangleAlert from "lucide-react/icons/triangle-alert";
import X from "lucide-react/icons/x";
import { type MemberRole, type MemberPermissions, permissionPresets, permissionOptions, type CurrentUser, type Item, type ModalState, type Schedule, movementCopy, fmt, roleLabel, personIcons, uploadImage, StandardChoice, VisualEditor, isoDateInSaoPaulo, weekLabel, findTeam } from "./dashboard-shared";

function nextMondayAfter(isoDate: string) {
  const weekday = new Date(`${isoDate}T12:00:00Z`).getUTCDay();
  return addDays(isoDate, ((8 - weekday) % 7) || 7);
}

/** Sugere o próximo período e a próxima equipe a partir do fim da escala atual. */
function scheduleSuggestion(schedule: Schedule) {
  const today = isoDateInSaoPaulo();
  const last = [...schedule.weeks].sort((a, b) => a.start.localeCompare(b.start)).at(-1);
  const base = last && last.end >= today ? last.end : addDays(today, -1);
  const start = nextMondayAfter(base);
  const lastTeamIndex = last ? schedule.teams.findIndex((team) => team.id === last.teamId) : -1;
  const nextTeam = schedule.teams[(lastTeamIndex + 1) % Math.max(1, schedule.teams.length)];
  return { start, end: addDays(start, 4), teamId: nextTeam?.id ?? 0 };
}

function SupportTeamFields({ name, setName, color, setColor, membersText, setMembersText }: { name: string; setName: (value: string) => void; color: SupportTeamColor; setColor: (value: SupportTeamColor) => void; membersText: string; setMembersText: (value: string) => void }) {
  const preview = normalizeTeamMembers(membersText.split(/\n|,/));
  return <>
    <label className="full"><span>Nome da equipe</span><input autoFocus required maxLength={40} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Equipe Azul" /></label>
    <div className="full team-color-field"><span className="field-label">Cor</span><div className="team-color-options">{supportTeamColors.map((option) => <button type="button" key={option} className={`team-color-swatch ${option} ${color === option ? "active" : ""}`} onClick={() => setColor(option)} aria-pressed={color === option}><i />{supportTeamColorLabels[option]}</button>)}</div></div>
    <label className="full"><span>Integrantes</span><textarea required value={membersText} onChange={(event) => setMembersText(event.target.value)} placeholder={"Um nome por linha\nEx.: Ana Souza\nBruno Lima"} rows={5} /><small>{preview.length ? `${preview.length} ${preview.length === 1 ? "integrante" : "integrantes"}: ${preview.join(" · ")}` : "Escreva um nome por linha (ou separe por vírgula)."}</small></label>
  </>;
}

export function Modal({ state, items, schedule, currentUser, saving, onClose, onSubmit }: { state: NonNullable<ModalState>; items: Item[]; schedule: Schedule; currentUser: CurrentUser | null; saving: boolean; onClose: () => void; onSubmit: (payload: Record<string, unknown>, success: string) => Promise<string | null> }) {
  const editingTeam = state.kind === "supportTeam" ? state.team : undefined;
  const editingWeek = state.kind === "supportWeek" ? state.week : undefined;
  const suggestion = useMemo(() => scheduleSuggestion(schedule), [schedule]);
  const [teamName, setTeamName] = useState(editingTeam?.name ?? "");
  const [teamColor, setTeamColor] = useState<SupportTeamColor>(editingTeam?.color ?? supportTeamColors.find((color) => !schedule.teams.some((team) => team.color === color)) ?? "purple");
  const [teamMembersText, setTeamMembersText] = useState(editingTeam?.members.join("\n") ?? "");
  const [weekStart, setWeekStart] = useState(editingWeek?.start ?? suggestion.start);
  const [weekEnd, setWeekEnd] = useState(editingWeek?.end ?? suggestion.end);
  const [weekTeamId, setWeekTeamId] = useState(String(editingWeek?.teamId ?? suggestion.teamId));
  const [weekNote, setWeekNote] = useState(editingWeek?.note ?? "");
  const [generateStart, setGenerateStart] = useState(suggestion.start);
  const [generateCount, setGenerateCount] = useState("8");
  const [generateDays, setGenerateDays] = useState("5");
  const [generateFirstTeam, setGenerateFirstTeam] = useState(String(suggestion.teamId));
  const [generateTeamIds, setGenerateTeamIds] = useState<number[]>(schedule.teams.map((team) => team.id));
  const rotationTeamIds = useMemo(() => {
    const ordered = schedule.teams.map((team) => team.id).filter((id) => generateTeamIds.includes(id));
    const firstIndex = Math.max(0, ordered.indexOf(Number(generateFirstTeam)));
    return [...ordered.slice(firstIndex), ...ordered.slice(0, firstIndex)];
  }, [schedule.teams, generateTeamIds, generateFirstTeam]);
  const generatedPreview = useMemo(() => state.kind === "generateWeeks" ? generateRotation(generateStart, Number(generateCount), rotationTeamIds, Number(generateDays)).map((week) => ({ ...week, conflict: findOverlappingWeek(schedule.weeks, week) })) : [], [state.kind, generateStart, generateCount, generateDays, rotationTeamIds, schedule.weeks]);
  const weekConflict = state.kind === "supportWeek" && !weekRangeError(weekStart, weekEnd) ? findOverlappingWeek(schedule.weeks, { start: weekStart, end: weekEnd }, editingWeek?.id) : null;
  const editing = state.kind === "item" ? state.item : undefined;
  const editingMember = state.kind === "member" ? state.member : undefined;
  const preselected = state.kind === "movement" ? state.item : undefined;
  const [itemId, setItemId] = useState(String(preselected?.id ?? items[0]?.id ?? ""));
  const [name, setName] = useState(editing?.name ?? "");
  const [category, setCategory] = useState(editing?.category ?? "");
  const [unit, setUnit] = useState(editing?.unit ?? "");
  const [minimumQty, setMinimumQty] = useState(String(editing?.minimumQty ?? 2));
  const [itemIcon, setItemIcon] = useState(editing?.icon ?? "📦");
  const [itemImageKey, setItemImageKey] = useState<string | null>(editing?.imageKey ?? null);
  const [itemVisualMode, setItemVisualMode] = useState<"icon" | "image">(editing?.imageKey ? "image" : "icon");
  const [itemFile, setItemFile] = useState<File | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [occurredAt, setOccurredAt] = useState("");
  const maximumMovementDate = useMemo(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
  }, []);
  const selected = items.find((item) => item.id === Number(itemId));
  const [unopenedQty, setUnopenedQty] = useState(String(preselected?.unopenedQty ?? selected?.unopenedQty ?? 0));
  const [openedQty, setOpenedQty] = useState(String(preselected?.openedQty ?? selected?.openedQty ?? 0));
  const [note, setNote] = useState("");
  const profile = state.kind === "profile" ? currentUser : null;
  const [memberName, setMemberName] = useState(editingMember?.name ?? profile?.name ?? "");
  const [memberEmail, setMemberEmail] = useState(editingMember?.email ?? profile?.email ?? "");
  const [memberUsername, setMemberUsername] = useState(editingMember?.username ?? profile?.username ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [memberPassword, setMemberPassword] = useState("");
  const [memberRole, setMemberRole] = useState<MemberRole>(editingMember?.role ?? profile?.role ?? "member");
  const [memberPermissions, setMemberPermissions] = useState<MemberPermissions>(editingMember?.permissions ?? profile?.permissions ?? permissionPresets.member);
  const [memberActive, setMemberActive] = useState(editingMember?.active ?? true);
  const [memberTab, setMemberTab] = useState<"general" | "permissions">("general");
  const [avatarIcon, setAvatarIcon] = useState(editingMember?.avatarIcon ?? profile?.avatarIcon ?? "👤");
  const [avatarKey] = useState<string | null>(editingMember?.avatarKey ?? profile?.avatarKey ?? null);
  const [avatarMode, setAvatarMode] = useState<"icon" | "image">((editingMember?.avatarKey ?? profile?.avatarKey) ? "image" : "icon");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [profileExtra, setProfileExtra] = useState<{ memberId: number; jobTitle: string; phone: string; teams: { name: string; color: string; isLead: boolean }[] } | null>(null);

  // Cargo, telefone e times vêm da área Pessoas.
  useEffect(() => {
    if (state.kind !== "profile") return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/people", { cache: "no-store" });
        if (!response.ok) return;
        const people = await response.json() as { people: { id: number; jobTitle: string; phone: string }[]; teams: { name: string; color: string; members: { memberId: number; isLead: boolean }[] }[]; me: { id: number } };
        const mine = people.people.find((person) => person.id === people.me.id);
        if (!cancelled && mine) setProfileExtra({
          memberId: mine.id,
          jobTitle: mine.jobTitle,
          phone: mine.phone,
          teams: people.teams.flatMap((team) => team.members.filter((row) => row.memberId === mine.id).map((row) => ({ name: team.name, color: team.color, isLead: row.isLead }))),
        });
      } catch { /* sem a área Pessoas, o perfil continua funcionando */ }
    })();
    return () => { cancelled = true; };
  }, [state.kind]);
  const [formError, setFormError] = useState("");

  const title = state.kind === "supportTeam" ? (editingTeam ? "Editar equipe" : "Nova equipe") : state.kind === "supportWeek" ? (editingWeek ? "Editar semana" : "Nova semana") : state.kind === "generateWeeks" ? "Gerar semanas" : state.kind === "profile" ? "Meu perfil" : state.kind === "member" ? (editingMember ? "Editar membro" : "Adicionar membro") : state.kind === "item" ? (editing ? "Editar item" : "Novo item") : movementCopy[state.type].label;
  const description = state.kind === "supportTeam" ? "Defina o nome, a cor e quem faz parte desta equipe de atendimento." : state.kind === "supportWeek" ? "Escolha o período e a equipe responsável pelo atendimento." : state.kind === "generateWeeks" ? "Crie várias semanas de uma vez, alternando as equipes na ordem escolhida." : state.kind === "profile" ? "Atualize seus dados de acesso e como você aparece nos registros." : state.kind === "member" ? (editingMember ? "Atualize os dados, redefina a senha e ajuste as permissões deste usuário." : "Crie o usuário, a senha inicial e escolha exatamente o que a pessoa poderá fazer.") : state.kind === "item" ? "Edite os dados e a aparência do item." : {
    purchase: "A quantidade comprada será adicionada ao estoque fechado.",
    open: "A quantidade sairá do estoque fechado e passará para aberto.",
    consume: "O consumo será descontado somente das embalagens abertas.",
    adjust: "Corrija a contagem física de embalagens fechadas e abertas.",
  }[state.type];

  function changeSelected(value: string) {
    setItemId(value);
    const item = items.find((entry) => entry.id === Number(value));
    if (item) { setUnopenedQty(String(item.unopenedQty)); setOpenedQty(String(item.openedQty)); }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    try {
      setFormError("");
      setUploading(true);
      if (state.kind === "supportTeam") {
        const teamMembers = normalizeTeamMembers(teamMembersText.split(/\n|,/));
        if (!teamMembers.length) throw new Error("Adicione pelo menos um integrante à equipe.");
        const submissionError = await onSubmit({ action: "saveSupportTeam", teamId: editingTeam?.id, name: teamName, color: teamColor, members: teamMembers }, editingTeam ? "Equipe atualizada." : "Equipe criada.");
        if (submissionError) throw new Error(submissionError);
        return;
      }
      if (state.kind === "supportWeek") {
        const rangeError = weekRangeError(weekStart, weekEnd);
        if (rangeError) throw new Error(rangeError);
        const submissionError = await onSubmit({ action: "saveSupportWeek", weekId: editingWeek?.id, start: weekStart, end: weekEnd, teamId: Number(weekTeamId), note: weekNote }, editingWeek ? "Semana atualizada." : "Semana adicionada à escala.");
        if (submissionError) throw new Error(submissionError);
        return;
      }
      if (state.kind === "generateWeeks") {
        if (!rotationTeamIds.length) throw new Error("Escolha pelo menos uma equipe para o rodízio.");
        const submissionError = await onSubmit({ action: "generateSupportWeeks", start: generateStart, count: Number(generateCount), daysPerWeek: Number(generateDays), teamIds: rotationTeamIds }, `${generatedPreview.length} semanas adicionadas à escala.`);
        if (submissionError) throw new Error(submissionError);
        return;
      }
      if (state.kind === "profile" || state.kind === "member") {
        if (state.kind === "member" && !editingMember && !memberPassword) throw new Error("Crie uma senha inicial para o novo membro.");
        const passwordError = memberPassword ? passwordPolicyError(memberPassword) : null;
        if (passwordError) throw new Error(passwordError);
        if (state.kind === "profile" && memberPassword && !currentPassword) throw new Error("Informe sua senha atual para criar uma nova senha.");
        const uploadedAvatarKey = avatarMode === "image" && avatarFile ? await uploadImage(avatarFile, "profile") : avatarMode === "image" ? avatarKey : null;
        let submissionError: string | null;
        if (state.kind === "profile") {
          // Cargo e telefone moram em Pessoas; salva antes, porque o onSubmit fecha a janela.
          if (profileExtra) {
            const response = await fetch("/api/people", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "updatePerson", memberId: profileExtra.memberId, jobTitle: profileExtra.jobTitle, phone: profileExtra.phone }) });
            if (!response.ok) throw new Error(((await response.json()) as { error?: string }).error || "Não foi possível salvar cargo e telefone.");
          }
          submissionError = await onSubmit({ action: "updateProfile", name: memberName, email: memberEmail, username: memberUsername, currentPassword, password: memberPassword, avatarIcon, avatarKey: uploadedAvatarKey }, "Perfil e acesso atualizados.");
        } else {
          submissionError = await onSubmit({ action: editingMember ? "updateMember" : "addMember", userId: editingMember?.userId, name: memberName, email: memberEmail, username: memberUsername, password: memberPassword, role: memberRole, permissions: memberPermissions, active: memberActive, avatarIcon, avatarKey: uploadedAvatarKey }, editingMember ? "Membro atualizado." : "Membro adicionado.");
        }
        if (submissionError) throw new Error(submissionError);
        return;
      }
      if (state.kind === "item") {
        const uploadedItemKey = itemVisualMode === "image" && itemFile ? await uploadImage(itemFile, "item") : itemVisualMode === "image" ? itemImageKey : null;
        setItemImageKey(uploadedItemKey);
        await onSubmit({ action: editing ? "updateItem" : "addItem", itemId: editing?.id, name, category, unit, minimumQty: Number(minimumQty), icon: itemIcon, imageKey: uploadedItemKey }, editing ? "Item atualizado." : "Novo item cadastrado.");
        return;
      }
      const payload: Record<string, unknown> = { action: "movement", type: state.type, itemId: Number(itemId), quantity: Number(quantity), note };
      if (occurredAt) {
        const movementDate = parseMovementDate(occurredAt);
        if (movementDate.error) throw new Error(movementDate.error);
        payload.occurredAt = movementDate.iso;
      }
      if (state.type === "adjust") { payload.unopenedQty = Number(unopenedQty); payload.openedQty = Number(openedQty); }
      await onSubmit(payload, `${movementCopy[state.type].label} registrada.`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Não foi possível salvar.");
    } finally {
      setUploading(false);
    }
  }

  async function handleScheduleDelete() {
    const confirmation = editingTeam ? `Excluir a ${editingTeam.name}? Só é possível quando ela não tem semanas na escala.` : editingWeek ? `Excluir a semana de ${weekLabel(editingWeek)} da escala?` : "";
    if (!confirmation || !window.confirm(confirmation)) return;
    setFormError("");
    const submissionError = editingTeam
      ? await onSubmit({ action: "deleteSupportTeam", teamId: editingTeam.id }, "Equipe excluída.")
      : await onSubmit({ action: "deleteSupportWeek", weekId: editingWeek!.id }, "Semana removida da escala.");
    if (submissionError) setFormError(submissionError);
  }

  const isScheduleModal = state.kind === "supportTeam" || state.kind === "supportWeek" || state.kind === "generateWeeks";
  const generateBlocked = state.kind === "generateWeeks" && (!generatedPreview.length || generatedPreview.some((week) => week.conflict));

  return (
    <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><form className={`modal ${state.kind === "member" ? "member-modal" : ""}`} onSubmit={handleSubmit}>
      <div className="modal-head"><div><p className="eyebrow">{isScheduleModal ? "ESCALA DE ATENDIMENTO" : state.kind === "profile" ? "CONFIGURAÇÕES PESSOAIS" : state.kind === "member" ? "GESTÃO DE ACESSO" : state.kind === "item" ? "CADASTRO EDITÁVEL" : "MOVIMENTAÇÃO DO ESTOQUE"}</p><h2>{title}</h2><p>{description}</p></div><button type="button" onClick={onClose}><X /></button></div>
      {state.kind === "member" && <div className="member-tabs"><button type="button" className={memberTab === "general" ? "active" : ""} onClick={() => setMemberTab("general")}>Geral</button><button type="button" className={memberTab === "permissions" ? "active" : ""} onClick={() => setMemberTab("permissions")}>Permissões</button></div>}
      <div className="form-grid">
        {state.kind === "supportTeam" ? <SupportTeamFields name={teamName} setName={setTeamName} color={teamColor} setColor={setTeamColor} membersText={teamMembersText} setMembersText={setTeamMembersText} /> : state.kind === "supportWeek" ? <>
          <label><span>Início</span><input type="date" required value={weekStart} onChange={(event) => { const value = event.target.value; setWeekStart(value); if (!editingWeek && value && (!weekEnd || weekEnd < value)) setWeekEnd(addDays(value, 4)); }} /></label>
          <label><span>Fim</span><input type="date" required min={weekStart} value={weekEnd} onChange={(event) => setWeekEnd(event.target.value)} /></label>
          <label className="full"><span>Equipe responsável</span><select required value={weekTeamId} onChange={(event) => setWeekTeamId(event.target.value)}>{schedule.teams.map((team) => <option key={team.id} value={team.id}>{team.name} — {team.members.join(", ")}</option>)}</select></label>
          <label className="full"><span>Observação <em>opcional</em></span><input maxLength={140} value={weekNote} onChange={(event) => setWeekNote(event.target.value)} placeholder="Ex.: sem expediente na sexta (feriado)" /><small>Aparece junto do período para toda a equipe.</small></label>
          {weekConflict && <p className="schedule-conflict full"><TriangleAlert size={15} /> Conflita com a semana de {weekLabel(weekConflict)}. Ajuste as datas antes de salvar.</p>}
        </> : state.kind === "generateWeeks" ? <>
          <label><span>Primeira semana começa em</span><input type="date" required value={generateStart} onChange={(event) => setGenerateStart(event.target.value)} /></label>
          <label><span>Quantidade de semanas</span><input type="number" required min="1" max="52" value={generateCount} onChange={(event) => setGenerateCount(event.target.value)} /></label>
          <label><span>Dias de atendimento por semana</span><select value={generateDays} onChange={(event) => setGenerateDays(event.target.value)}>{[1, 2, 3, 4, 5, 6, 7].map((days) => <option key={days} value={days}>{days} {days === 1 ? "dia" : "dias"}{days === 5 ? " (seg. a sex.)" : ""}</option>)}</select></label>
          <label><span>Começar pela equipe</span><select value={generateFirstTeam} onChange={(event) => setGenerateFirstTeam(event.target.value)}>{schedule.teams.filter((team) => generateTeamIds.includes(team.id)).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
          <div className="full generate-teams"><span className="field-label">Equipes no rodízio</span><div>{schedule.teams.map((team) => <label key={team.id} className={`generate-team ${team.color}`}><input type="checkbox" checked={generateTeamIds.includes(team.id)} onChange={(event) => { const checked = event.target.checked; setGenerateTeamIds((current) => checked ? [...current, team.id] : current.filter((id) => id !== team.id)); if (!checked && Number(generateFirstTeam) === team.id) setGenerateFirstTeam(String(schedule.teams.find((other) => other.id !== team.id && generateTeamIds.includes(other.id))?.id ?? "")); }} /><i />{team.name}</label>)}</div></div>
          <div className="full generate-preview"><span className="field-label">Prévia</span>{generatedPreview.length ? <ol>{generatedPreview.map((week) => { const team = findTeam(schedule, week.teamId); return <li key={week.start} className={week.conflict ? "conflict" : ""}><span className={`generate-dot ${team?.color ?? "purple"}`} /><strong>{weekLabel(week)}</strong><small>{team?.name}</small>{week.conflict && <em>conflita com {weekLabel(week.conflict)}</em>}</li>; })}</ol> : <small>Preencha os campos para ver as semanas.</small>}</div>
          {generateBlocked && generatedPreview.length > 0 && <p className="schedule-conflict full"><TriangleAlert size={15} /> Algumas semanas conflitam com a escala atual. Mude a data inicial ou a quantidade.</p>}
        </> : state.kind === "profile" ? <>
          <VisualEditor label="Sua imagem" icons={personIcons} mode={avatarMode} setMode={setAvatarMode} icon={avatarIcon} setIcon={setAvatarIcon} imageKey={avatarKey} file={avatarFile} setFile={setAvatarFile} />
          <label className="full"><span>Nome</span><input autoFocus required value={memberName} onChange={(e) => setMemberName(e.target.value)} placeholder="Ex.: Ana Souza" /></label>
          <label><span>Usuário</span><input required minLength={3} autoCapitalize="none" value={memberUsername} onChange={(e) => setMemberUsername(e.target.value)} placeholder="Ex.: ana" /></label>
          <label><span>E-mail</span><input required type="email" value={memberEmail} onChange={(e) => setMemberEmail(e.target.value)} placeholder="ana@empresa.com" /></label>
          {profileExtra && <>
            <label><span>Cargo</span><input maxLength={60} value={profileExtra.jobTitle} onChange={(e) => setProfileExtra({ ...profileExtra, jobTitle: e.target.value })} placeholder="Ex.: Analista de Suporte" /></label>
            <label><span>Telefone ou ramal</span><input maxLength={30} inputMode="tel" value={profileExtra.phone} onChange={(e) => setProfileExtra({ ...profileExtra, phone: e.target.value })} placeholder="Ex.: (11) 98765-4321" /></label>
            <div className="profile-teams full"><span>Seus times</span><div>{profileExtra.teams.length ? profileExtra.teams.map((team) => <TeamChip key={team.name} team={team} lead={team.isLead} />) : <small>Você ainda não está em nenhum time. Peça a um administrador para incluir você.</small>}</div></div>
          </>}
          <div className="password-change full"><div><strong>Alterar senha</strong><small>Deixe os dois campos vazios para manter a senha atual. A nova senha deve ter 8+ caracteres, letras e números.</small></div><div className="password-change-fields"><label><span>Senha atual</span><input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Sua senha atual" /></label><label><span>Nova senha</span><input type="password" value={memberPassword} onChange={(e) => setMemberPassword(e.target.value)} placeholder="8+ caracteres, letras e números" /><small className={memberPassword && passwordPolicyError(memberPassword) ? "field-error" : ""}>{memberPassword ? passwordPolicyError(memberPassword) || "Senha válida." : "Mínimo de 8 caracteres, com letras e números."}</small></label></div></div>
          <ThemePicker />
          <SessionsPanel />
          <div className="profile-role full"><span>Seu nível de acesso</span><strong>{roleLabel(memberRole)}</strong></div>
        </> : state.kind === "member" ? memberTab === "general" ? <>
          <VisualEditor label="Avatar do usuário" icons={personIcons} mode={avatarMode} setMode={setAvatarMode} icon={avatarIcon} setIcon={setAvatarIcon} imageKey={avatarKey} file={avatarFile} setFile={setAvatarFile} />
          <label><span>Nome</span><input autoFocus required value={memberName} onChange={(e) => setMemberName(e.target.value)} placeholder="Ex.: Ana Souza" /></label>
          <label><span>Usuário de acesso</span><input required minLength={3} autoCapitalize="none" value={memberUsername} onChange={(e) => setMemberUsername(e.target.value)} placeholder="Ex.: ana" /></label>
          <label><span>{editingMember ? "Redefinir senha" : "Senha inicial"}</span><input required={!editingMember} type="password" value={memberPassword} onChange={(e) => setMemberPassword(e.target.value)} placeholder={editingMember ? "Deixe em branco para manter" : "8+ caracteres, letras e números"} /><small className={memberPassword && passwordPolicyError(memberPassword) ? "field-error" : ""}>{memberPassword ? passwordPolicyError(memberPassword) || "Senha válida." : editingMember ? "Deixe em branco para manter. Para trocar: 8+ caracteres, letras e números." : "Obrigatória: mínimo de 8 caracteres, com letras e números."}</small></label>
          <label><span>E-mail</span><input required type="email" value={memberEmail} onChange={(e) => setMemberEmail(e.target.value)} placeholder="ana@empresa.com" /></label>
            <label><span>Perfil base</span><select value={memberRole} onChange={(e) => { const role = e.target.value as MemberRole; setMemberRole(role); setMemberPermissions(permissionPresets[role]); }}><option value="admin">Administrador</option><option value="member">Membro</option><option value="viewer">Somente leitura</option></select></label>
            <label><span>Status</span><select value={memberActive ? "active" : "inactive"} onChange={(event) => setMemberActive(event.target.value === "active")}><option value="active">Ativo</option><option value="inactive">Desativado</option></select></label>
          <div className="account-security-note full"><span>🔐</span><div><strong>Credenciais protegidas</strong><small>A senha é transformada em um código seguro e não pode ser visualizada depois de salva.</small></div></div>
        </> : <>
          <div className="permission-editor full">
            <div className="permission-editor-head"><div><strong>Permissões individuais</strong><small>{memberRole === "admin" ? "Administradores possuem acesso total obrigatório." : `Defina exatamente o que ${memberName || "este usuário"} poderá fazer.`}</small></div><span>{memberRole === "admin" ? "Acesso total" : `${Object.values(memberPermissions).filter(Boolean).length} de ${permissionOptions.length}`}</span></div>
            <div className="permission-options">
              {permissionOptions.map((option) => <label key={option.key} className={memberRole === "admin" ? "locked" : ""}><input type="checkbox" checked={memberRole === "admin" || memberPermissions[option.key]} disabled={memberRole === "admin"} onChange={(event) => setMemberPermissions((current) => ({ ...current, [option.key]: event.target.checked }))} /><span><strong>{option.label}</strong><small>{option.description}</small></span></label>)}
            </div>
          </div>
          <div className="permission-help full"><strong>Perfil base: {roleLabel(memberRole)}</strong><p>Você pode personalizar as opções acima. Administradores sempre mantêm acesso completo ao sistema.</p><button type="button" onClick={() => setMemberTab("general")}>Voltar aos dados gerais</button></div>
        </> : state.kind === "item" ? <>
          <VisualEditor label="Aparência do item" mode={itemVisualMode} setMode={setItemVisualMode} icon={itemIcon} setIcon={setItemIcon} imageKey={itemImageKey} file={itemFile} setFile={setItemFile} />
          <label className="full"><span>Nome do item</span><input autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Café em pó" /></label>
          <StandardChoice label="Categoria" value={category} setValue={setCategory} options={marketCategories} customLabel="Outra categoria..." helper="Escolha um padrão ou crie uma categoria personalizada." />
          <StandardChoice label="Unidade de controle" value={unit} setValue={setUnit} options={marketUnits} customLabel="Outra unidade..." helper="Escolha como o item será comprado e contado." />
          <label><span>Estoque mínimo</span><input required min="0" step="0.01" type="number" value={minimumQty} onChange={(e) => setMinimumQty(e.target.value)} /><small>Aviso de reposição.</small></label>
        </> : <>
          <label className="full"><span>Item</span><select required value={itemId} onChange={(e) => changeSelected(e.target.value)} disabled={Boolean(preselected)}>{items.map((item) => <option key={item.id} value={item.id}>{item.name} — {fmt(item.unopenedQty + item.openedQty)} {item.unit}</option>)}</select></label>
          {state.type === "adjust" ? <>
            <label><span>Quantidade fechada</span><input min="0" step="0.01" type="number" required value={unopenedQty} onChange={(e) => setUnopenedQty(e.target.value)} /></label>
            <label><span>Quantidade aberta</span><input min="0" step="0.01" type="number" required value={openedQty} onChange={(e) => setOpenedQty(e.target.value)} /></label>
          </> : <label className="full"><span>Quantidade ({selected?.unit ?? "un."})</span><input autoFocus min="0.01" step="0.01" type="number" required value={quantity} onChange={(e) => setQuantity(e.target.value)} /><small>{selected && state.type === "open" ? `Disponível fechado: ${fmt(selected.unopenedQty)} ${selected.unit}` : selected && state.type === "consume" ? `Disponível aberto: ${fmt(selected.openedQty)} ${selected.unit}` : "Use números decimais quando necessário."}</small></label>}
          <label className="full retroactive-opening"><span>{{ purchase: "Data e hora da compra", open: "Data e hora da abertura", consume: "Data e hora do consumo", adjust: "Data e hora do ajuste" }[state.type]} <em>opcional</em></span><input type="datetime-local" max={maximumMovementDate} value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} /><small>Deixe vazio para registrar agora. Preencha quando esta movimentação aconteceu anteriormente.</small></label>
          <label className="full"><span>Observação <em>opcional</em></span><textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: compra mensal, contagem feita pela manhã..." /></label>
        </>}
      </div>
      {formError && <p className="modal-error">{formError}</p>}
      <div className="modal-actions">{(editingTeam || editingWeek) && <button type="button" className="secondary-button modal-delete" disabled={saving} onClick={handleScheduleDelete}><Trash2 size={15} /> Excluir</button>}<button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={saving || uploading || (state.kind === "movement" && !itemId) || Boolean(weekConflict) || generateBlocked}>{saving || uploading ? "Salvando..." : state.kind === "supportTeam" ? (editingTeam ? "Salvar equipe" : "Criar equipe") : state.kind === "supportWeek" ? (editingWeek ? "Salvar semana" : "Adicionar semana") : state.kind === "generateWeeks" ? `Gerar ${generatedPreview.length || ""} semanas` : state.kind === "profile" ? "Salvar perfil" : state.kind === "member" ? (editingMember ? "Salvar membro" : "Adicionar membro") : "Confirmar"}</button></div>
    </form></div>
  );
}
