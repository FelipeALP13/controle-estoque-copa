"use client";

// Chat ao lado do trabalho: abre em qualquer tela do Portal pelo botão no topo.
import { useEffect, useState } from "react";
import Maximize2 from "lucide-react/icons/maximize-2";
import MessagesSquare from "lucide-react/icons/messages-square";
import Search from "lucide-react/icons/search";
import X from "lucide-react/icons/x";
import { call, fold, MyStatus, Thread } from "./chat-thread";
import { ConversationRow, conversationTopic, MessageResults, PersonPicker, useConversations, useMessageSearch, type Conversation } from "./community-view";

/** Botão do topo com o número de mensagens não lidas. */
export function ChatPanelButton({ unread, direct, active, onClick }: { unread: number; direct: number; active: boolean; onClick: () => void }) {
  return <button className={`chat-panel-button ${active ? "active" : ""}`} onClick={onClick} aria-label={unread ? `Chat: ${unread} não lidas` : "Chat"} title="Chat (abre ao lado, sem sair desta tela)">
    <MessagesSquare size={18} />
    {unread > 0 && <b className={direct ? "danger" : ""}>{unread > 99 ? "99+" : unread}</b>}
  </button>;
}

export default function ChatPanel({ onClose, onOpenFull }: { onClose: () => void; onOpenFull: (channelId: number | null) => void }) {
  const { list, error, setError, load } = useConversations();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<{ channelId: number; topicId: number; focus?: { id: number; key: number } } | null>(null);
  const hits = useMessageSearch(query);
  const [pickingPerson, setPickingPerson] = useState(false);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !(event.target instanceof HTMLTextAreaElement)) onClose(); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);

  async function openConversation(conversation: Conversation) {
    try { setOpen({ channelId: conversation.id, topicId: await conversationTopic(conversation) }); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível abrir a conversa."); }
  }
  async function openDm(memberId: number) {
    setPickingPerson(false);
    try { const result = await call("/api/chat", { action: "openDm", memberId }); await load(); setOpen({ channelId: Number(result.id), topicId: Number(result.topicId) }); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível abrir a conversa."); }
  }

  const term = fold(query.trim());
  const conversations = (list?.channels ?? []).filter((entry) => !entry.archived && (!term || fold(`${entry.name} ${entry.topic}`).includes(term)))
    .sort((a, b) => b.unread - a.unread || (b.preview?.at ?? "").localeCompare(a.preview?.at ?? "") || a.name.localeCompare(b.name));
  return <aside className="community chat-panel" aria-label="Chat">
    {open && list ? <Thread key={open.topicId} topicId={open.topicId} focus={open.focus ?? null} people={list.people} me={list.me} compact onChanged={() => void load()} onBack={() => { setOpen(null); void load(); }} onOpenFull={() => onOpenFull(open.channelId)} />
      : <>
        <header className="chat-panel-head">
          {list && <MyStatus me={list.me} people={list.people} onChanged={() => void load()} />}
          <strong>Chat</strong>
          <button className="cv-icon-button" onClick={() => setPickingPerson(true)} aria-label="Conversar com uma pessoa" title="Conversar com uma pessoa"><MessagesSquare size={17} /></button>
          <button className="cv-icon-button" onClick={() => onOpenFull(null)} aria-label="Abrir em tela cheia" title="Abrir em tela cheia"><Maximize2 size={16} /></button>
          <button className="cv-icon-button" onClick={onClose} aria-label="Fechar chat"><X size={18} /></button>
        </header>
        <label className="cv-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar conversa ou mensagem" aria-label="Buscar conversa ou mensagem" /></label>
        {error && <p className="cv-error">{error}</p>}
        <div className="cv-scroll">
          {!list ? <div className="loading-list"><span /><span /></div>
            : conversations.length ? conversations.map((entry) => <ConversationRow key={entry.id} conversation={entry} people={list.people} active={false} onOpen={() => void openConversation(entry)} />)
            : hits === null && <p className="cv-note">Nada encontrado.</p>}
          {list && <MessageResults results={hits} term={query} people={list.people} onOpen={(hit) => setOpen({ channelId: hit.channelId, topicId: hit.topicId, focus: { id: hit.id, key: Date.now() } })} />}
        </div>
        {pickingPerson && list && <PersonPicker people={list.people.filter((person) => person.id !== list.me.id)} onClose={() => setPickingPerson(false)} onPick={(id) => void openDm(id)} />}
      </>}
  </aside>;
}
