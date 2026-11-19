"use client";

// Peças do chat usadas pela tela de Conversas e pelo painel lateral: a conversa, o campo de mensagem,
// formatação, emojis, GIFs e anexos.
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ChevronLeft from "lucide-react/icons/chevron-left";
import ChevronRight from "lucide-react/icons/chevron-right";
import Download from "lucide-react/icons/download";
import ExternalLink from "lucide-react/icons/external-link";
import AlarmClock from "lucide-react/icons/alarm-clock";
import CalendarClock from "lucide-react/icons/calendar-clock";
import Vote from "lucide-react/icons/vote";
import { PollCard, PollModal, type PollItem } from "./team-wall";
import ArrowLeft from "lucide-react/icons/arrow-left";
import Hash from "lucide-react/icons/hash";
import ImagePlus from "lucide-react/icons/image-plus";
import ListPlus from "lucide-react/icons/list-plus";
import ListTodo from "lucide-react/icons/list-todo";
import Maximize2 from "lucide-react/icons/maximize-2";
import Paperclip from "lucide-react/icons/paperclip";
import Pencil from "lucide-react/icons/pencil";
import Pin from "lucide-react/icons/pin";
import PinOff from "lucide-react/icons/pin-off";
import Reply from "lucide-react/icons/reply";
import Search from "lucide-react/icons/search";
import SendHorizontal from "lucide-react/icons/send-horizontal";
import Smile from "lucide-react/icons/smile";
import SmilePlus from "lucide-react/icons/smile-plus";
import Trash2 from "lucide-react/icons/trash-2";
import UsersRound from "lucide-react/icons/users-round";
import X from "lucide-react/icons/x";
import { isoToLocal } from "./agenda";
import { splitMentions } from "./notifications";
import { CHAT_CHANGED, OPEN_TASK_EVENT } from "./sidebar-nav";
import { taskPriorities, taskPriorityLabels } from "./tasks";
import { EMOJI_GROUPS, groupMessages, localInputToIso, MAX_ATTACHMENTS, MAX_MESSAGE, parseMarkdown, REACTIONS, reminderPresets, splitLinks, STATUS_DURATIONS, STATUS_KINDS, STATUS_LABELS, taskTitleFromMessage, typingText, type Inline, type PersonStatus, type StatusKind } from "./social-tools";
import { Avatar, MentionTextarea } from "./task-shared";

export type Status = PersonStatus & { untilLabel: string | null };
export type Person = { id: number; name: string; jobTitle?: string; avatarIcon: string; avatarKey: string | null; teamColor?: string | null; teamName?: string | null; online?: boolean; status?: Status | null };
export type Reaction = { emoji: string; count: number; mine: boolean; names: string[] };
export type Me = { id: number; isAdmin: boolean; canCreateTasks?: boolean; status?: Status | null };
type Attachment = { url: string; gif: boolean; width: number; height: number };
type Message = { id: number; memberId: number | null; authorName: string; createdAt: string; editedAt: string | null; deleted: boolean; body: string; attachments: Attachment[]; replyToId: number | null; reply: { authorName: string; body: string } | null; reactions: Reaction[]; pinned: boolean; task: { id: number; code: string; title: string; done: boolean } | null; reminderAt: string | null; reminderLabel: string | null; poll?: PollItem | null };
type Scheduled = { id: number; body: string; sendAt: string };

/** Menu "Agendar envio": atalhos (daqui a 1 h, amanhã 9h, segunda 9h) ou dia e hora escolhidos. */
function ScheduleMenu({ onPick, onClose }: { onPick: (at: string) => void; onClose: () => void }) {
  const [custom, setCustom] = useState("");
  const presets = reminderPresets(new Date()).filter((preset) => !preset.label.startsWith("Em 20"));
  return <div className="cv-popover cv-schedule" role="dialog" aria-label="Agendar envio">
    <p>Enviar a mensagem…</p>
    {presets.map((preset) => <button key={preset.label} type="button" onClick={() => onPick(preset.at)}>{preset.label.replace(/^Em /, "Daqui a ")}</button>)}
    <label><span>Outro dia e hora</span><input type="datetime-local" value={custom} onChange={(event) => setCustom(event.target.value)} /></label>
    <div className="cv-schedule-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button type="button" className="primary-button" disabled={!localInputToIso(custom)} onClick={() => { const at = localInputToIso(custom); if (at) onPick(at); }}>Agendar</button></div>
  </div>;
}
export type ChannelInfo = { id: number; kind: "channel" | "dm"; name: string; description: string; archived: boolean; peerId: number | null; canManage: boolean };
type Gif = { id: string; title: string; url: string; preview: string; width: number; height: number };
export type Pending = { key: string; url: string };

export async function call(path: string, payload: Record<string, unknown>) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json() as Record<string, unknown> & { error?: string };
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir.");
  return data;
}

/** Envia uma imagem (foto ou GIF) para o armazenamento do Portal. */
export async function uploadImage(file: File, kind: "chat") {
  const form = new FormData();
  form.append("kind", kind);
  form.append("file", file);
  const response = await fetch("/api/media", { method: "POST", body: form });
  const json = await response.json() as { imageKey?: string; imageUrl?: string; error?: string };
  if (!response.ok || !json.imageKey || !json.imageUrl) throw new Error(json.error || "Não foi possível enviar a imagem.");
  return { key: json.imageKey, url: json.imageUrl };
}

