"use client";

import { useCallback, useEffect, useState } from "react";
import Award from "lucide-react/icons/award";
import Check from "lucide-react/icons/check";
import Lock from "lucide-react/icons/lock";
import Plus from "lucide-react/icons/plus";
import Trash2 from "lucide-react/icons/trash-2";
import Trophy from "lucide-react/icons/trophy";
import Vote from "lucide-react/icons/vote";
import X from "lucide-react/icons/x";
import { Avatar } from "./task-shared";
import { relativeTime } from "./tasks-view";
import { KUDOS_VALUES, MAX_KUDOS_MESSAGE, MAX_POLL_OPTION, MAX_POLL_OPTIONS, MAX_POLL_QUESTION, POLL_DURATIONS } from "./wall-tools";

type Face = { id: number; name: string; avatarIcon: string; avatarKey: string | null };
export type KudosItem = { id: number; fromId: number | null; fromName: string; toId: number; toName: string; to: Face | null; from: Face | null; value: { key: string; label: string; emoji: string } | null; message: string; createdAt: string; canDelete: boolean };
export type PollItem = { id: number; question: string; multiple: boolean; anonymous: boolean; channelId: number | null; createdByName: string; createdAt: string; closesAt: string | null; closedAt: string | null; open: boolean; canClose: boolean; canDelete: boolean; winners: number[]; voters: number; mine: number[]; options: { label: string; count: number; percent: number; names: string[] }[] };
type Data = { kudos: KudosItem[]; ranking: { memberId: number; count: number; name: string }[]; polls: PollItem[]; people: Face[]; me: { id: number; canPost: boolean } };

