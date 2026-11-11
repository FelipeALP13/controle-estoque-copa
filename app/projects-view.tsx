"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Download from "lucide-react/icons/download";
import FolderKanban from "lucide-react/icons/folder-kanban";
import { downloadXlsx } from "./xlsx-writer";
import Link2 from "lucide-react/icons/link-2";
import Plus from "lucide-react/icons/plus";
import Search from "lucide-react/icons/search";
import Trash2 from "lucide-react/icons/trash-2";
import X from "lucide-react/icons/x";
import { isClosedProject, projectCode, projectFarolEmoji, projectFarolLabels, projectFarois, projectPhaseLabels, projectPhases, projectProgress, type ProjectFarol, type ProjectPhase } from "./projects";
import { AvatarStack, PeoplePicker, StatusIcon } from "./tasks-view";
import { taskCode, taskStatuses, taskStatusLabels, type TaskStatus } from "./tasks";

type Person = { id: number; name: string; avatarIcon: string; avatarKey: string | null };
type Client = { id: number; name: string; active: boolean };
type LinkedTask = { id: number; title: string; status: TaskStatus; dueDate: string | null };
type Project = {
  id: number; name: string; description: string; clientId: number | null; status: TaskStatus; farol: ProjectFarol; phase: ProjectPhase;
  deadlineLabel: string; startDate: string | null; endForecast: string; notes: string; updatedAt: string; people: number[]; tasks: LinkedTask[];
};
type Data = { projects: Project[]; unlinked: (LinkedTask & { clientId: number | null })[]; members: Person[]; clients: Client[]; me: { id: number; canEdit: boolean; isAdmin: boolean } };

const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");