const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const yesterdayIso = () => new Date(Date.parse(`${todayIso()}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
/** Horário curto: "14:05", "Ontem" ou "12/11". */
export function shortWhen(iso: string) {
  const { day, time } = isoToLocal(iso);
  if (day === todayIso()) return time;
  if (day === yesterdayIso()) return "Ontem";
  return day.slice(5).split("-").reverse().join("/");
}
function dayLabel(day: string) {
  if (day === todayIso()) return "Hoje";
  if (day === yesterdayIso()) return "Ontem";
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
}
export const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");
export const roleColor = (color?: string | null) => (color ? `role-${color}` : "");

function Spoiler({ text, children }: { text: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return <span className={`spoiler ${open ? "open" : ""}`} role="button" tabIndex={0} aria-label={open ? text : "Spoiler: clique para ver"} onClick={() => setOpen(true)} onKeyDown={(event) => { if (event.key === "Enter") setOpen(true); }}>{children}</span>;
}

/** Texto com @menções e links. */
export function Plain({ text, people }: { text: string; people: Person[] }) {
  return <>{splitMentions(text, people).map((part, index) => part.mention
    ? <span key={index} className="mention">{part.text}</span>
    : <Fragment key={index}>{splitLinks(part.text).map((piece, inner) => piece.href ? <a key={inner} href={piece.href} target="_blank" rel="noopener noreferrer">{piece.text}</a> : <Fragment key={inner}>{piece.text}</Fragment>)}</Fragment>)}</>;
}

function InlineText({ pieces, people }: { pieces: Inline[]; people: Person[] }) {
  return <>{pieces.map((piece, index) => {
    const content = <Plain text={piece.text} people={people} />;
    if (piece.type === "bold") return <strong key={index}>{content}</strong>;
    if (piece.type === "italic") return <em key={index}>{content}</em>;
    if (piece.type === "underline") return <u key={index}>{content}</u>;
    if (piece.type === "strike") return <s key={index}>{content}</s>;
    if (piece.type === "code") return <code key={index}>{piece.text}</code>;
    if (piece.type === "spoiler") return <Spoiler key={index} text={piece.text}>{content}</Spoiler>;
    return <Fragment key={index}>{content}</Fragment>;
  })}</>;
}

/** Mensagem formatada: parágrafos, citações (>) e blocos de código. */
export function Markdown({ text, people }: { text: string; people: Person[] }) {
  return <>{parseMarkdown(text).map((block, index) => block.type === "codeblock"
    ? <pre key={index}><code>{block.text}</code></pre>
    : block.type === "quote" ? <blockquote key={index}><InlineText pieces={block.inline} people={people} /></blockquote>
    : <p key={index}><InlineText pieces={block.inline} people={people} /></p>)}</>;
}

export function PersonAvatar({ id, name, people, size = 36, status }: { id: number | null; name: string; people: Person[]; size?: number; status?: boolean }) {
  const person = people.find((entry) => entry.id === id);
  if (!id && name === "Portal") return <span className="cv-portal-avatar" style={{ width: size, height: size }}><UsersRound size={size * 0.5} /></span>;
  return <span className="cv-avatar" style={{ width: size, height: size }}>
    <Avatar member={person ?? { id: id ?? 0, name, avatarIcon: "👤", avatarKey: null }} size={size} />
    {status && (person?.status ? <i className={`cv-online status-${person.status.kind}`} title={statusText(person.status)} aria-label={statusText(person.status)} /> : person?.online && <i className="cv-online" aria-label="Online" />)}
  </span>;
}

/** "Almoço · até 14:30", "Férias até 20/11". */
export const statusText = (status: Status) => status.untilLabel ? `${status.label} · até ${status.untilLabel}` : status.label;

/** Minha foto no topo da lista; clicando, escolho o status ("Em reunião", "Almoço"...). */
export function MyStatus({ me, people, onChanged }: { me: Me; people: Person[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [duration, setDuration] = useState<string>("1h");
  const [error, setError] = useState("");
  const name = people.find((person) => person.id === me.id)?.name ?? "";
  const status = me.status ?? null;
  async function choose(kind: StatusKind | null) {
    setError("");
    try { await call("/api/chat", { action: "setStatus", kind, duration }); setOpen(false); onChanged(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível mudar o status."); }
  }
  return <span className="cv-status-picker">
    <button className="cv-me" onClick={() => setOpen((value) => !value)} aria-label={status ? `Meu status: ${statusText(status)}` : "Escolher meu status"} title={status ? statusText(status) : "Escolher meu status"} aria-expanded={open}>
      <PersonAvatar id={me.id} name={name} people={people} size={30} status />
    </button>
    {open && <div className="cv-popover cv-status-menu" role="dialog" aria-label="Meu status">
      <header><strong>Meu status</strong><button onClick={() => setOpen(false)} aria-label="Fechar"><X size={15} /></button></header>
      {status?.kind === "absence" ? <p className="cv-status-note">{status.label}. Esse status vem das ausências cadastradas e sai sozinho.</p> : <>
        <div className="cv-status-options">
          {STATUS_KINDS.map((kind) => <button key={kind} className={status?.kind === kind ? "active" : ""} onClick={() => void choose(kind)}><i className={`cv-dot status-${kind}`} />{STATUS_LABELS[kind]}{status?.kind === kind && status.untilLabel && <small>até {status.untilLabel}</small>}</button>)}
        </div>
        <label className="cv-status-duration"><span>Vale por</span><select value={duration} onChange={(event) => setDuration(event.target.value)}>{STATUS_DURATIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
        {status && <button className="cv-status-clear" onClick={() => void choose(null)}>Tirar status</button>}
      </>}
      {error && <p className="cv-error">{error}</p>}
    </div>}
  </span>;
}

/** "Me lembre": atalhos ou um dia e hora. */
function ReminderMenu({ presets, has, onPick, onCancel, onClose }: { presets: { label: string; at: string }[]; has: boolean; onPick: (at: string) => void; onCancel: () => void; onClose: () => void }) {
  const [custom, setCustom] = useState("");
  const at = localInputToIso(custom);
  return <div className="cv-popover cv-remind align-right" role="dialog" aria-label="Me lembrar desta mensagem">
    <header><strong>Me lembrar</strong><button onClick={onClose} aria-label="Fechar"><X size={15} /></button></header>
    <div className="cv-remind-options">{presets.map((preset) => <button key={preset.label} onClick={() => onPick(preset.at)}>{preset.label}</button>)}</div>
    <form className="cv-remind-custom" onSubmit={(event) => { event.preventDefault(); if (at) onPick(at); }}>
      <input type="datetime-local" value={custom} onChange={(event) => setCustom(event.target.value)} aria-label="Dia e hora do lembrete" />
      <button disabled={!at}>Marcar</button>
    </form>
    {has && <button className="cv-status-clear" onClick={onCancel}>Cancelar lembrete</button>}
  </div>;
}

/** Transforma a mensagem numa demanda (com o texto e de onde veio) e liga as duas. */
function TaskFromMessage({ message, where, people, me, onClose, onDone }: { message: Message; where: string; people: Person[]; me: Me; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ title: taskTitleFromMessage(message.body) || `Pedido de ${message.authorName} no chat`, owner: String(me.id), dueDate: "", priority: "0" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      const sent = new Date(message.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
      const description = `${message.body || "(imagem)"}\n\nMensagem de ${message.authorName} em ${where}, ${sent}.`;
      const created = await call("/api/tasks", { action: "createTask", title: form.title.trim(), description, owners: form.owner ? [Number(form.owner)] : [], dueDate: form.dueDate || null, priority: Number(form.priority), origin: `Chat ${where}` });
      const taskId = Number((created.task as { id?: number } | undefined)?.id);
      if (taskId) await call("/api/chat", { action: "linkTask", messageId: message.id, taskId });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar a demanda.");
      setSaving(false);
    }
  }
  return <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><form className="modal" onSubmit={(event) => void save(event)}>
    <div className="modal-head"><div><h2>Virar demanda</h2><p>A mensagem vai na descrição, e a conversa mostra o link para a demanda.</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
    <blockquote className="cv-task-source"><b>{message.authorName}</b> {message.body ? message.body.replace(/[*_~`|]/g, "").slice(0, 220) : "Imagem"}{message.body.length > 220 ? "…" : ""}</blockquote>
    <div className="form-grid">
      <label className="full"><span>Título</span><input autoFocus required maxLength={160} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
      <label><span>Responsável</span><select value={form.owner} onChange={(event) => setForm({ ...form, owner: event.target.value })}><option value="">Ninguém ainda</option>{[...people].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map((person) => <option key={person.id} value={person.id}>{person.id === me.id ? `${person.name} (eu)` : person.name}</option>)}</select></label>
      <label><span>Prazo <em>opcional</em></span><input type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} /></label>
      <label><span>Prioridade</span><select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}>{taskPriorities.map((priority) => <option key={priority} value={priority}>{taskPriorityLabels[priority]}</option>)}</select></label>
    </div>
    {error && <p className="modal-error">{error}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={saving || !form.title.trim()}>{saving ? "Criando..." : "Criar demanda"}</button></div>
  </form></div>;
}

