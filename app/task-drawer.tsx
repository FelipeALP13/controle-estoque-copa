"use client";

import AttachmentsPanel from "./attachments-panel";
import RecurrencePanel, { type Recurrence } from "./recurrence-panel";

import { useCallback, useEffect, useMemo, useState } from "react";
import Building2 from "lucide-react/icons/building-2";
import CalendarDays from "lucide-react/icons/calendar";
import Plus from "lucide-react/icons/plus";
import Send from "lucide-react/icons/send";
import Trash2 from "lucide-react/icons/trash-2";
import TriangleAlert from "lucide-react/icons/triangle-alert";
import X from "lucide-react/icons/x";
import { splitMentions } from "./notifications";
import { describeTaskEvent, isClosedStatus, taskCode, taskPriorities, taskPriorityLabels, taskStatuses, taskStatusLabels, type TaskPriority, type TaskStatus } from "./tasks";
import ListChecks from "lucide-react/icons/list-checks";
import Pencil from "lucide-react/icons/pencil";
import { checklistProgress, type ChecklistItem } from "./checklists";
import Clock from "lucide-react/icons/clock";
import { formatHours, parseEntryHours, type TimeEntry } from "./time-entries";
import { type Task, type TaskClient, type Me, type TaskEvent, type Lookups, relativeTime, fullDate, postTask, StatusIcon, PriorityIcon, Avatar, DueChip, PeoplePicker, MentionTextarea } from "./task-shared";

type Fields = Pick<Task, "status" | "priority" | "owners" | "support" | "teamId" | "clientId" | "projectId" | "category" | "startDate" | "dueDate" | "completedOn" | "estimatedHours" | "origin">;