function fullDate(value: string | null) {
  if (!value) return "";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

async function post(payload: Record<string, unknown>) {
  const response = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json() as { error?: string; project?: Project };
  if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
  return data;
}

function FarolDot({ farol }: { farol: ProjectFarol }) {
  return <span className={`farol-dot ${farol}`} title={`Farol ${projectFarolLabels[farol]}`} aria-label={`Farol ${projectFarolLabels[farol]}`} />;
}

function Progress({ statuses }: { statuses: string[] }) {
  const progress = projectProgress(statuses);
  if (!progress.total) return <span className="project-progress empty">Sem demandas ligadas</span>;
  return <span className="project-progress" title={`${progress.done} de ${progress.total} demandas concluídas`}>
    <span className="bar"><i style={{ width: `${progress.percent}%` }} /></span>
    <span>{progress.done}/{progress.total}</span>
  </span>;
}

export default function ProjectsView({ onOpenTask }: { onOpenTask: (taskId: number) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<"active" | "closed" | "all">("active");
  const [farol, setFarol] = useState("");
  const [phase, setPhase] = useState("");
  const [openId, setOpenId] = useState<number | "new" | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/projects", { cache: "no-store" });
      const json = await response.json() as Data & { error?: string };
      if (!response.ok) throw new Error(json.error || "Não foi possível carregar os projetos.");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar os projetos.");
    }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  const clientsById = useMemo(() => new Map((data?.clients ?? []).map((client) => [client.id, client])), [data]);
  const membersById = useMemo(() => new Map((data?.members ?? []).map((member) => [member.id, member])), [data]);
  const visible = useMemo(() => (data?.projects ?? []).filter((project) => {
    const closed = isClosedProject(project);
    if (scope === "active" && closed) return false;
    if (scope === "closed" && !closed) return false;
    if (farol && project.farol !== farol) return false;
    if (phase && project.phase !== phase) return false;
    const client = project.clientId ? clientsById.get(project.clientId)?.name ?? "" : "";
    return !search.trim() || fold(`${projectCode(project.id)} ${project.name} ${client} ${project.description}`).includes(fold(search.trim()));
  }), [data, scope, farol, phase, search, clientsById]);

  const counts = useMemo(() => {
    const active = (data?.projects ?? []).filter((project) => !isClosedProject(project));
    return Object.fromEntries(projectFarois.map((value) => [value, active.filter((project) => project.farol === value).length])) as Record<ProjectFarol, number>;
  }, [data]);

  // Exporta os projetos que estão na tela (situação, farol, fase e busca), com as demandas de cada um.
  function exportExcel() {
    if (!data) return;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    const clientName = (id: number | null) => (id ? clientsById.get(id)?.name ?? "" : "");
    downloadXlsx(`projetos-${today}.xlsx`, [
      {
        name: "Projetos",
        columns: [
          { header: "Código", width: 9 }, { header: "Projeto", width: 34 }, { header: "Cliente", width: 20 }, { header: "Farol", width: 10 }, { header: "Fase", width: 14 }, { header: "Status", width: 16 },
          { header: "Prazo", width: 16 }, { header: "Início", type: "date", width: 12 }, { header: "Previsão de término", width: 18 }, { header: "Responsáveis", width: 30 },
          { header: "Demandas ligadas", type: "number", width: 16 }, { header: "Concluídas", type: "number", width: 11 }, { header: "Andamento", type: "percent", width: 11 },
          { header: "Escopo", width: 50 }, { header: "Observações", width: 40 },
        ],
        rows: visible.map((project) => {
          const progress = projectProgress(project.tasks.map((task) => task.status));
          return [
            projectCode(project.id), project.name, clientName(project.clientId), projectFarolLabels[project.farol], projectPhaseLabels[project.phase], taskStatusLabels[project.status],
            project.deadlineLabel, project.startDate, fullDate(project.endForecast), project.people.map((id) => membersById.get(id)?.name ?? "").filter(Boolean).join(", "),
            progress.total, progress.done, progress.total ? progress.done / progress.total : null, project.description, project.notes,
          ];
        }),
      },
      {
        name: "Demandas dos projetos",
        columns: [{ header: "Projeto", width: 9 }, { header: "Nome do projeto", width: 30 }, { header: "Demanda", width: 10 }, { header: "Título", width: 48 }, { header: "Status", width: 18 }, { header: "Prazo", type: "date", width: 12 }],
        rows: visible.flatMap((project) => project.tasks.map((task) => [projectCode(project.id), project.name, taskCode(task.id), task.title, taskStatusLabels[task.status], task.dueDate])),
      },
      {
        name: "Filtros",
        columns: [{ header: "Filtro", width: 20 }, { header: "Valor", width: 40 }],
        rows: [
          ["Exportado em", new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })],
          ["Projetos no arquivo", `${visible.length} de ${data.projects.length}`],
          ["Situação", scope === "active" ? "Em andamento" : scope === "closed" ? "Encerrados" : "Todos"],
          ["Farol", farol ? projectFarolLabels[farol as ProjectFarol] : "Todos"],
          ["Fase", phase ? projectPhaseLabels[phase as ProjectPhase] : "Todas"],
          ["Busca", search.trim() || "—"],
        ],
      },
    ]);
  }

  if (!data) return error ? <div className="alert error"><span>{error}</span></div> : <div className="loading-list">{[1, 2, 3].map((line) => <span key={line} />)}</div>;
  const open = openId === "new" ? null : data.projects.find((project) => project.id === openId) ?? null;

  return <div className="projects-page">
    <div className="farol-summary">{projectFarois.map((value) => <button key={value} className={farol === value ? "active" : ""} onClick={() => setFarol(farol === value ? "" : value)}><FarolDot farol={value} /><strong>{counts[value]}</strong><span>{projectFarolLabels[value]}</span></button>)}<small>Projetos em andamento por farol. Clique para filtrar.</small></div>

    <div className="tasks-toolbar">
      <div className="tasks-scope" role="group" aria-label="Quais projetos">
        {([["active", "Em andamento"], ["closed", "Encerrados"], ["all", "Todos"]] as const).map(([value, label]) => <button key={value} className={scope === value ? "active" : ""} aria-pressed={scope === value} onClick={() => setScope(value)}>{label}</button>)}
      </div>
      <label className="tasks-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar projeto, cliente ou escopo" /></label>
      <select aria-label="Filtrar por fase" value={phase} onChange={(event) => setPhase(event.target.value)}><option value="">Todas as fases</option>{projectPhases.map((value) => <option key={value} value={value}>{projectPhaseLabels[value]}</option>)}</select>
      <button className="secondary-button" onClick={exportExcel} disabled={!visible.length} title="Baixa em Excel os projetos que estão na tela, com as demandas de cada um"><Download size={15} /> Exportar Excel</button>
      {data.me.canEdit && <button className="primary-button tasks-new" onClick={() => setOpenId("new")}><Plus size={16} /> Novo projeto</button>}
    </div>

    {error && <div className="alert error"><span>{error}</span><button onClick={() => setError("")} aria-label="Fechar aviso"><X size={16} /></button></div>}

    {visible.length === 0 ? <div className="empty-state"><span><FolderKanban /></span><h3>{data.projects.length ? "Nenhum projeto com esses filtros" : "Nenhum projeto ainda"}</h3><p>{data.projects.length ? "Troque os filtros ou a busca." : "Importe a planilha da Liderança em Demandas → Importar planilhas, ou crie o primeiro projeto."}</p></div> : (
      <div className="project-table">
        <div className="project-head"><span>Projeto</span><span>Fase</span><span>Status</span><span>Prazo</span><span>Demandas</span><span>Responsáveis</span></div>
        {visible.map((project) => {
          const client = project.clientId ? clientsById.get(project.clientId) : null;
          return <button key={project.id} className="project-row" onClick={() => setOpenId(project.id)}>
            <span className="project-name"><FarolDot farol={project.farol} /><span><strong>{project.name}</strong><small>{projectCode(project.id)}{client ? ` · ${client.name}` : ""}</small></span></span>
            <span className="project-phase">{projectPhaseLabels[project.phase]}</span>
            <span className="project-status"><StatusIcon status={project.status} />{taskStatusLabels[project.status]}</span>
            <span className="project-deadline">{project.deadlineLabel || "—"}{project.endForecast && <small>{project.endForecast.match(/^\d{4}-/) ? `até ${fullDate(project.endForecast)}` : project.endForecast}</small>}</span>
            <Progress statuses={project.tasks.map((task) => task.status)} />
            <AvatarStack ids={project.people} membersById={membersById} />
          </button>;
        })}
      </div>
    )}

    {openId !== null && <ProjectDrawer key={openId} project={open} data={data} onClose={() => setOpenId(null)} onSaved={async (id) => { await load(); setOpenId(id); }} onDeleted={async () => { setOpenId(null); await load(); }} onOpenTask={onOpenTask} />}
  </div>;
}