/** Fotos de quem participou, sobrepostas. */
export function AvatarStack({ ids, people, size = 22 }: { ids: number[]; people: Person[]; size?: number }) {
  return <span className="cv-stack-faces">{ids.slice(0, 4).map((id) => <PersonAvatar key={id} id={id} name={people.find((person) => person.id === id)?.name ?? ""} people={people} size={size} />)}</span>;
}

export function EmojiPicker({ onPick, onClose, className = "" }: { onPick: (emoji: string) => void; onClose: () => void; className?: string }) {
  const [group, setGroup] = useState(0);
  return <div className={`cv-popover cv-emoji ${className}`} role="dialog" aria-label="Emojis">
    <header><nav>{EMOJI_GROUPS.map((entry, index) => <button key={entry.label} className={group === index ? "active" : ""} onClick={() => setGroup(index)}>{entry.label}</button>)}</nav><button onClick={onClose} aria-label="Fechar"><X size={15} /></button></header>
    <div className="cv-emoji-grid">{EMOJI_GROUPS[group].emojis.map((emoji) => <button key={emoji} onClick={() => onPick(emoji)} title={emoji}>{emoji}</button>)}</div>
  </div>;
}

export function Reactions({ reactions, onToggle }: { reactions: Reaction[]; onToggle: (emoji: string) => void }) {
  if (!reactions.length) return null;
  return <div className="cv-reactions">
    {reactions.map((reaction) => <button key={reaction.emoji} className={reaction.mine ? "mine" : ""} title={reaction.names.join(", ")} onClick={() => onToggle(reaction.emoji)}>{reaction.emoji}<b>{reaction.count}</b></button>)}
  </div>;
}

/** Imagem ou GIF da mensagem no tamanho natural (até 360 × 280). */
function AttachmentImage({ file, onOpen }: { file: Attachment; onOpen: () => void }) {
  return <button type="button" className="cv-attachment-open" onClick={onOpen} aria-label="Ver imagem em tamanho maior">
    {/* eslint-disable-next-line @next/next/no-img-element -- imagens do chat vêm da rota de mídia ou do Giphy, sem otimização de servidor */}
    <img src={file.url} alt={file.gif ? "GIF" : "Imagem enviada"} loading="lazy" width={file.width || undefined} height={file.height || undefined} />
  </button>;
}

/** Imagens da mensagem: clicar abre por cima do chat (sem sair da conversa). */
function AttachmentGallery({ files }: { files: Attachment[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return <div className="cv-attachments">
    {files.map((file, index) => <AttachmentImage key={file.url} file={file} onOpen={() => setOpen(index)} />)}
    {open !== null && files[open] && <ImageViewer files={files} index={open} onChange={setOpen} onClose={() => setOpen(null)} />}
  </div>;
}

/** Visualizador de imagem por cima da tela: Esc ou clique fora fecha; setas passam entre as imagens da mensagem. */
function ImageViewer({ files, index, onChange, onClose }: { files: Attachment[]; index: number; onChange: (index: number) => void; onClose: () => void }) {
  const file = files[index];
  const many = files.length > 1;
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
      else if (many && event.key === "ArrowRight") onChange((index + 1) % files.length);
      else if (many && event.key === "ArrowLeft") onChange((index - 1 + files.length) % files.length);
    };
    document.addEventListener("keydown", onKey, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey, true); document.body.style.overflow = overflow; previous?.focus?.(); };
  }, [index, many, files.length, onChange, onClose]);
  return createPortal(<div className="image-viewer" role="dialog" aria-modal="true" aria-label="Imagem" onClick={onClose}>
    <div className="image-viewer-bar" onClick={(event) => event.stopPropagation()}>
      {many && <span>{index + 1} de {files.length}</span>}
      <a href={file.url} target="_blank" rel="noopener noreferrer" title="Abrir em outra aba" aria-label="Abrir em outra aba"><ExternalLink size={18} /></a>
      {!file.gif && <a href={file.url} download title="Baixar" aria-label="Baixar"><Download size={18} /></a>}
      <button ref={closeRef} type="button" onClick={onClose} title="Fechar (Esc)" aria-label="Fechar"><X size={20} /></button>
    </div>
    {many && <button type="button" className="image-viewer-nav prev" aria-label="Imagem anterior" onClick={(event) => { event.stopPropagation(); onChange((index - 1 + files.length) % files.length); }}><ChevronLeft size={26} /></button>}
    {/* eslint-disable-next-line @next/next/no-img-element -- mesma imagem da conversa, em tamanho maior */}
    <img src={file.url} alt={file.gif ? "GIF" : "Imagem enviada"} onClick={(event) => event.stopPropagation()} />
    {many && <button type="button" className="image-viewer-nav next" aria-label="Próxima imagem" onClick={(event) => { event.stopPropagation(); onChange((index + 1) % files.length); }}><ChevronRight size={26} /></button>}
  </div>, document.body);
}