/** Campos da demanda; usado na criação e no painel lateral. Horas e textos salvam ao sair do campo. */
function PropertyFields({ value, onChange, lookups, disabled, compact }: { value: Fields; onChange: (changes: Partial<Fields>) => void; lookups: Lookups; disabled?: boolean; compact?: boolean }) {
  const team = lookups.teams.find((entry) => entry.id === value.teamId);
  const [hours, setHours] = useState({ estimatedHours: value.estimatedHours?.toString().replace(".", ",") ?? "" });
  const [origin, setOrigin] = useState(value.origin);
  const categories = value.category && !lookups.categories.includes(value.category) ? [value.category, ...lookups.categories] : lookups.categories;
  const commitHours = (field: "estimatedHours") => {
    const text = hours[field].trim();
    const parsed = text ? Number(text.replace(",", ".")) : null;
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) { setHours({ ...hours, [field]: value[field]?.toString().replace(".", ",") ?? "" }); return; }
    if (parsed !== value[field]) onChange({ [field]: parsed });
  };
  const dateField = (field: "startDate" | "dueDate" | "completedOn", label: string) => <label className="task-prop"><span>{label}</span><span className="task-prop-control"><CalendarDays size={14} /><input disabled={disabled} type="date" value={value[field] ?? ""} onChange={(event) => onChange({ [field]: event.target.value || null })} />{value[field] && !disabled && <button type="button" className="task-prop-clear" onClick={() => onChange({ [field]: null })} aria-label={`Remover ${label.toLowerCase()}`}><X size={12} /></button>}</span></label>;

  return <div className={`task-fields ${compact ? "compact" : ""}`}>
    <label className="task-prop"><span>Status</span><span className="task-prop-control"><StatusIcon status={value.status} /><select disabled={disabled} value={value.status} onChange={(event) => onChange({ status: event.target.value as TaskStatus })}>{taskStatuses.map((status) => <option key={status} value={status}>{taskStatusLabels[status]}</option>)}</select></span></label>
    <label className="task-prop"><span>Prioridade</span><span className="task-prop-control"><PriorityIcon priority={value.priority} /><select disabled={disabled} value={value.priority} onChange={(event) => onChange({ priority: Number(event.target.value) as TaskPriority })}>{taskPriorities.map((priority) => <option key={priority} value={priority}>{taskPriorityLabels[priority]}</option>)}</select></span></label>
    <PeoplePicker label="Responsáveis" value={value.owners} onChange={(owners) => onChange({ owners, support: value.support.filter((id) => !owners.includes(id)) })} members={lookups.members} disabled={disabled} />
    <PeoplePicker label="Resp. Suporte" value={value.support} onChange={(support) => onChange({ support })} members={lookups.members} exclude={value.owners} disabled={disabled} />
    <label className="task-prop"><span>Cliente / Projeto</span><span className="task-prop-control"><Building2 size={14} /><select disabled={disabled} value={value.clientId ?? ""} onChange={(event) => onChange({ clientId: event.target.value ? Number(event.target.value) : null })}><option value="">Sem cliente</option>{lookups.clients.filter((client) => client.active || client.id === value.clientId).map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></span></label>
    <label className="task-prop"><span>Categoria</span><span className="task-prop-control"><select disabled={disabled} value={value.category} onChange={(event) => onChange({ category: event.target.value })}><option value="">Sem categoria</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></span></label>
    {lookups.teams.length > 0 && <label className="task-prop"><span>Time</span><span className="task-prop-control"><span className={`team-chip-dot ${team?.color ?? "none"}`} /><select disabled={disabled} value={value.teamId ?? ""} onChange={(event) => onChange({ teamId: event.target.value ? Number(event.target.value) : null })}><option value="">Sem time</option>{lookups.teams.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></span></label>}
    {lookups.projects.length > 0 && <label className="task-prop"><span>Projeto grande</span><span className="task-prop-control"><select disabled={disabled} value={value.projectId ?? ""} onChange={(event) => onChange({ projectId: event.target.value ? Number(event.target.value) : null })}><option value="">Nenhum</option>{lookups.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></span></label>}
    {dateField("startDate", "Data de Início")}
    {dateField("dueDate", "Prazo")}
    {!compact && dateField("completedOn", "Data de Conclusão")}
    <div className="task-hours">
      <label className="task-prop"><span>Horas estimadas</span><span className="task-prop-control"><input disabled={disabled} inputMode="decimal" value={hours.estimatedHours} onChange={(event) => setHours({ ...hours, estimatedHours: event.target.value })} onBlur={() => commitHours("estimatedHours")} placeholder="0" /><small>h</small></span></label>
    </div>
    <label className="task-prop"><span>Origem / Ticket</span><span className="task-prop-control"><input disabled={disabled} maxLength={300} value={origin} onChange={(event) => setOrigin(event.target.value)} onBlur={() => { if (origin !== value.origin) onChange({ origin }); }} placeholder="Ex.: WhatsApp, TICKET-663" /></span></label>
  </div>;
}

export function NewTaskModal({ initialStatus, lookups, meId, defaultTeamId, defaultClientId, onClose, onCreated }: { initialStatus: TaskStatus; lookups: Lookups; meId: number; defaultTeamId: number | null; defaultClientId: number | null; onClose: () => void; onCreated: (task: Task) => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<Fields>({ status: initialStatus, priority: 0, owners: lookups.members.some((member) => member.id === meId) ? [meId] : [], support: [], teamId: defaultTeamId, clientId: defaultClientId, projectId: null, category: "", startDate: null, dueDate: null, completedOn: null, estimatedHours: null, origin: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [steps, setSteps] = useState("");
  const [showSteps, setShowSteps] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/templates", { cache: "no-store" }).then(async (response) => {
      if (response.ok && !cancelled) setTemplates(((await response.json()) as { templates: Template[] }).templates);
    }).catch(() => { /* modelos são opcionais */ });
    return () => { cancelled = true; };
  }, []);

  // Escolher um modelo preenche o que ainda está vazio e traz os passos.
  function applyTemplate(id: string) {
    setTemplateId(id);
    const template = templates.find((entry) => String(entry.id) === id);
    if (!template) return;
    if (!title.trim() && template.title) setTitle(template.title);
    if (!description.trim() && template.description) setDescription(template.description);
    setFields((current) => ({
      ...current,
      category: current.category || template.category,
      teamId: current.teamId ?? template.teamId,
      priority: current.priority || (template.priority as TaskPriority),
    }));
    setSteps(template.items.join("\n"));
    setShowSteps(true);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await postTask({ action: "createTask", title, description, ...fields, checklist: steps });
      if (result.task) onCreated(result.task);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar a demanda.");
      setSaving(false);
    }
  }

  return <div className="modal-layer" onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
    <button className="backdrop" onClick={onClose} aria-label="Fechar janela" />
    <form className="modal task-modal" onSubmit={submit} onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void submit(event); }}>
      <div className="modal-head"><div><p className="eyebrow">DEMANDAS</p><h2>Nova demanda</h2><p>Ctrl + Enter cria a demanda.</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
      <div className="task-modal-body">
        {templates.length > 0 && <label className="template-pick"><ListChecks size={14} /><select value={templateId} onChange={(event) => applyTemplate(event.target.value)} aria-label="Usar um modelo"><option value="">Começar do zero</option>{templates.map((template) => <option key={template.id} value={template.id}>Modelo: {template.name} ({template.items.length} passos)</option>)}</select></label>}
        <input className="task-title-input" autoFocus required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Demanda / atividade" />
        <textarea className="task-description-input" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Descrição (opcional)" rows={3} />
        {showSteps ? <label className="task-notes"><span>Checklist (um passo por linha)</span><textarea rows={Math.min(10, Math.max(3, steps.split("\n").length + 1))} value={steps} onChange={(event) => setSteps(event.target.value)} placeholder={"Ex.:\nReunião com o cliente\nConfigurar ambiente\nTreinar a equipe"} /></label>
          : <button type="button" className="link-button template-add-steps" onClick={() => setShowSteps(true)}><ListChecks size={13} /> Adicionar checklist</button>}
        <PropertyFields value={fields} onChange={(changes) => setFields((current) => ({ ...current, ...changes }))} lookups={lookups} compact />
      </div>
      {error && <p className="modal-error">{error}</p>}
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={saving || !title.trim()}>{saving ? "Criando..." : "Criar demanda"}</button></div>
    </form>
  </div>;
}