export async function wallPost(payload: Record<string, unknown>) {
  const response = await fetch("/api/wall", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json() as { error?: string };
  if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
  return data;
}

const untilLabel = (iso: string) => {
  const date = new Date(iso);
  const sameDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(date) === new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const time = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(date);
  return sameDay ? `até ${time}` : `até ${new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }).format(date)} ${time}`;
};

/** Cartão de enquete: vota com um toque (troca o voto até encerrar) e mostra o resultado em barras. */
export function PollCard({ poll, onChanged, compact = false }: { poll: PollItem; onChanged: () => void | Promise<void>; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const voted = poll.mine.length > 0;
  const showResults = voted || !poll.open;

  async function act(payload: Record<string, unknown>) {
    setBusy(true); setError("");
    try { await wallPost(payload); await onChanged(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível votar."); } finally { setBusy(false); }
  }
  function toggle(index: number) {
    if (!poll.open || busy) return;
    const next = poll.multiple ? (poll.mine.includes(index) ? poll.mine.filter((value) => value !== index) : [...poll.mine, index]) : (poll.mine.includes(index) ? [] : [index]);
    void act({ action: "vote", pollId: poll.id, options: next });
  }

  return <div className={`poll-card ${compact ? "compact" : ""} ${poll.open ? "" : "closed"}`}>
    <div className="poll-head"><Vote size={15} /><strong>{poll.question}</strong></div>
    <ul className="poll-options" role={poll.multiple ? "group" : "radiogroup"} aria-label={poll.question}>
      {poll.options.map((option, index) => {
        const mine = poll.mine.includes(index);
        const winner = poll.winners.includes(index);
        return <li key={index}>
          <button type="button" className={`${mine ? "mine" : ""} ${winner ? "winner" : ""}`} disabled={!poll.open || busy} onClick={() => toggle(index)}
            role={poll.multiple ? "checkbox" : "radio"} aria-checked={mine} title={option.names.length ? option.names.join(", ") : undefined}>
            {showResults && <i style={{ width: `${option.percent}%` }} aria-hidden="true" />}
            <span className="poll-mark" aria-hidden="true">{mine ? <Check size={12} /> : null}</span>
            <span className="poll-label">{option.label}{winner && " 🏆"}</span>
            {showResults && <b>{option.percent}%</b>}
          </button>
        </li>;
      })}
    </ul>
    <div className="poll-foot">
      <small>{poll.voters} {poll.voters === 1 ? "voto" : "votos"} · {poll.multiple ? "várias escolhas" : "uma escolha"}{poll.anonymous ? " · anônima" : ""} · {poll.open ? (poll.closesAt ? untilLabel(poll.closesAt) : "aberta") : "encerrada"}{!compact && ` · ${poll.createdByName}`}</small>
      {poll.canClose && <button type="button" className="link-button" disabled={busy} onClick={() => { if (window.confirm("Encerrar a enquete? Ninguém mais poderá votar.")) void act({ action: "closePoll", pollId: poll.id }); }}><Lock size={12} /> Encerrar</button>}
      {poll.canDelete && !compact && <button type="button" className="link-button danger" disabled={busy} onClick={() => { if (window.confirm("Apagar a enquete e os votos?")) void act({ action: "deletePoll", pollId: poll.id }); }}><Trash2 size={12} /> Apagar</button>}
    </div>
    {error && <p className="modal-error">{error}</p>}
  </div>;
}

/** Lista de elogios (mural, perfil e avaliação). */
export function KudosList({ items, onDelete, showTo = true }: { items: KudosItem[]; onDelete?: (id: number) => void; showTo?: boolean }) {
  if (!items.length) return <p className="muted">Nenhum elogio ainda.</p>;
  return <ul className="kudos-list">{items.map((item) => <li key={item.id}>
    <Avatar member={showTo ? item.to : item.from} size={30} />
    <div>
      <p className="kudos-line">{showTo ? <><b>{item.fromName.split(/\s+/)[0]}</b> elogiou <b>{item.toName}</b></> : <><b>{item.fromName}</b></>}{item.value && <span className="kudos-tag">{item.value.emoji} {item.value.label}</span>}</p>
      <p className="kudos-message">“{item.message}”</p>
      <small>{relativeTime(item.createdAt)}</small>
    </div>
    {item.canDelete && onDelete && <button type="button" className="notice-delete" onClick={() => { if (window.confirm("Apagar este elogio?")) onDelete(item.id); }} aria-label="Apagar elogio" title="Apagar"><Trash2 size={13} /></button>}
  </li>)}</ul>;
}

/** Elogios recebidos por uma pessoa (no perfil ou na avaliação, opcionalmente num período): o total e a lista ao abrir. */
export function PersonKudos({ memberId, count, from, to, suffix = "" }: { memberId: number; count?: number; from?: string; to?: string; suffix?: string }) {
  const [items, setItems] = useState<KudosItem[] | null>(null);
  const [open, setOpen] = useState(false);
  const period = from && to ? `&from=${from}&to=${to}` : "";
  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/wall?memberId=${memberId}${period}`, { cache: "no-store" });
      if (response.ok) setItems(((await response.json()) as { kudos: KudosItem[] }).kudos);
    } catch { /* sem conexão: mostra de novo ao abrir */ }
  }, [memberId, period]);
  // Sem o total vindo de fora (avaliação), busca a lista para contar.
  useEffect(() => { if (count === undefined) { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); } }, [count, load]);
  const total = count ?? items?.length ?? 0;
  if (!total) return null;
  return <div className="person-kudos">
    <button type="button" className="link-button" onClick={() => { setOpen(!open); if (!items) void load(); }}><Award size={13} /> {total} {total === 1 ? "elogio" : "elogios"}{suffix}{open ? " ▴" : " ▾"}</button>
    {open && (items ? <KudosList items={items} showTo={false} /> : <div className="loading-list"><span /><span /></div>)}
  </div>;
}

/** Mural da equipe na Visão geral: elogios recentes, destaques do mês e enquetes rápidas. */
export default function TeamWall() {
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<"kudos" | "polls">("kudos");
  const [modal, setModal] = useState<"kudos" | "poll" | null>(null);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/wall", { cache: "no-store" });
      if (!response.ok) return;
      setData(await response.json() as Data);
    } catch { /* tenta de novo depois */ }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  if (!data) return null;
  const openPolls = data.polls.filter((poll) => poll.open);
  const pending = openPolls.filter((poll) => !poll.mine.length).length;
  const kudosShown = showAll ? data.kudos : data.kudos.slice(0, 4);
  const modals = <>
    {modal === "kudos" && <KudosModal people={data.people} onClose={() => setModal(null)} onSaved={async () => { setModal(null); setTab("kudos"); await load(); }} />}
    {modal === "poll" && <PollModal onClose={() => setModal(null)} onSave={async (payload) => { await wallPost({ action: "createPoll", ...payload }); setModal(null); setTab("polls"); await load(); }} />}
  </>;

  // Sem elogios nem enquetes recentes: uma linha só, com os botões (sem abas vazias ocupando a tela).
  if (!data.kudos.length && !data.polls.length) return <article className="team-wall is-empty">
    <div className="hub-panel-title"><div><span><Award /></span><div><h3>Mural da equipe</h3><p>Nenhum elogio ou enquete recente. Reconheça um colega que ajudou você.</p></div></div>
      {data.me.canPost && <div className="team-wall-actions"><button onClick={() => setModal("kudos")}><Award size={14} /> Elogiar colega</button><button onClick={() => setModal("poll")}><Plus size={14} /> Nova enquete</button></div>}
    </div>
    {modals}
  </article>;

  return <article className="team-wall">
    <div className="hub-panel-title"><div><span><Award /></span><div><h3>Mural da equipe</h3><p>Elogios e enquetes rápidas{pending ? ` · ${pending} enquete${pending === 1 ? "" : "s"} esperando seu voto` : ""}</p></div></div>
      {data.me.canPost && <div className="team-wall-actions"><button onClick={() => setModal("kudos")}><Award size={14} /> Elogiar colega</button><button onClick={() => setModal("poll")}><Plus size={14} /> Nova enquete</button></div>}
    </div>
    <div className="tasks-scope team-wall-tabs" role="group" aria-label="Mural">
      <button className={tab === "kudos" ? "active" : ""} aria-pressed={tab === "kudos"} onClick={() => setTab("kudos")}>Elogios{data.kudos.length > 0 && <b>{data.kudos.length}</b>}</button>
      <button className={tab === "polls" ? "active" : ""} aria-pressed={tab === "polls"} onClick={() => setTab("polls")}>Enquetes{pending > 0 && <b>{pending}</b>}</button>
    </div>
    {error && <p className="modal-error">{error}</p>}
    {tab === "kudos" ? <>
      {data.ranking.length > 0 && <p className="kudos-ranking"><Trophy size={14} /> Mais elogiados do mês: {data.ranking.map((entry, index) => <span key={entry.memberId}>{["🥇", "🥈", "🥉"][index]} {entry.name.split(/\s+/)[0]} ({entry.count})</span>)}</p>}
      {data.kudos.length ? <KudosList items={kudosShown} onDelete={async (id) => { setError(""); try { await wallPost({ action: "deleteKudos", kudosId: id }); await load(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível apagar."); } }} />
        : <p className="muted">Ninguém foi elogiado nos últimos 30 dias. Que tal começar? Reconheça um colega que ajudou você.</p>}
      {data.kudos.length > kudosShown.length && <button className="notice-more" onClick={() => setShowAll(true)}>Ver todos ({data.kudos.length})</button>}
    </> : <div className="team-wall-polls">
      {data.polls.length ? data.polls.map((poll) => <PollCard key={poll.id} poll={poll} onChanged={load} />) : <p className="muted">Nenhuma enquete nas últimas duas semanas. Ex.: “Pizza ou japonês na sexta?”</p>}
    </div>}
    {modals}
  </article>;
}

function KudosModal({ people, onClose, onSaved }: { people: Face[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ toId: "", value: "", message: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true); setError("");
    try { await wallPost({ action: "giveKudos", toId: Number(form.toId), value: form.value, message: form.message }); onSaved(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível enviar."); setSaving(false); }
  }
  return <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><form className="modal" onSubmit={submit}>
    <div className="modal-head"><div><h2>Elogiar um colega</h2><p>Aparece no mural para todos, fica no perfil da pessoa e entra na avaliação dela. Ela recebe um aviso.</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
    <div className="form-grid">
      <label className="full"><span>Quem</span><select autoFocus required value={form.toId} onChange={(event) => setForm({ ...form, toId: event.target.value })}><option value="">Escolha a pessoa</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
      <div className="full kudos-values" role="radiogroup" aria-label="Tipo de elogio">{KUDOS_VALUES.map((entry) => <button key={entry.key} type="button" role="radio" aria-checked={form.value === entry.key} className={form.value === entry.key ? "active" : ""} onClick={() => setForm({ ...form, value: form.value === entry.key ? "" : entry.key })}>{entry.emoji} {entry.label}</button>)}</div>
      <label className="full"><span>O que a pessoa fez</span><textarea required rows={4} maxLength={MAX_KUDOS_MESSAGE} value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} placeholder="Ex.: Ficou até mais tarde para ajudar no atendimento do cliente X e resolveu o problema." /></label>
    </div>
    {error && <p className="modal-error">{error}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={saving || !form.toId || form.message.trim().length < 3}>{saving ? "Enviando..." : "Publicar elogio"}</button></div>
  </form></div>;
}

/** Nova enquete (mural ou chat). */
export function PollModal({ onClose, onSave, where = "no mural" }: { onClose: () => void; onSave: (payload: { question: string; options: string[]; multiple: boolean; anonymous: boolean; duration: string }) => Promise<void>; where?: string }) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [multiple, setMultiple] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [duration, setDuration] = useState("1d");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const filled = options.filter((option) => option.trim()).length;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true); setError("");
    try { await onSave({ question, options, multiple, anonymous, duration }); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível criar."); setSaving(false); }
  }
  return <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><form className="modal" onSubmit={submit}>
    <div className="modal-head"><div><h2>Nova enquete</h2><p>Pergunta rápida para a equipe votar {where}. Dá para mudar o voto até encerrar.</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
    <div className="form-grid">
      <label className="full"><span>Pergunta</span><input autoFocus required maxLength={MAX_POLL_QUESTION} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ex.: Pizza ou japonês na sexta?" /></label>
      <div className="full poll-option-inputs"><span>Opções</span>
        {options.map((option, index) => <div key={index}><input maxLength={MAX_POLL_OPTION} value={option} onChange={(event) => setOptions(options.map((value, position) => position === index ? event.target.value : value))} placeholder={`Opção ${index + 1}`} aria-label={`Opção ${index + 1}`} />
          {options.length > 2 && <button type="button" className="task-drawer-icon" onClick={() => setOptions(options.filter((_, position) => position !== index))} aria-label={`Tirar opção ${index + 1}`}><X size={14} /></button>}</div>)}
        {options.length < MAX_POLL_OPTIONS && <button type="button" className="link-button" onClick={() => setOptions([...options, ""])}><Plus size={13} /> Adicionar opção</button>}
      </div>
      <label><span>Fica aberta</span><select value={duration} onChange={(event) => setDuration(event.target.value)}>{POLL_DURATIONS.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}</select></label>
      <div className="poll-switches">
        <label className="checkbox-line"><input type="checkbox" checked={multiple} onChange={(event) => setMultiple(event.target.checked)} /> <span>Pode escolher mais de uma</span></label>
        <label className="checkbox-line"><input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} /> <span>Anônima (não mostra quem votou)</span></label>
      </div>
    </div>
    {error && <p className="modal-error">{error}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={saving || question.trim().length < 3 || filled < 2}>{saving ? "Criando..." : "Criar enquete"}</button></div>
  </form></div>;
}
