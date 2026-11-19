"use client";

import { useCallback, useEffect, useState } from "react";
import { useLiveRefresh } from "./live";
import Archive from "lucide-react/icons/archive";
import ArchiveRestore from "lucide-react/icons/archive-restore";
import Hash from "lucide-react/icons/hash";
import MessagesSquare from "lucide-react/icons/messages-square";
import Pencil from "lucide-react/icons/pencil";
import Plus from "lucide-react/icons/plus";
import Search from "lucide-react/icons/search";
import X from "lucide-react/icons/x";
import { call, fold, MyStatus, PersonAvatar, shortWhen, statusText, Thread, type ChannelInfo, type Me, type Person } from "./chat-thread";
import { Avatar } from "./task-shared";

export type Conversation = { id: number; kind: "channel" | "dm"; name: string; topic: string; teamId: number | null; peerId: number | null; archived: boolean; lastMessageAt: string | null; createdByName: string; canManage: boolean; unread: number; topicId: number | null; preview: { authorName: string; text: string; at: string } | null };
export type ChatList = { channels: Conversation[]; people: Person[]; me: Me };

/** Carrega a lista de conversas (e atualiza a cada 10 segundos). */
export function useConversations() {
  const [list, setList] = useState<ChatList | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/chat", { cache: "no-store" });
      const json = await response.json() as ChatList & { error?: string };
      if (!response.ok) throw new Error(json.error || "Não foi possível carregar as conversas.");
      setList(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar as conversas.");
    }
  }, []);
  useLiveRefresh(load);
  useEffect(() => {
    const first = window.setTimeout(() => { void load(); }, 0);
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 10000);
    return () => { window.clearTimeout(first); window.clearInterval(interval); };
  }, [load]);
  return { list, error, setError, load };
}

export type MessageHit = { id: number; topicId: number; channelId: number; kind: "channel" | "dm"; where: string; memberId: number | null; authorName: string; text: string; createdAt: string };