export function TaskDrawer({ task, lookups, me, today, onClose, onUpdate, onDeleted, onCommented }: { task: Task; lookups: Lookups; me: Me; today: string; onClose: () => void; onUpdate: (changes: Record<string, unknown>) => Promise<void>; onDeleted: () => void; onCommented: () => Promise<void> }) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [notes, setNotes] = useState(task.notes);
  const [events, setEvents] = useState<TaskEvent[] | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [recurrence, setRecurrence] = useState<Recurrence | null | undefined>(undefined);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const loadEvents = useCallback(async () => {
    const response = await fetch(`/api/tasks?taskId=${task.id}`, { cache: "no-store" });
    const data = await response.json() as { events?: TaskEvent[]; checklist?: ChecklistItem[]; recurrence?: Recurrence | null; error?: string };
    if (response.ok && data.events) { setEvents(data.events); setChecklist(data.checklist ?? []); setRecurrence(data.recurrence ?? null); } else setError(data.error || "Não foi possível carregar a atividade.");
  }, [task.id]);

  // Recarrega a atividade quando a demanda muda (status, responsáveis...).
  useEffect(() => { const timer = window.setTimeout(() => { void loadEvents(); }, 0); return () => window.clearTimeout(timer); }, [loadEvents, task.updatedAt]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !(event.target instanceof Element && event.target.closest("textarea, input"))) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save(changes: Record<string, unknown>) {
    setError("");
    await onUpdate(changes);
  }

  async function sendComment(event?: React.FormEvent) {
    event?.preventDefault();
    if (!comment.trim()) return;
    setSending(true);
    setError("");
    try {
      await postTask({ action: "addComment", taskId: task.id, body: comment });
      setComment("");
      await Promise.all([loadEvents(), onCommented()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível comentar.");
    } finally {
      setSending(false);
    }
  }

  async function removeComment(eventId: number) {
    if (!window.confirm("Excluir este comentário?")) return;
    try {
      await postTask({ action: "deleteComment", eventId });
      await Promise.all([loadEvents(), onCommented()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível excluir o comentário.");
    }
  }

  async function removeTask() {
    if (!window.confirm(`Excluir ${taskCode(task.id)} “${task.title}”? Os comentários também serão apagados. Esta ação não pode ser desfeita.`)) return;
    try {
      await postTask({ action: "deleteTask", taskId: task.id });
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível excluir a demanda.");
    }
  }

  const readOnly = !me.canEdit;
  const fields = <PropertyFields key={task.updatedAt} value={task} onChange={(changes) => void save(changes)} lookups={lookups} disabled={readOnly} />;

  return <div className="task-drawer-layer">
    <button className="backdrop" onClick={onClose} aria-label="Fechar demanda" />
    <aside className="task-drawer" role="dialog" aria-label={`${taskCode(task.id)} ${task.title}`}>
      <header className="task-drawer-head">
        <span className="task-code">{taskCode(task.id)}</span>
        <span className="task-drawer-created">{task.createdByName === "Planilha" ? `Importada das planilhas · aberta em ${fullDate(task.openedOn)}` : `Criada por ${task.createdByName} · ${relativeTime(task.createdAt)}`}</span>
        {me.isAdmin && <button className="task-drawer-icon danger" onClick={removeTask} aria-label="Excluir demanda" title="Excluir demanda"><Trash2 size={15} /></button>}
        <button className="task-drawer-icon" onClick={onClose} aria-label="Fechar" title="Fechar (Esc)"><X size={16} /></button>
      </header>
      <div className="task-drawer-body">
        <div className="task-drawer-main">
          {task.codes.length > 0 && <p className="task-legacy">Código{task.codes.length > 1 ? "s" : ""} na planilha: {task.codes.map((code) => <b key={code}>{code}</b>)}</p>}
          <textarea className="task-title-input" rows={1} readOnly={readOnly} value={title} maxLength={160}
            onChange={(event) => setTitle(event.target.value.replace(/\n/g, " "))}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }}
            onBlur={() => { const next = title.trim(); if (!next) setTitle(task.title); else if (next !== task.title) void save({ title: next }); }} />
          <textarea className="task-description-input" readOnly={readOnly} value={description} rows={4} placeholder={readOnly ? "Sem descrição." : "Adicione uma descrição..."}
            onChange={(event) => setDescription(event.target.value)}
            onBlur={() => { if (description !== task.description) void save({ description }); }} />
          <label className="task-notes"><span>OBS / Impedimentos</span><textarea readOnly={readOnly} value={notes} rows={3} placeholder={readOnly ? "Nenhuma observação." : "Bloqueios, dependências, combinados..."} onChange={(event) => setNotes(event.target.value)} onBlur={() => { if (notes !== task.notes) void save({ notes }); }} /></label>
          {task.hoursFlag && <p className="hours-warning"><TriangleAlert size={14} /> As horas vieram da planilha com um valor fora do normal para o período. Confira e corrija em “Horas anteriores”; o aviso some quando o valor for salvo.</p>}
          <div className="mobile-only task-mobile-fields">{fields}</div>

          {error && <p className="modal-error task-drawer-error">{error}</p>}

          <ChecklistPanel taskId={task.id} items={checklist} canEdit={me.canEdit} onChanged={(items) => { setChecklist(items); void onCommented(); }} />

          {recurrence !== undefined && <RecurrencePanel key={`${task.id}-${recurrence?.nextOn ?? "none"}`} taskId={task.id} recurrence={recurrence} canEdit={me.canEdit} onChanged={(value) => { setRecurrence(value); void loadEvents(); }} />}

          <TimeLog task={task} me={me} lookups={lookups} today={today} onSaveBase={(baseHours) => save({ baseHours })} onChanged={onCommented} />

          <AttachmentsPanel ownerType="task" ownerId={task.id} />

          <h3 className="task-activity-title">Atividade</h3>
          {!events ? <div className="loading-list"><span /></div> : <ol className="task-activity">
            {events.map((event) => event.kind === "comment" ? (
              <li key={event.id} className="task-comment">
                <Avatar member={event.actorId ? lookups.membersById.get(event.actorId) : null} size={24} />
                <div><p><strong>{event.actorName}</strong><span>{relativeTime(event.createdAt)}</span>{event.canDelete && <button onClick={() => removeComment(event.id)} aria-label="Excluir comentário" title="Excluir comentário"><Trash2 size={12} /></button>}</p><div className="task-comment-body">{splitMentions(event.body, lookups.members).map((part, index) => part.mention ? <mark key={index} className="mention">{part.text}</mark> : <span key={index}>{part.text}</span>)}</div></div>
              </li>
            ) : (
              <li key={event.id} className="task-change"><span className="task-change-dot" /><p><strong>{event.actorName}</strong> {describeTaskEvent(event.kind, event.body)} <span>· {relativeTime(event.createdAt)}</span></p></li>
            ))}
          </ol>}
          {me.canEdit && <form className="task-comment-form" onSubmit={sendComment}>
            <MentionTextarea value={comment} onChange={setComment} members={lookups.members} onSubmit={() => void sendComment()} />
            <button className="primary-button" disabled={sending || !comment.trim()}><Send size={14} /> {sending ? "Enviando..." : "Comentar"}</button>
          </form>}
        </div>
        <div className="task-drawer-side">
          {fields}
          {task.dueDate && <p className="task-side-note"><DueChip dueDate={task.dueDate} closed={isClosedStatus(task.status)} today={today} /></p>}
          <p className="task-side-note">Aberta em {fullDate(task.openedOn)}{task.completedOn ? ` · concluída em ${fullDate(task.completedOn)}` : ""}</p>
        </div>
      </div>
    </aside>
  </div>;
}

type Template = { id: number; name: string; title: string; description: string; category: string; teamId: number | null; priority: number; items: string[] };

/** Checklist da demanda: marcar, acrescentar, reordenar e apagar passos. */
function ChecklistPanel({ taskId, items, canEdit, onChanged }: { taskId: number; items: ChecklistItem[]; canEdit: boolean; onChanged: (items: ChecklistItem[]) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const progress = checklistProgress(items);

  async function run(payload: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const result = await postTask(payload) as { checklist?: ChecklistItem[] };
      if (result.checklist) onChanged(result.checklist);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    if (await run({ action: "addChecklistItem", taskId, text })) setText("");
  }

  if (!items.length && !canEdit) return null;
  return <section className="checklist">
    <header><h3><ListChecks size={14} /> Checklist</h3>{progress.total > 0 && <span className={progress.complete ? "complete" : ""}>{progress.done} de {progress.total}</span>}</header>
    {progress.total > 0 && <span className="checklist-bar" aria-hidden="true"><i style={{ width: `${progress.percent}%` }} className={progress.complete ? "complete" : ""} /></span>}
    <ul>{items.map((item, index) => <li key={item.id} className={item.done ? "done" : ""}>
      <label><input type="checkbox" checked={item.done} disabled={!canEdit || busy} onChange={(event) => void run({ action: "updateChecklistItem", itemId: item.id, done: event.target.checked })} /><span>{item.text}</span></label>
      {item.done && item.doneByName && <small title={item.doneAt ? new Date(item.doneAt).toLocaleString("pt-BR") : undefined}>{item.doneByName.split(" ")[0]}</small>}
      {canEdit && <span className="checklist-tools">
        <button type="button" disabled={busy || index === 0} onClick={() => void run({ action: "updateChecklistItem", itemId: item.id, move: "up" })} aria-label="Subir passo" title="Subir">↑</button>
        <button type="button" disabled={busy || index === items.length - 1} onClick={() => void run({ action: "updateChecklistItem", itemId: item.id, move: "down" })} aria-label="Descer passo" title="Descer">↓</button>
        <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Apagar o passo “${item.text}”?`)) void run({ action: "deleteChecklistItem", itemId: item.id }); }} aria-label="Apagar passo" title="Apagar"><Trash2 size={12} /></button>
      </span>}
    </li>)}</ul>
    {canEdit && <form className="checklist-add" onSubmit={add}><input value={text} maxLength={200} onChange={(event) => setText(event.target.value)} placeholder="Novo passo e Enter" aria-label="Novo passo" /><button className="secondary-button" disabled={busy || !text.trim()}><Plus size={13} /> Adicionar</button></form>}
    {error && <p className="modal-error">{error}</p>}
  </section>;
}

/** Modelos de demanda (administrador): nome, campos padrão e passos do checklist. */
export function TemplatesModal({ lookups, onClose }: { lookups: Lookups; onClose: () => void }) {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [editing, setEditing] = useState<Template | "new" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/templates", { cache: "no-store" });
      const data = await response.json() as { templates?: Template[]; error?: string };
      if (!response.ok || !data.templates) throw new Error(data.error || "Não foi possível carregar os modelos.");
      setTemplates(data.templates);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar os modelos.");
    }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  async function post(payload: Record<string, unknown>) {
    const response = await fetch("/api/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json() as { error?: string; created?: number };
    if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
    return data;
  }

  async function createExamples() {
    setError(""); setNotice("");
    try { const result = await post({ action: "createExamples" }); setNotice(result.created ? `${result.created} modelo${result.created === 1 ? "" : "s"} de exemplo criado${result.created === 1 ? "" : "s"}. Ajuste à vontade.` : "Os modelos de exemplo já existem."); await load(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível criar."); }
  }

  return <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><div className="modal templates-modal">
    <div className="modal-head"><div><p className="eyebrow">DEMANDAS</p><h2>Modelos de demanda</h2><p>Um modelo já traz categoria, time, prioridade e os passos do checklist. Aparece em “Nova demanda”.</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
    <div className="templates-body">
      {error && <p className="modal-error">{error}</p>}
      {notice && !error && <p className="jira-notice">{notice}</p>}
      {!templates ? <div className="loading-list"><span /></div> : templates.length ? <ul className="templates-list">{templates.map((template) => <li key={template.id}>
        <div><strong>{template.name}</strong><small>{template.items.length} passos{template.category ? ` · ${template.category}` : ""}{template.teamId ? ` · ${lookups.teams.find((team) => team.id === template.teamId)?.name ?? ""}` : ""}</small></div>
        <button className="person-edit" onClick={() => setEditing(template)} aria-label={`Editar ${template.name}`} title="Editar"><Pencil size={14} /></button>
        <button className="person-edit" onClick={async () => { if (!window.confirm(`Excluir o modelo “${template.name}”? As demandas já criadas não mudam.`)) return; try { await post({ action: "deleteTemplate", templateId: template.id }); await load(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível excluir."); } }} aria-label={`Excluir ${template.name}`} title="Excluir"><Trash2 size={14} /></button>
      </li>)}</ul> : <p className="muted">Nenhum modelo ainda. Comece pelos exemplos (implantação de cliente, publicação de versão e novo colaborador) e ajuste ao jeito de vocês.</p>}
      <div className="templates-actions"><button className="primary-button" onClick={() => setEditing("new")}><Plus size={15} /> Novo modelo</button><button className="secondary-button" onClick={createExamples}><ListChecks size={15} /> Criar modelos de exemplo</button></div>
    </div>
    {editing && <TemplateForm value={editing === "new" ? null : editing} lookups={lookups} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} save={post} />}
  </div></div>;
}

function TemplateForm({ value, lookups, onClose, onSaved, save }: { value: Template | null; lookups: Lookups; onClose: () => void; onSaved: () => void; save: (payload: Record<string, unknown>) => Promise<unknown> }) {
  const [form, setForm] = useState({ name: value?.name ?? "", title: value?.title ?? "", description: value?.description ?? "", category: value?.category ?? "", teamId: String(value?.teamId ?? ""), priority: String(value?.priority ?? 0), items: (value?.items ?? []).join("\n") });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await save({ action: "saveTemplate", templateId: value?.id, ...form, teamId: form.teamId ? Number(form.teamId) : null, priority: Number(form.priority) });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
      setSaving(false);
    }
  }
  return <div className="modal-layer nested"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><form className="modal" onSubmit={submit}>
    <div className="modal-head"><div><p className="eyebrow">MODELO</p><h2>{value ? "Editar modelo" : "Novo modelo"}</h2><p>Mudar o modelo não altera as demandas já criadas com ele.</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
    <div className="form-grid">
      <label className="full"><span>Nome do modelo</span><input autoFocus required maxLength={60} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ex.: Implantação de cliente" /></label>
      <label className="full"><span>Título sugerido (opcional)</span><input maxLength={160} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Ex.: Implantação · " /></label>
      <label><span>Categoria</span><select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option value="">Sem categoria</option>{lookups.categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
      <label><span>Time</span><select value={form.teamId} onChange={(event) => setForm({ ...form, teamId: event.target.value })}><option value="">Sem time</option>{lookups.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
      <label><span>Prioridade</span><select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}>{taskPriorities.map((priority) => <option key={priority} value={priority}>{taskPriorityLabels[priority]}</option>)}</select></label>
      <label className="full"><span>Descrição (opcional)</span><textarea rows={2} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
      <label className="full"><span>Passos do checklist (um por linha)</span><textarea required rows={8} value={form.items} onChange={(event) => setForm({ ...form, items: event.target.value })} placeholder={"Reunião com o cliente\nReceber acessos\nConfigurar ambiente"} /></label>
    </div>
    {error && <p className="modal-error">{error}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={saving || !form.name.trim() || !form.items.trim()}>{saving ? "Salvando..." : "Salvar modelo"}</button></div>
  </form></div>;
}

type LoggedEntry = TimeEntry & { canDelete: boolean };

/** Apontamento de horas da demanda: total, horas anteriores e lançamentos por pessoa e dia. */
function TimeLog({ task, me, lookups, today, onSaveBase, onChanged }: { task: Task; me: Me; lookups: Lookups; today: string; onSaveBase: (value: number | null) => Promise<void>; onChanged: () => Promise<void> }) {
  const [entries, setEntries] = useState<LoggedEntry[] | null>(null);
  const [form, setForm] = useState({ workDate: today, hours: "", note: "", memberId: String(me.id) });
  const [base, setBase] = useState(task.baseHours?.toString().replace(".", ",") ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/time-entries?taskId=${task.id}`, { cache: "no-store" });
    const data = await response.json() as { entries?: LoggedEntry[]; error?: string };
    if (response.ok && data.entries) setEntries(data.entries); else { setEntries([]); setError(data.error || "Não foi possível carregar as horas."); }
  }, [task.id]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  async function post(body: Record<string, unknown>) {
    const response = await fetch("/api/time-entries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json() as { error?: string; message?: string };
    if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
    return data;
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const hours = parseEntryHours(form.hours);
    if (hours === null) { setError("Informe as horas: por exemplo 1,5 ou 1:30."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await post({ action: "addEntry", taskId: task.id, workDate: form.workDate, hours: form.hours, note: form.note, memberId: Number(form.memberId) });
      setForm({ ...form, hours: "", note: "" });
      setNotice(result.message ?? "Horas lançadas.");
      await Promise.all([load(), onChanged()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível lançar as horas.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(entry: LoggedEntry) {
    if (!window.confirm(`Excluir o lançamento de ${formatHours(entry.hours)} de ${entry.memberName} em ${fullDate(entry.workDate)}?`)) return;
    setError(""); setNotice("");
    try {
      await post({ action: "deleteEntry", entryId: entry.id });
      await Promise.all([load(), onChanged()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível excluir.");
    }
  }

  function commitBase() {
    const text = base.trim();
    const parsed = text ? Number(text.replace(",", ".")) : null;
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) { setBase(task.baseHours?.toString().replace(".", ",") ?? ""); return; }
    if (parsed !== task.baseHours) void onSaveBase(parsed);
  }

  const logged = (entries ?? []).reduce((sum, entry) => sum + entry.hours, 0);
  const total = task.workedHours ?? 0;
  const estimate = task.estimatedHours;
  const canLog = me.canEdit;
  const people = me.isAdmin ? lookups.members : lookups.members.filter((member) => member.id === me.id);

  return <section className="time-log">
    <header className="time-log-head">
      <h3>Horas</h3>
      <p><strong>{formatHours(total)}</strong> no total{estimate ? <> de <b>{formatHours(estimate)}</b> estimadas{total > estimate && <span className="time-log-over"> · {formatHours(total - estimate)} acima</span>}</> : null}</p>
    </header>
    {estimate ? <span className="time-log-bar" aria-hidden="true"><i className={total > estimate ? "over" : ""} style={{ width: `${Math.min(100, (total / estimate) * 100)}%` }} /></span> : null}
    <p className="time-log-split">
      {task.baseHours !== null || me.isAdmin ? <label>Horas anteriores <input disabled={!canLog} inputMode="decimal" value={base} onChange={(event) => setBase(event.target.value)} onBlur={commitBase} placeholder="0" /> h</label> : null}
      <span>{formatHours(logged)} lançadas{entries && entries.length ? ` em ${entries.length} registro${entries.length > 1 ? "s" : ""}` : ""}</span>
    </p>
    {canLog && people.length > 0 && <form className="time-log-form" onSubmit={add}>
      {me.isAdmin && <select aria-label="Pessoa" value={form.memberId} onChange={(event) => setForm({ ...form, memberId: event.target.value })}>{people.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select>}
      <input aria-label="Dia trabalhado" type="date" max={today} value={form.workDate} onChange={(event) => setForm({ ...form, workDate: event.target.value })} required />
      <input aria-label="Horas" className="time-log-hours" inputMode="decimal" placeholder="1:30" value={form.hours} onChange={(event) => setForm({ ...form, hours: event.target.value })} required />
      <input aria-label="O que foi feito" className="time-log-note" maxLength={300} placeholder="O que foi feito (opcional)" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
      <button className="primary-button" disabled={busy || !form.hours.trim()}><Clock size={14} /> {busy ? "Lançando..." : "Lançar"}</button>
    </form>}
    {error && <p className="modal-error">{error}</p>}
    {notice && !error && <p className="time-log-notice">{notice}</p>}
    {entries && entries.length > 0 && <ul className="time-log-list">
      {[...entries].reverse().map((entry) => <li key={entry.id}>
        <span className="time-log-date">{fullDate(entry.workDate)}</span>
        <span className="time-log-person">{entry.memberName}</span>
        <b>{formatHours(entry.hours)}</b>
        <span className="time-log-text">{entry.note}</span>
        {entry.canDelete && <button onClick={() => remove(entry)} aria-label="Excluir lançamento" title="Excluir lançamento"><Trash2 size={12} /></button>}
      </li>)}
    </ul>}
  </section>;
}

/** Lista de clientes/projetos usada nos menus (antes ficava na aba Configurações das planilhas). */
export function ClientsModal({ clients, tasks, onClose, onSaved }: { clients: TaskClient[]; tasks: Task[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const usage = useMemo(() => {
    const counts = new Map<number, number>();
    for (const task of tasks) if (task.clientId) counts.set(task.clientId, (counts.get(task.clientId) ?? 0) + 1);
    return counts;
  }, [tasks]);

  async function save(payload: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      await postTask({ action: "saveClient", ...payload });
      await onSaved();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><div className="modal clients-modal">
    <div className="modal-head"><div><p className="eyebrow">DEMANDAS</p><h2>Clientes e projetos</h2><p>É a lista que aparece em “Cliente / Projeto”. Desativar tira o nome dos menus sem mexer nas demandas antigas.</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
    <form className="clients-add" onSubmit={async (event) => { event.preventDefault(); if (name.trim() && await save({ name })) setName(""); }}>
      <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="Novo cliente ou projeto" />
      <button className="primary-button" disabled={busy || !name.trim()}><Plus size={15} /> Adicionar</button>
    </form>
    {error && <p className="modal-error">{error}</p>}
    <ul className="clients-list">{clients.map((client) => <li key={client.id} className={client.active ? "" : "inactive"}>
      {editing?.id === client.id
        ? <form onSubmit={async (event) => { event.preventDefault(); if (await save({ clientId: client.id, name: editing.name, active: client.active })) setEditing(null); }}><input autoFocus value={editing.name} maxLength={80} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /><button className="secondary-button" disabled={busy}>Salvar</button><button type="button" className="secondary-button" onClick={() => setEditing(null)}>Cancelar</button></form>
        : <><strong>{client.name}</strong><small>{usage.get(client.id) ?? 0} demanda{usage.get(client.id) === 1 ? "" : "s"}</small><button type="button" className="person-edit" onClick={() => setEditing({ id: client.id, name: client.name })} aria-label={`Renomear ${client.name}`}>✎</button><button type="button" className={`access-toggle ${client.active ? "active" : "inactive"}`} disabled={busy} onClick={() => void save({ clientId: client.id, name: client.name, active: !client.active })}>{client.active ? "Ativo" : "Desativado"}</button></>}
    </li>)}</ul>
  </div></div>;
}