export function GifPicker({ onPick, onClose }: { onPick: (gif: Gif) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<{ configured: boolean; canConfigure?: boolean; results: Gif[]; error?: string } | null>(null);
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const search = useCallback(async (term: string) => {
    try {
      const response = await fetch(`/api/gifs?q=${encodeURIComponent(term)}`, { cache: "no-store" });
      setState(await response.json() as { configured: boolean; results: Gif[]; error?: string });
    } catch {
      setState({ configured: true, results: [], error: "Não foi possível buscar GIFs agora." });
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void search(query.trim()); }, query ? 350 : 0);
    return () => window.clearTimeout(timer);
  }, [query, search]);
  return <div className="cv-popover cv-gif" role="dialog" aria-label="GIFs">
    <header><label className="cv-search"><Search size={15} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar GIFs" aria-label="Buscar GIFs" /></label><button className="cv-icon-button" onClick={onClose} aria-label="Fechar"><X size={16} /></button></header>
    {!state ? <p className="cv-gif-note">Carregando…</p>
      : !state.configured ? <div className="cv-gif-note">
        <p>A busca de GIFs usa o Giphy e precisa de uma chave gratuita.</p>
        {state.canConfigure ? <form onSubmit={async (event) => { event.preventDefault(); setSaving(true); try { await call("/api/gifs", { action: "saveKey", key }); setKey(""); await search(""); } catch (err) { setState({ configured: false, canConfigure: true, results: [], error: err instanceof Error ? err.message : "Não foi possível salvar." }); } finally { setSaving(false); } }}>
          <small>Crie em developers.giphy.com (botão Create an API Key, tipo API) e cole aqui:</small>
          <span><input value={key} onChange={(event) => setKey(event.target.value)} placeholder="Chave do Giphy" aria-label="Chave do Giphy" autoComplete="off" /><button className="primary-button" disabled={saving || !key.trim()}>Salvar</button></span>
          {state.error && <small className="cv-error">{state.error}</small>}
        </form> : <small>Peça a um administrador para configurar. Enquanto isso, anexe GIFs do computador pelo clipe.</small>}
      </div>
      : state.error ? <p className="cv-gif-note cv-error">{state.error}</p>
      : state.results.length ? <div className="cv-gif-grid">{state.results.map((gif) => <button key={gif.id} onClick={() => onPick(gif)} title={gif.title}><i style={{ backgroundImage: `url("${gif.preview}")` }} /></button>)}</div>
      : <p className="cv-gif-note">Nenhum GIF encontrado.</p>}
    {state?.configured && <footer>Busca pelo Giphy</footer>}
  </div>;
}