/** Busca nas mensagens (a partir de 3 letras, esperando a pessoa parar de digitar). */
export function useMessageSearch(query: string) {
  const [hits, setHits] = useState<{ term: string; results: MessageHit[] } | null>(null);
  const term = query.trim();
  useEffect(() => {
    if (term.length < 3) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void fetch(`/api/chat?search=${encodeURIComponent(term)}`, { cache: "no-store" })
        .then(async (response) => response.ok ? ((await response.json()) as { results: MessageHit[] }).results : [])
        .then((results) => { if (!cancelled) setHits({ term, results }); })
        .catch(() => undefined);
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [term]);
  return term.length < 3 ? null : hits?.term === term ? hits.results : undefined;
}

/** Resultado da busca com o trecho encontrado destacado. */
function Highlight({ text, term }: { text: string; term: string }) {
  const index = fold(text).indexOf(fold(term));
  if (index < 0 || !term) return <>{text}</>;
  return <>{text.slice(0, index)}<mark>{text.slice(index, index + term.length)}</mark>{text.slice(index + term.length)}</>;
}

export function MessageResults({ results, term, people, onOpen }: { results: MessageHit[] | null | undefined; term: string; people: Person[]; onOpen: (hit: MessageHit) => void }) {
  if (results === null) return null;
  return <>
    <header className="cv-group-head"><span>Mensagens</span></header>
    {results === undefined ? <p className="cv-note">Buscando…</p> : results.length === 0 ? <p className="cv-note">Nenhuma mensagem com “{term.trim()}”.</p>
      : results.map((hit) => <button key={hit.id} className="cv-row cv-hit" onClick={() => onOpen(hit)}>
        <PersonAvatar id={hit.memberId} name={hit.authorName} people={people} size={30} />
        <span className="cv-row-text">
          <span className="cv-row-top"><strong>{hit.authorName.split(/\s+/)[0]} <small>em {hit.where}</small></strong><time>{shortWhen(hit.createdAt)}</time></span>
          <span className="cv-hit-text"><Highlight text={hit.text} term={term.trim()} /></span>
        </span>
      </button>)}
  </>;
}

/** Descobre onde ficam as mensagens de uma conversa (cria na primeira vez). */
export async function conversationTopic(conversation: Conversation) {
  if (conversation.topicId) return conversation.topicId;
  const response = await fetch(`/api/chat?channel=${conversation.id}`, { cache: "no-store" });
  const json = await response.json() as { topicId?: number; error?: string };
  if (!response.ok || !json.topicId) throw new Error(json.error || "Não foi possível abrir a conversa.");
  return json.topicId;
}

/** Uma linha da lista: ícone ou foto, nome, última mensagem, horário e não lidas. */
export function ConversationRow({ conversation, people, active, onOpen }: { conversation: Conversation; people: Person[]; active: boolean; onOpen: () => void }) {
  const status = conversation.kind === "dm" ? people.find((person) => person.id === conversation.peerId)?.status : null;
  return <button className={`cv-row ${active ? "active" : ""} ${conversation.unread ? "unread" : ""}`} onClick={onOpen}>
    {conversation.kind === "dm" ? <PersonAvatar id={conversation.peerId} name={conversation.name} people={people} size={38} status /> : <span className="cv-head-icon"><Hash size={17} /></span>}
    <span className="cv-row-text">
      <span className="cv-row-top"><strong>{conversation.kind === "dm" ? conversation.name : `#${conversation.name}`}</strong>{status && <span className={`cv-status-tag status-${status.kind}`} title={statusText(status)}>{status.label}</span>}{conversation.preview && <time>{shortWhen(conversation.preview.at)}</time>}</span>
      <span className="cv-row-bottom"><small>{conversation.preview ? <><b>{conversation.preview.authorName}:</b> {conversation.preview.text}</> : conversation.kind === "dm" ? "Diga oi" : conversation.topic || "Sem mensagens ainda"}</small>{conversation.unread > 0 && !active && <em>{conversation.unread > 99 ? "99+" : conversation.unread}</em>}</span>
    </span>
  </button>;
}

/** Chat da equipe: canais abertos e conversas com pessoas. */
export default function CommunityView({ openChannel }: { openChannel?: number | null }) {
  const { list, error, setError, load } = useConversations();
  const [selected, setSelected] = useState<number | null>(openChannel ?? null);
  const [topicId, setTopicId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ChannelInfo | null>(null);
  const [pickingPerson, setPickingPerson] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [mobileChat, setMobileChat] = useState(Boolean(openChannel));
  const [focus, setFocus] = useState<{ id: number; key: number } | null>(null);
  const hits = useMessageSearch(query);
  const openHit = (hit: MessageHit) => { setSelected(hit.channelId); setTopicId(hit.topicId); setMobileChat(true); setFocus((current) => ({ id: hit.id, key: (current?.key ?? 0) + 1 })); };

  const open = useCallback(async (conversation: Conversation) => {
    setSelected(conversation.id);
    setMobileChat(true);
    try { setTopicId(await conversationTopic(conversation)); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível abrir a conversa."); }
  }, [setError]);

  // Primeira abertura: a conversa pedida, a primeira com não lidas ou #geral.
  useEffect(() => {
    if (!list || topicId) return;
    const target = list.channels.find((entry) => entry.id === selected) ?? list.channels.find((entry) => entry.unread && !entry.archived) ?? list.channels.find((entry) => entry.name === "geral") ?? list.channels[0];
    if (!target) return;
    const timer = window.setTimeout(() => { void open(target); }, 0);
    return () => window.clearTimeout(timer);
  }, [list, topicId, selected, open]);

  if (!list) return error ? <div className="alert error"><span>{error}</span></div> : <div className="cv-loading"><div className="loading-list"><span /><span /><span /></div></div>;
  const term = fold(query.trim());
  const match = (entry: Conversation) => !term || fold(`${entry.name} ${entry.topic}`).includes(term);
  const byRecent = (a: Conversation, b: Conversation) => (b.preview?.at ?? "").localeCompare(a.preview?.at ?? "") || a.name.localeCompare(b.name);
  const channels = list.channels.filter((entry) => entry.kind === "channel" && entry.archived === showArchived && match(entry)).sort(byRecent);
  const people = list.channels.filter((entry) => entry.kind === "dm" && match(entry)).sort(byRecent);
  const archivedCount = list.channels.filter((entry) => entry.kind === "channel" && entry.archived).length;

  async function openDm(memberId: number) {
    setPickingPerson(false);
    if (memberId === list?.me.id) return;
    try {
      const result = await call("/api/chat", { action: "openDm", memberId });
      await load();
      setSelected(Number(result.id)); setTopicId(Number(result.topicId)); setMobileChat(true);
    } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível abrir a conversa."); }
  }

  return <div className={`community ${mobileChat ? "mobile-chat" : ""}`}>
    <aside className="cv-list" aria-label="Conversas">
      <div className="cv-list-head">
        <MyStatus me={list.me} people={list.people} onChanged={() => void load()} />
        <label className="cv-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar conversa ou mensagem" aria-label="Buscar conversa ou mensagem" />{query && <button onClick={() => setQuery("")} aria-label="Limpar busca"><X size={14} /></button>}</label>
        <button className="cv-icon-button" onClick={() => setPickingPerson(true)} aria-label="Conversar com uma pessoa" title="Conversar com uma pessoa"><MessagesSquare size={18} /></button>
      </div>
      <div className="cv-scroll">
        <header className="cv-group-head"><span>{showArchived ? "Canais arquivados" : "Canais"}</span><button className="cv-icon-button small" onClick={() => setCreating(true)} aria-label="Criar canal" title="Criar canal"><Plus size={15} /></button></header>
        {channels.map((entry) => <ConversationRow key={entry.id} conversation={entry} people={list.people} active={selected === entry.id} onOpen={() => void open(entry)} />)}
        {archivedCount > 0 && <button className="cv-more" onClick={() => setShowArchived((value) => !value)}>{showArchived ? "Voltar aos canais" : `Arquivados (${archivedCount})`}</button>}
        <header className="cv-group-head"><span>Pessoas</span><button className="cv-icon-button small" onClick={() => setPickingPerson(true)} aria-label="Conversar com uma pessoa" title="Conversar com uma pessoa"><Plus size={15} /></button></header>
        {people.map((entry) => <ConversationRow key={entry.id} conversation={entry} people={list.people} active={selected === entry.id} onOpen={() => void open(entry)} />)}
        {!people.length && !term && <p className="cv-note">Converse em particular com alguém pelo +. Só vocês dois leem.</p>}
        {term && !channels.length && !people.length && hits === null && <p className="cv-note">Nenhuma conversa com esse nome.</p>}
        <MessageResults results={hits} term={query} people={list.people} onOpen={openHit} />
      </div>
    </aside>
    <main className="cv-main">
      {error && <div className="alert error"><span>{error}</span><button onClick={() => setError("")} aria-label="Fechar aviso"><X size={16} /></button></div>}
      {topicId ? <Thread key={topicId} topicId={topicId} focus={focus} people={list.people} me={list.me} onChanged={() => void load()} onBack={() => setMobileChat(false)}
        actions={(channel) => channel.canManage && channel.kind === "channel" ? <span className="cv-thread-actions">
          <button className="cv-icon-button" onClick={() => setEditing(channel)} aria-label="Editar canal" title="Editar canal"><Pencil size={16} /></button>
          <button className="cv-icon-button" onClick={() => { if (channel.archived || window.confirm(`Arquivar #${channel.name}? Ninguém mais escreve nele, mas o histórico continua.`)) void call("/api/chat", { action: channel.archived ? "restoreChannel" : "archiveChannel", channelId: channel.id }).then(load); }} aria-label={channel.archived ? "Restaurar canal" : "Arquivar canal"} title={channel.archived ? "Restaurar canal" : "Arquivar canal"}>{channel.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}</button>
        </span> : null} />
        : <div className="cv-loading"><div className="loading-list"><span /></div></div>}
    </main>
    {creating && <ChannelModal onClose={() => setCreating(false)} onSaved={async (id) => { setCreating(false); await load(); if (id) { setSelected(id); setTopicId(null); } }} />}
    {editing && <ChannelModal channel={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); const id = topicId; setTopicId(null); window.setTimeout(() => setTopicId(id), 0); }} />}
    {pickingPerson && <PersonPicker people={list.people.filter((person) => person.id !== list.me.id)} onClose={() => setPickingPerson(false)} onPick={(id) => void openDm(id)} />}
  </div>;
}

function ChannelModal({ channel, onClose, onSaved }: { channel?: ChannelInfo; onClose: () => void; onSaved: (id: number | null) => void }) {
  const [form, setForm] = useState({ name: channel?.name ?? "", topic: channel?.description ?? "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><form className="modal" onSubmit={async (event) => { event.preventDefault(); setSaving(true); setError(""); try { const result = await call("/api/chat", channel ? { action: "updateChannel", channelId: channel.id, ...form } : { action: "createChannel", ...form }); onSaved(result.id ? Number(result.id) : null); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível salvar."); setSaving(false); } }}>
    <div className="modal-head"><div><h2>{channel ? `Editar #${channel.name}` : "Novo canal"}</h2><p>Canais são abertos: todos da equipe leem e escrevem.</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
    <div className="form-grid">
      <label className="full"><span>Nome do canal</span><input autoFocus required maxLength={40} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ex.: futebol" /></label>
      <label className="full"><span>Descrição <em>opcional</em></span><input maxLength={200} value={form.topic} onChange={(event) => setForm({ ...form, topic: event.target.value })} placeholder="Ex.: Resenha dos jogos do fim de semana" /></label>
    </div>
    {error && <p className="modal-error">{error}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={saving || !form.name.trim()}>{saving ? "Salvando..." : channel ? "Salvar" : "Criar canal"}</button></div>
  </form></div>;
}

export function PersonPicker({ people, onClose, onPick }: { people: Person[]; onClose: () => void; onPick: (id: number) => void }) {
  const [query, setQuery] = useState("");
  const list = people.filter((person) => fold(`${person.name} ${person.jobTitle ?? ""}`).includes(fold(query.trim()))).sort((a, b) => Number(Boolean(b.online)) - Number(Boolean(a.online)) || a.name.localeCompare(b.name, "pt-BR"));
  return <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><div className="modal person-picker">
    <div className="modal-head"><div><h2>Conversar com uma pessoa</h2><p>Só vocês dois leem as mensagens.</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
    <div className="person-picker-body">
      <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar pessoa" aria-label="Buscar pessoa" />
      <ul>{list.map((person) => <li key={person.id}><button onClick={() => onPick(person.id)}><Avatar member={person} size={32} /><span><strong>{person.name}</strong><small>{[person.status ? statusText(person.status) : person.online ? "Online" : "", person.jobTitle].filter(Boolean).join(" · ") || " "}</small></span></button></li>)}</ul>
    </div>
  </div></div>;
}