function ProjectDrawer({ project, data, onClose, onSaved, onDeleted, onOpenTask }: { project: Project | null; data: Data; onClose: () => void; onSaved: (id: number) => Promise<void>; onDeleted: () => Promise<void>; onOpenTask: (taskId: number) => void }) {
  const [form, setForm] = useState({
    name: project?.name ?? "", description: project?.description ?? "", clientId: project?.clientId ?? null as number | null,
    status: project?.status ?? "todo" as TaskStatus, farol: project?.farol ?? "blue" as ProjectFarol, phase: project?.phase ?? "planning" as ProjectPhase,
    deadlineLabel: project?.deadlineLabel ?? "", startDate: project?.startDate ?? "", endForecast: project?.endForecast ?? "", notes: project?.notes ?? "", people: project?.people ?? [],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [linkQuery, setLinkQuery] = useState("");
  const readOnly = !data.me.canEdit;
  const dirty = !project || JSON.stringify(form) !== JSON.stringify({ name: project.name, description: project.description, clientId: project.clientId, status: project.status, farol: project.farol, phase: project.phase, deadlineLabel: project.deadlineLabel, startDate: project.startDate ?? "", endForecast: project.endForecast, notes: project.notes, people: project.people });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !(event.target as HTMLElement).closest("textarea, input, select")) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function run(action: () => Promise<void>) {
    setSaving(true);
    setError("");
    try { await action(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível salvar."); } finally { setSaving(false); }
  }

  const save = () => run(async () => {
    const result = await post({ action: "saveProject", projectId: project?.id, ...form, startDate: form.startDate || null });
    if (result.project) await onSaved(result.project.id);
  });

  const candidates = data.unlinked.filter((task) => !linkQuery.trim() || fold(`${taskCode(task.id)} ${task.title}`).includes(fold(linkQuery.trim())))
    .sort((a, b) => Number(b.clientId === form.clientId) - Number(a.clientId === form.clientId)).slice(0, 8);

  return <div className="task-drawer-layer">
    <button className="backdrop" onClick={onClose} aria-label="Fechar projeto" />
    <aside className="task-drawer project-drawer" role="dialog" aria-label={project ? `${projectCode(project.id)} ${project.name}` : "Novo projeto"}>
      <header className="task-drawer-head">
        <span className="task-code">{project ? projectCode(project.id) : "Novo projeto"}</span>
        <span className="task-drawer-created">{project ? `Atualizado em ${fullDate(project.updatedAt.slice(0, 10))}` : "Projeto grande da liderança"}</span>
        {project && data.me.isAdmin && <button className="task-drawer-icon danger" onClick={() => run(async () => { if (!window.confirm(`Excluir ${projectCode(project.id)} “${project.name}”? As demandas ligadas continuam existindo, só perdem o vínculo.`)) return; await post({ action: "deleteProject", projectId: project.id }); await onDeleted(); })} aria-label="Excluir projeto" title="Excluir projeto"><Trash2 size={15} /></button>}
        <button className="task-drawer-icon" onClick={onClose} aria-label="Fechar" title="Fechar (Esc)"><X size={16} /></button>
      </header>
      <div className="project-drawer-body">
        <input className="task-title-input" readOnly={readOnly} value={form.name} maxLength={160} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Nome do projeto (história de usuário)" autoFocus={!project} />
        <div className="project-form">
          <label className="task-prop"><span>Farol</span><span className="farol-options">{projectFarois.map((value) => <button type="button" key={value} disabled={readOnly} className={form.farol === value ? "active" : ""} onClick={() => setForm({ ...form, farol: value })} title={projectFarolLabels[value]}>{projectFarolEmoji[value]} {projectFarolLabels[value]}</button>)}</span></label>
          <label className="task-prop"><span>Fase do projeto</span><span className="task-prop-control"><select disabled={readOnly} value={form.phase} onChange={(event) => setForm({ ...form, phase: event.target.value as ProjectPhase })}>{projectPhases.map((value) => <option key={value} value={value}>{projectPhaseLabels[value]}</option>)}</select></span></label>
          <label className="task-prop"><span>Status</span><span className="task-prop-control"><StatusIcon status={form.status} /><select disabled={readOnly} value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as TaskStatus })}>{taskStatuses.map((value) => <option key={value} value={value}>{taskStatusLabels[value]}</option>)}</select></span></label>
          <label className="task-prop"><span>Cliente / Projeto</span><span className="task-prop-control"><select disabled={readOnly} value={form.clientId ?? ""} onChange={(event) => setForm({ ...form, clientId: event.target.value ? Number(event.target.value) : null })}><option value="">Sem cliente</option>{data.clients.filter((client) => client.active || client.id === form.clientId).map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></span></label>
          <label className="task-prop"><span>Prazo</span><span className="task-prop-control"><input disabled={readOnly} maxLength={60} value={form.deadlineLabel} onChange={(event) => setForm({ ...form, deadlineLabel: event.target.value })} placeholder="Ex.: 2 semanas" /></span></label>
          <label className="task-prop"><span>Data de início</span><span className="task-prop-control"><input disabled={readOnly} type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></span></label>
          <label className="task-prop"><span>Previsão de encerramento</span><span className="task-prop-control"><input disabled={readOnly} maxLength={60} value={form.endForecast.match(/^\d{4}-\d{2}-\d{2}$/) ? fullDate(form.endForecast) : form.endForecast} onChange={(event) => setForm({ ...form, endForecast: event.target.value })} placeholder="Ex.: 28/11/2026 ou A definir" /></span></label>
          <PeoplePicker label="Responsáveis" value={form.people} onChange={(people) => setForm({ ...form, people })} members={data.members} disabled={readOnly} />
        </div>
        <label className="task-notes"><span>Descrição / Escopo</span><textarea readOnly={readOnly} rows={4} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
        <label className="task-notes"><span>OBS / Impedimentos / Bloqueios</span><textarea readOnly={readOnly} rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
        {error && <p className="modal-error">{error}</p>}
        {!readOnly && <div className="project-save"><button className="primary-button" disabled={saving || !dirty || !form.name.trim()} onClick={() => void save()}>{saving ? "Salvando..." : project ? "Salvar alterações" : "Criar projeto"}</button>{project && dirty && <small>Há alterações não salvas.</small>}</div>}

        {project && <section className="project-tasks">
          <h3>Demandas do projeto <Progress statuses={project.tasks.map((task) => task.status)} /></h3>
          {project.tasks.length ? <ul>{project.tasks.map((task) => <li key={task.id}>
            <button className="project-task" onClick={() => onOpenTask(task.id)}><StatusIcon status={task.status} /><span className="task-code">{taskCode(task.id)}</span><span>{task.title}</span><small>{taskStatusLabels[task.status]}</small></button>
            {!readOnly && <button className="person-edit" title="Tirar do projeto" aria-label={`Tirar ${taskCode(task.id)} do projeto`} onClick={() => run(async () => { await post({ action: "unlinkTask", projectId: project.id, taskId: task.id }); await onSaved(project.id); })}><X size={13} /></button>}
          </li>)}</ul> : <p className="muted">Nenhuma demanda ligada. Ligue as demandas que fazem parte deste projeto para acompanhar o andamento.</p>}
          {!readOnly && <div className="project-link">
            <label className="tasks-search"><Link2 size={14} /><input value={linkQuery} onChange={(event) => setLinkQuery(event.target.value)} placeholder="Ligar demanda em aberto: busque por título ou código" /></label>
            {linkQuery.trim() && <ul>{candidates.length ? candidates.map((task) => <li key={task.id}><button onClick={() => run(async () => { await post({ action: "linkTasks", projectId: project.id, taskIds: [task.id] }); setLinkQuery(""); await onSaved(project.id); })}><Plus size={13} /><span className="task-code">{taskCode(task.id)}</span>{task.title}</button></li>) : <li className="muted">Nenhuma demanda em aberto sem projeto com esse texto.</li>}</ul>}
          </div>}
        </section>}
      </div>
    </aside>
  </div>;
}