/** Campo de mensagem: texto com @menção, anexos (clipe, colar, arrastar), emoji, GIF e enviar. */
export function Composer({ people, placeholder, onSend, onTyping, pending, setPending, compact, inputRef, onArrowUp, extra, submitLabel = "Enviar", onPoll, onSchedule }: {
  people: Person[]; placeholder: string; onSend: (body: string, files: Pending[], gif: Gif | null) => Promise<void>; onTyping?: () => void;
  pending: Pending[]; setPending: (update: (current: Pending[]) => Pending[]) => void; compact?: boolean; inputRef?: React.RefObject<HTMLTextAreaElement | null>; onArrowUp?: () => boolean; extra?: React.ReactNode; submitLabel?: string;
  onPoll?: () => void; onSchedule?: (body: string, at: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [popover, setPopover] = useState<"emoji" | "gif" | "schedule" | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? ownRef;
  const fileRef = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);
  const sending = useRef(false);

  async function addFiles(files: File[]) {
    const images = files.filter((file) => file.type.startsWith("image/")).slice(0, MAX_ATTACHMENTS - pending.length);
    if (!images.length) return;
    setUploading(true);
    setError("");
    try {
      for (const file of images) { const uploaded = await uploadImage(file, "chat"); setPending((current) => [...current, uploaded].slice(0, MAX_ATTACHMENTS)); }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível enviar a imagem.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  async function submit(gif: Gif | null = null) {
    const body = text.trim();
    if (!gif && ((!body && !pending.length) || uploading)) return;
    // Um envio por vez: com a internet lenta, Enter de novo ou clique em "Enviar" não duplica a mensagem.
    if (sending.current) return;
    sending.current = true;
    setError("");
    // O campo esvazia na hora; se o envio falhar, o texto volta.
    const files = pending;
    if (!gif) { setText(""); setPending(() => []); }
    setPopover(null);
    try {
      await onSend(gif ? "" : body, gif ? [] : files, gif);
    } catch (err) {
      if (!gif) { setText((current) => current || body); setPending((current) => (current.length ? current : files)); }
      setError(err instanceof Error ? err.message : "Não foi possível enviar.");
    } finally {
      sending.current = false;
    }
  }
  async function schedule(at: string) {
    const body = text.trim();
    if (!body || !onSchedule) return;
    setError("");
    try { await onSchedule(body, at); setText(""); setPopover(null); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível agendar."); }
  }
  function insertEmoji(emoji: string) {
    const input = ref.current;
    const start = input?.selectionStart ?? text.length;
    const end = input?.selectionEnd ?? text.length;
    setText(text.slice(0, start) + emoji + text.slice(end));
    window.requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(start + emoji.length, start + emoji.length); });
  }

  return <div className={`cv-compose ${compact ? "compact" : ""}`}
    onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
    onDrop={(event) => { if (event.dataTransfer.files.length) { event.preventDefault(); void addFiles([...event.dataTransfer.files]); } }}>
    {extra}
    {(pending.length > 0 || uploading) && <div className="cv-pending">{pending.map((file) => <span key={file.key}><i style={{ backgroundImage: `url("${file.url}")` }} /><button onClick={() => setPending((current) => current.filter((entry) => entry.key !== file.key))} aria-label="Tirar imagem"><X size={13} /></button></span>)}{uploading && <span className="loading">Enviando…</span>}</div>}
    <MentionTextarea value={text} onChange={(value) => { setText(value); if (onTyping && value.trim() && Date.now() - lastTyping.current > 3000) { lastTyping.current = Date.now(); onTyping(); } }} members={people} rows={compact ? 1 : 2} enterSends maxLength={MAX_MESSAGE} inputRef={ref} placeholder={placeholder}
      onSubmit={() => void submit()}
      onPaste={(event) => { const files = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/")); if (files.length) { event.preventDefault(); void addFiles(files); } }}
      onKey={(event) => {
        if (event.key === "Escape" && popover) { event.preventDefault(); setPopover(null); return true; }
        if (event.key === "ArrowUp" && !text && onArrowUp) { if (onArrowUp()) { event.preventDefault(); return true; } }
        return false;
      }} />
    <div className="cv-compose-bar">
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={(event) => void addFiles([...(event.target.files ?? [])])} />
      <button className="cv-icon-button" onClick={() => fileRef.current?.click()} disabled={pending.length >= MAX_ATTACHMENTS} aria-label="Anexar imagem ou GIF" title="Anexar imagem ou GIF (também dá para colar ou arrastar)"><Paperclip size={17} /></button>
      <button className={`cv-icon-button ${popover === "emoji" ? "active" : ""}`} onClick={() => setPopover(popover === "emoji" ? null : "emoji")} aria-label="Emojis" title="Emojis"><Smile size={17} /></button>
      <button className={`cv-icon-button ${popover === "gif" ? "active" : ""}`} onClick={() => setPopover(popover === "gif" ? null : "gif")} aria-label="GIFs" title="GIFs"><b className="gif-badge">GIF</b></button>
      {onPoll && <button className="cv-icon-button" onClick={onPoll} aria-label="Criar enquete" title="Criar enquete"><Vote size={17} /></button>}
      {!compact && <span className="cv-compose-hint">Enter envia · Shift + Enter quebra a linha</span>}
      {onSchedule && <button className={`cv-icon-button ${popover === "schedule" ? "active" : ""}`} onClick={() => setPopover(popover === "schedule" ? null : "schedule")} disabled={!text.trim() || pending.length > 0} aria-label="Agendar envio" title={pending.length ? "Mensagens com imagem não podem ser agendadas" : "Agendar envio (escreva a mensagem primeiro)"}><CalendarClock size={17} /></button>}
      <button className="cv-send" onClick={() => void submit()} disabled={(!text.trim() && !pending.length) || uploading}><SendHorizontal size={16} /> {submitLabel}</button>
      {popover === "schedule" && <ScheduleMenu onClose={() => setPopover(null)} onPick={(at) => void schedule(at)} />}
      {popover === "emoji" && <EmojiPicker className="composer" onClose={() => setPopover(null)} onPick={insertEmoji} />}
      {popover === "gif" && <GifPicker onClose={() => setPopover(null)} onPick={(gif) => void submit(gif)} />}
    </div>
    {error && <p className="cv-error">{error}</p>}
  </div>;
}

/** Uma conversa (canal ou pessoa): cabeçalho, mensagens e o campo para escrever. */
type PinnedMessage = { id: number; authorName: string; text: string; pinnedAt: string; pinnedByName: string | null };

export function Thread({ topicId, people, me, compact, onChanged, onBack, onOpenFull, actions, focus }: { topicId: number; people: Person[]; me: Me; compact?: boolean; onChanged?: () => void; onBack?: () => void; onOpenFull?: () => void; actions?: (channel: ChannelInfo) => React.ReactNode; focus?: { id: number; key: number } | null }) {
  const [pinned, setPinned] = useState<PinnedMessage[]>([]);
  const [showPins, setShowPins] = useState(false);
  const [flash, setFlash] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [channel, setChannel] = useState<ChannelInfo | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [newSince, setNewSince] = useState<number | null>(null);
  const [typing, setTyping] = useState<string[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const [reactingTo, setReactingTo] = useState<number | null>(null);
  const [reminding, setReminding] = useState<{ id: number; presets: { label: string; at: string }[] } | null>(null);
  const [makingTask, setMakingTask] = useState<Message | null>(null);
  const [scheduled, setScheduled] = useState<Scheduled[]>([]);
  const [showScheduled, setShowScheduled] = useState(false);
  const [pollModal, setPollModal] = useState(false);
  const [error, setError] = useState("");
  // Mensagens que acabaram de sair do campo e ainda estão a caminho do servidor (aparecem na hora, "enviando").
  const [outbox, setOutbox] = useState<{ key: number; body: string; images: number }[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const keepOffset = useRef<number | null>(null);
  const lastSeen = useRef(0);
  const myName = people.find((person) => person.id === me.id)?.name ?? "";

  const merge = useCallback((incoming: Message[]) => {
    setMessages((current) => {
      const map = new Map(current.map((message) => [message.id, message]));
      for (const message of incoming) map.set(message.id, message);
      return [...map.values()].sort((a, b) => a.id - b.id);
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/chat?topic=${topicId}`, { cache: "no-store" });
      const json = await response.json() as { messages: Message[]; hasMore: boolean; lastReadId: number; typing: string[]; channel: ChannelInfo; pinned?: PinnedMessage[]; scheduled?: Scheduled[]; error?: string };
      if (!response.ok) throw new Error(json.error || "Não foi possível carregar as mensagens.");
      const box = listRef.current;
      stickToBottom.current = !box || box.scrollHeight - box.scrollTop - box.clientHeight < 160;
      merge(json.messages);
      setChannel(json.channel);
      setTyping(json.typing ?? []);
      setPinned(json.pinned ?? []);
      setScheduled(json.scheduled ?? []);
      if (!loaded) { setHasMore(json.hasMore); setNewSince(json.lastReadId || null); setLoaded(true); }
      const newest = json.messages[json.messages.length - 1]?.id ?? 0;
      if (newest > lastSeen.current) { lastSeen.current = newest; window.dispatchEvent(new Event(CHAT_CHANGED)); onChanged?.(); }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar as mensagens.");
    }
  }, [topicId, merge, loaded, onChanged]);

  useEffect(() => {
    const first = window.setTimeout(() => { void load(); }, 0);
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 3000);
    return () => { window.clearTimeout(first); window.clearInterval(interval); };
  }, [load]);

  useLayoutEffect(() => {
    const box = listRef.current;
    if (!box) return;
    if (keepOffset.current !== null) { box.scrollTop = box.scrollHeight - keepOffset.current; keepOffset.current = null; return; }
    if (stickToBottom.current) box.scrollTop = box.scrollHeight;
  }, [messages, typing.length, outbox.length]);

  // Abrir a conversa já na última mensagem: imagens que terminam de carregar depois aumentam a altura,
  // então a lista continua colada no fim enquanto a pessoa não rolar para cima.
  useEffect(() => {
    const box = listRef.current;
    if (!box) return;
    const onScroll = () => { stickToBottom.current = box.scrollHeight - box.scrollTop - box.clientHeight < 160; };
    const onLoad = () => { if (stickToBottom.current) box.scrollTop = box.scrollHeight; };
    box.addEventListener("scroll", onScroll, { passive: true });
    box.addEventListener("load", onLoad, true);
    return () => { box.removeEventListener("scroll", onScroll); box.removeEventListener("load", onLoad, true); };
  }, []);

  // Ao abrir a conversa, o cursor já fica no campo de escrever (no computador; no celular não abre o teclado sozinho).
  useEffect(() => {
    if (!loaded || channel?.archived) return;
    stickToBottom.current = true;
    const box = listRef.current;
    if (box) box.scrollTop = box.scrollHeight;
    if (window.matchMedia("(pointer: fine)").matches) inputRef.current?.focus({ preventScroll: true });
  }, [loaded, topicId, channel?.archived]);

  async function loadOlder() {
    const first = messages[0]?.id;
    if (!first) return;
    const response = await fetch(`/api/chat?topic=${topicId}&before=${first}`, { cache: "no-store" });
    const json = await response.json() as { messages: Message[]; hasMore: boolean };
    if (!response.ok) return;
    const box = listRef.current;
    keepOffset.current = box ? box.scrollHeight - box.scrollTop : null;
    merge(json.messages);
    setHasMore(json.hasMore);
  }

  // Ir até uma mensagem (da busca ou das fixadas): carrega as anteriores até achar, rola e destaca.
  const jumping = useRef(false);
  const jumpTo = useCallback(async (id: number) => {
    if (jumping.current) return;
    jumping.current = true;
    setShowPins(false);
    try {
      let oldest = messagesRef.current[0]?.id ?? 0;
      for (let page = 0; page < 30 && !messagesRef.current.some((message) => message.id === id) && oldest && oldest > id; page++) {
        const response = await fetch(`/api/chat?topic=${topicId}&before=${oldest}`, { cache: "no-store" });
        const json = await response.json() as { messages: Message[]; hasMore: boolean };
        if (!response.ok || !json.messages.length) break;
        merge(json.messages);
        setHasMore(json.hasMore);
        oldest = json.messages[0].id;
        messagesRef.current = [...json.messages, ...messagesRef.current];
      }
      stickToBottom.current = false;
      window.setTimeout(() => {
        const node = listRef.current?.querySelector(`[data-message="${id}"]`);
        if (node) { node.scrollIntoView({ block: "center", behavior: "smooth" }); setFlash(id); window.setTimeout(() => setFlash(null), 2200); }
      }, 60);
    } finally { jumping.current = false; }
  }, [topicId, merge]);
  const messagesRef = useRef<Message[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => {
    if (!focus || !loaded) return;
    const timer = window.setTimeout(() => { void jumpTo(focus.id); }, 0);
    return () => window.clearTimeout(timer);
  }, [focus, loaded, jumpTo]);

  async function act(payload: Record<string, unknown>) {
    setError("");
    try { await call("/api/chat", payload); stickToBottom.current = payload.action === "send"; await load(); onChanged?.(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível concluir."); }
  }

  const groups = groupMessages(messages);
  const mentionsMe = (message: Message) => Boolean(myName) && message.memberId !== me.id && (fold(message.body).includes(`@${fold(myName)}`) || message.reply?.authorName === myName);
  const firstNew = newSince ? messages.find((message) => message.id > newSince && message.memberId !== me.id)?.id ?? null : null;
  const isDm = channel?.kind === "dm";
  const where = channel ? (isDm ? channel.name : `#${channel.name}`) : "";
  const peer = isDm ? people.find((person) => person.id === channel?.peerId) : null;

  return <div className={`cv-thread ${compact ? "compact" : ""}`}>
    <header className="cv-thread-head">
      {onBack && <button className="cv-icon-button cv-back" onClick={onBack} aria-label="Voltar"><ArrowLeft size={18} /></button>}
      {channel && (isDm ? <PersonAvatar id={channel.peerId} name={channel.name} people={people} size={34} status /> : <span className="cv-head-icon"><Hash size={17} /></span>)}
      <div className="cv-thread-title">
        <h3>{where || "…"}</h3>
        {channel && <small>{isDm ? (peer?.status ? statusText(peer.status) : peer?.online ? "Online agora" : peer?.jobTitle || "Conversa particular") : channel.description || "Canal aberto a toda a equipe"}</small>}
      </div>
      {channel && actions?.(channel)}
      {onOpenFull && <button className="cv-icon-button" onClick={onOpenFull} aria-label="Abrir em tela cheia" title="Abrir em tela cheia"><Maximize2 size={16} /></button>}
    </header>
    {pinned.length > 0 && <div className="cv-pinbar">
      <button className="cv-pinbar-main" onClick={() => void jumpTo(pinned[0].id)} title="Ir até a mensagem fixada"><Pin size={14} /><span><b>{pinned[0].authorName.split(/\s+/)[0]}:</b> {pinned[0].text || "Imagem"}</span></button>
      {pinned.length > 1 && <button className="cv-pinbar-more" onClick={() => setShowPins((value) => !value)} aria-expanded={showPins}>{pinned.length} fixadas</button>}
      {showPins && <div className="cv-popover cv-pins" role="dialog" aria-label="Mensagens fixadas">
        <header><strong>Mensagens fixadas</strong><button onClick={() => setShowPins(false)} aria-label="Fechar"><X size={15} /></button></header>
        <ul>{pinned.map((entry) => <li key={entry.id}><button onClick={() => void jumpTo(entry.id)}><b>{entry.authorName}</b><span>{entry.text || "Imagem"}</span>{entry.pinnedByName && <small>fixada por {entry.pinnedByName.split(/\s+/)[0]}</small>}</button></li>)}</ul>
      </div>}
    </div>}

    <div className="cv-posts" ref={listRef}>
      {hasMore && <button className="cv-older" onClick={() => void loadOlder()}>Carregar mensagens anteriores</button>}
      {loaded && !messages.length && <div className="cv-start">
        {isDm ? <PersonAvatar id={channel?.peerId ?? null} name={channel?.name ?? ""} people={people} size={56} /> : <span className="cv-head-icon big"><Hash size={26} /></span>}
        <strong>{isDm ? `Converse com ${channel?.name}` : `Bem-vindo ao ${where}`}</strong>
        <p>{isDm ? "Só vocês dois leem estas mensagens." : "Ainda não tem mensagens aqui. Mande a primeira."}</p>
      </div>}
      {groups.map((group, index) => {
        const day = isoToLocal(group.startedAt).day;
        const showDay = index === 0 || isoToLocal(groups[index - 1].startedAt).day !== day;
        const first = group.items[0];
        const author = people.find((person) => person.id === group.memberId);
        const mine = group.memberId === me.id;
        return <Fragment key={first.id}>
          {showDay && <div className="cv-day"><span>{dayLabel(day)}</span></div>}
          <div className={`cv-post-group ${mine ? "mine" : ""}`}>
            {!mine && <PersonAvatar id={group.memberId} name={first.authorName} people={people} size={compact ? 30 : 34} />}
            <div className="cv-post-stack">
              {!mine && <p className="cv-who"><strong className={roleColor(author?.teamColor)}>{first.authorName}</strong></p>}
              {group.items.map((message, position) => <Fragment key={message.id}>
                {firstNew === message.id && <div className="cv-new"><span>Novas mensagens</span></div>}
                <div data-message={message.id} className={`cv-post-line ${position === 0 ? "first" : ""} ${mentionsMe(message) ? "mention-me" : ""} ${message.deleted ? "deleted" : ""} ${flash === message.id ? "flash" : ""}`}>
                  {message.reply && <p className="cv-quote"><Reply size={12} /><b>{message.reply.authorName.split(/\s+/)[0]}</b><span>{message.reply.body || "Imagem"}</span></p>}
                  {editing?.id === message.id ? <div className="cv-edit">
                    <MentionTextarea value={editing.text} onChange={(value) => setEditing({ id: message.id, text: value })} members={people} rows={1} enterSends maxLength={MAX_MESSAGE} autoFocus
                      onKey={(event) => { if (event.key === "Escape") { event.preventDefault(); setEditing(null); return true; } return false; }}
                      onSubmit={() => void act({ action: "edit", messageId: message.id, body: editing.text.trim() }).then(() => setEditing(null))} />
                    <small>Enter salva · Esc cancela</small>
                  </div> : message.deleted ? <p className="cv-text"><em>Mensagem apagada</em></p> : message.body && <div className="cv-text"><Markdown text={message.body} people={people} /></div>}
                  {message.poll && <PollCard poll={message.poll} compact onChanged={load} />}
                  {message.attachments.length > 0 && <AttachmentGallery files={message.attachments} />}
                  {editing?.id !== message.id && <time className="cv-meta" title={new Date(message.createdAt).toLocaleString("pt-BR")}>{message.pinned && <Pin size={10} aria-label="Fixada" />}{message.editedAt && !message.deleted ? "editada · " : ""}{isoToLocal(message.createdAt).time}</time>}
                  {!message.deleted && <Reactions reactions={message.reactions} onToggle={(emoji) => void act({ action: "react", messageId: message.id, emoji })} />}
                  {!message.deleted && (message.task || message.reminderAt) && <div className="cv-chips">
                    {message.task && <button className={`cv-chip ${message.task.done ? "done" : ""}`} onClick={() => window.dispatchEvent(new CustomEvent(OPEN_TASK_EVENT, { detail: message.task!.id }))} title="Abrir a demanda"><ListTodo size={13} /><b>{message.task.code}</b><span>{message.task.title}</span></button>}
                    {message.reminderAt && <span className="cv-chip reminder"><AlarmClock size={13} /><span>Lembrete {message.reminderLabel}</span><button onClick={() => void act({ action: "cancelReminder", messageId: message.id })} aria-label="Cancelar lembrete" title="Cancelar lembrete"><X size={12} /></button></span>}
                  </div>}
                  {!message.deleted && !channel?.archived && editing?.id !== message.id && <span className={`cv-actions ${reactingTo === message.id || reminding?.id === message.id ? "open" : ""}`}>
                    {REACTIONS.slice(0, 3).map((emoji) => <button key={emoji} onClick={() => void act({ action: "react", messageId: message.id, emoji })} title={`Reagir com ${emoji}`}>{emoji}</button>)}
                    <span className="cv-actions-picker">
                      <button onClick={() => setReactingTo(reactingTo === message.id ? null : message.id)} aria-label="Mais reações" title="Mais reações"><SmilePlus size={15} /></button>
                      {reactingTo === message.id && <EmojiPicker className="align-right" onClose={() => setReactingTo(null)} onPick={(emoji) => { setReactingTo(null); void act({ action: "react", messageId: message.id, emoji }); }} />}
                    </span>
                    <button onClick={() => { setReplyTo(message); inputRef.current?.focus(); }} aria-label="Responder" title="Responder"><Reply size={15} /></button>
                    <span className="cv-actions-picker">
                      <button onClick={() => setReminding(reminding?.id === message.id ? null : { id: message.id, presets: reminderPresets(new Date()) })} aria-label="Me lembrar desta mensagem" title="Me lembrar desta mensagem"><AlarmClock size={15} /></button>
                      {reminding?.id === message.id && <ReminderMenu presets={reminding.presets} has={Boolean(message.reminderAt)} onClose={() => setReminding(null)}
                        onPick={(at) => { setReminding(null); void act({ action: "remind", messageId: message.id, at }); }}
                        onCancel={() => { setReminding(null); void act({ action: "cancelReminder", messageId: message.id }); }} />}
                    </span>
                    {me.canCreateTasks && !message.task && <button onClick={() => setMakingTask(message)} aria-label="Virar demanda" title="Virar demanda"><ListPlus size={15} /></button>}
                    <button onClick={() => void act({ action: "pin", messageId: message.id, pinned: !message.pinned })} aria-label={message.pinned ? "Desafixar" : "Fixar no topo"} title={message.pinned ? "Desafixar" : "Fixar no topo da conversa"}>{message.pinned ? <PinOff size={14} /> : <Pin size={14} />}</button>
                    {message.memberId === me.id && message.body && <button onClick={() => setEditing({ id: message.id, text: message.body })} aria-label="Editar" title="Editar"><Pencil size={14} /></button>}
                    {(message.memberId === me.id || (me.isAdmin && !isDm)) && <button className="danger" onClick={() => { if (window.confirm("Apagar esta mensagem?")) void act({ action: "delete", messageId: message.id }); }} aria-label="Apagar" title="Apagar"><Trash2 size={14} /></button>}
                  </span>}
                </div>
              </Fragment>)}
            </div>
          </div>
        </Fragment>;
      })}
      {outbox.length > 0 && <div className="cv-post-group mine cv-outbox">
        <div className="cv-post-stack">
          {outbox.map((item) => <div key={item.key} className="cv-post-line sending">
            {item.body ? <div className="cv-text"><Markdown text={item.body} people={people} /></div> : <p className="cv-text"><em>{item.images > 1 ? `${item.images} imagens` : "Imagem"}</em></p>}
            <time className="cv-meta">Enviando…</time>
          </div>)}
        </div>
      </div>}
      {typing.length > 0 && <p className="cv-typing"><span className="dots"><i /><i /><i /></span> {typingText(typing)}</p>}
    </div>

    {error && <p className="cv-error">{error}</p>}
    {channel?.archived ? <p className="cv-archived">Este canal foi arquivado: dá para ler o histórico, mas não escrever.</p> : channel && <div className="cv-thread-compose">
      <Composer people={people} compact={compact} inputRef={inputRef} pending={pending} setPending={setPending}
        placeholder={`Mensagem para ${where}`}
        onPoll={me.canCreateTasks === false ? undefined : () => setPollModal(true)}
        onSchedule={async (body, at) => { await call("/api/chat", { action: "schedule", topicId, body, at }); setShowScheduled(true); await load(); }}
        extra={<>{scheduled.length > 0 && <div className="cv-scheduled">
          <button type="button" className="cv-scheduled-toggle" onClick={() => setShowScheduled(!showScheduled)}><CalendarClock size={13} /> {scheduled.length} {scheduled.length === 1 ? "mensagem agendada" : "mensagens agendadas"} {showScheduled ? "▴" : "▾"}</button>
          {showScheduled && <ul>{scheduled.map((item) => <li key={item.id}><span><b>{new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(item.sendAt))}</b> {item.body.slice(0, 90)}</span><button type="button" onClick={() => { if (window.confirm("Cancelar o envio desta mensagem?")) void act({ action: "cancelScheduled", scheduledId: item.id }); }} aria-label="Cancelar envio" title="Cancelar envio"><X size={13} /></button></li>)}</ul>}
        </div>}{replyTo && <p className="cv-replying"><Reply size={14} /><span>Respondendo a <b>{replyTo.authorName}</b>: {replyTo.body ? replyTo.body.slice(0, 80) : "Imagem"}</span><button onClick={() => setReplyTo(null)} aria-label="Cancelar resposta"><X size={14} /></button></p>}</>}
        onTyping={() => void call("/api/chat", { action: "typing", topicId }).catch(() => undefined)}
        onArrowUp={() => { const mine = [...messages].reverse().find((message) => message.memberId === me.id && !message.deleted && message.body); if (mine) { setEditing({ id: mine.id, text: mine.body }); return true; } return false; }}
        onSend={async (body, files, gif) => {
          const reply = replyTo;
          setReplyTo(null); setNewSince(null);
          // Aparece na hora como "Enviando…"; some quando a mensagem de verdade chega do servidor.
          const key = Date.now() + Math.random();
          const drop = () => setOutbox((current) => current.filter((item) => item.key !== key));
          stickToBottom.current = true;
          setOutbox((current) => [...current, { key, body, images: gif ? 1 : files.length }]);
          try {
            // A falha volta para o campo de mensagem (o texto não se perde).
            await call("/api/chat", { action: "send", topicId, body, replyToId: reply?.id ?? null, attachments: gif ? [{ kind: "gif", url: gif.url, width: gif.width, height: gif.height }] : files.map((file) => ({ kind: "upload", key: file.key })) });
          } catch (err) {
            drop();
            setReplyTo(reply);
            throw err;
          }
          // O campo já está livre para a próxima mensagem; a lista atualiza em seguida.
          void load().finally(drop);
          onChanged?.();
        }} />
    </div>}
    <DropHint />
    {pollModal && <PollModal where="nesta conversa" onClose={() => setPollModal(false)} onSave={async (payload) => { await call("/api/chat", { action: "createPoll", topicId, ...payload }); setPollModal(false); await load(); }} />}
    {makingTask && <TaskFromMessage message={makingTask} where={where} people={people} me={me} onClose={() => setMakingTask(null)} onDone={() => { setMakingTask(null); void load(); }} />}
  </div>;
}

/** Aviso grande enquanto a pessoa arrasta uma imagem por cima da conversa. */
function DropHint() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let timer = 0;
    const over = (event: DragEvent) => { if (event.dataTransfer?.types.includes("Files")) { setShow(true); window.clearTimeout(timer); timer = window.setTimeout(() => setShow(false), 400); } };
    window.addEventListener("dragover", over);
    return () => { window.removeEventListener("dragover", over); window.clearTimeout(timer); };
  }, []);
  if (!show) return null;
  return <div className="cv-drop"><div><ImagePlus size={32} /><strong>Solte no campo de mensagem</strong><span>Imagens e GIFs, até 4 de uma vez</span></div></div>;
}
