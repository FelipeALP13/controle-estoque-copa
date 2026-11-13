"use client";

import { useCallback, useEffect, useState } from "react";
import Check from "lucide-react/icons/check";
import Megaphone from "lucide-react/icons/megaphone";
import Plus from "lucide-react/icons/plus";
import Trash2 from "lucide-react/icons/trash-2";
import X from "lucide-react/icons/x";
import { MAX_NOTICE_BODY } from "./knowledge";
import { relativeTime } from "./tasks-view";

type Notice = { id: number; title: string; body: string; important: boolean; expiresOn: string | null; createdByName: string; createdAt: string; readByMe: boolean; readCount: number; audience: number; pending: string[] | null; canDelete: boolean; teamName: string | null; remindedAt: string | null; remindedRecently: boolean };
type Data = { notices: Notice[]; teams?: { id: number; name: string }[]; me: { id: number; canPost: boolean } };

async function post(payload: Record<string, unknown>) {
  const response = await fetch("/api/announcements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json() as { error?: string; sent?: number };
  if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
  return data;
}

const fullDate = (value: string) => value.split("-").reverse().join("/");

/** Mural de avisos da Visão geral: comunicados com "li e entendi" e quem ainda não leu. */
export default function NoticeBoard() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [showPending, setShowPending] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/announcements", { cache: "no-store" });
      if (!response.ok) { setData({ notices: [], me: { id: 0, canPost: false } }); return; }
      setData(await response.json() as Data);
    } catch {
      setData({ notices: [], me: { id: 0, canPost: false } });
    }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  async function act(payload: Record<string, unknown>) {
    setError("");
    try { await post(payload); await load(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível concluir."); }
  }

  if (!data || (!data.notices.length && !data.me.canPost)) return null;
  // Sem avisos: só uma linha discreta para quem pode publicar (não ocupa o topo da visão geral).
  if (!data.notices.length) return <article className="notice-board empty">
    <Megaphone size={16} /><p>Mural de avisos vazio.</p>
    <button onClick={() => setCreating(true)}><Plus size={14} /> Novo aviso</button>
    {creating && <NoticeModal teams={data.teams ?? []} onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); await load(); }} />}
  </article>;
  const unread = data.notices.filter((notice) => !notice.readByMe).length;
  // Primeiro os não lidos; os lidos ficam recolhidos depois dos 3 primeiros.
  const ordered = [...data.notices.filter((notice) => !notice.readByMe), ...data.notices.filter((notice) => notice.readByMe)];
  const shown = showAll ? ordered : ordered.slice(0, Math.max(3, unread));

  return <article className="notice-board">
    <div className="hub-panel-title"><div><span><Megaphone /></span><div><h3>Mural de avisos</h3><p>{data.notices.length ? (unread ? `${unread} aviso${unread === 1 ? "" : "s"} para você ler` : "Você está em dia com os avisos") : "Nenhum aviso no momento"}</p></div></div>{data.me.canPost && <button onClick={() => setCreating(true)}><Plus size={14} /> Novo aviso</button>}</div>
    {error && <p className="modal-error">{error}</p>}
    {shown.map((notice) => <div key={notice.id} className={`notice ${notice.important ? "important" : ""} ${notice.readByMe ? "read" : ""}`}>
      <div className="notice-head">
        {notice.important && <span className="notice-flag">Importante</span>}
        <strong>{notice.title}</strong>
        {notice.teamName && <span className="notice-team">Só {notice.teamName}</span>}
        {notice.canDelete && <button className="notice-delete" onClick={() => { if (window.confirm(`Tirar o aviso “${notice.title}” do mural?`)) void act({ action: "deleteNotice", noticeId: notice.id }); }} aria-label="Tirar aviso do mural" title="Tirar do mural"><Trash2 size={13} /></button>}
      </div>
      {notice.body && <p className="notice-body">{notice.body}</p>}
      <div className="notice-foot">
        <small>{notice.createdByName} · {relativeTime(notice.createdAt)}{notice.expiresOn ? ` · até ${fullDate(notice.expiresOn)}` : ""}</small>
        {notice.pending && <button className="notice-readers" onClick={() => setShowPending(showPending === notice.id ? null : notice.id)}>{notice.readCount} de {notice.audience} leram</button>}
        {notice.readByMe ? <span className="notice-done"><Check size={13} /> Lido</span> : <button className="primary-button notice-ack" onClick={() => void act({ action: "markRead", noticeId: notice.id })}><Check size={14} /> Li e entendi</button>}
      </div>
      {showPending === notice.id && notice.pending && <p className="notice-pending">{notice.pending.length ? <>Ainda não leram: {notice.pending.join(", ")} <button className="link-button" disabled={notice.remindedRecently} title={notice.remindedAt ? `Último lembrete ${relativeTime(notice.remindedAt)}` : "Avisa no sino quem ainda não leu"} onClick={async () => { setError(""); try { const result = await post({ action: "remindPending", noticeId: notice.id }); window.alert(`Lembrete enviado para ${result.sent ?? 0} pessoa${result.sent === 1 ? "" : "s"}.`); await load(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível lembrar."); } }}>{notice.remindedRecently ? "Lembrete enviado" : "Lembrar quem não leu"}</button></> : "Todo mundo já leu."}</p>}
    </div>)}
    {ordered.length > shown.length && <button className="notice-more" onClick={() => setShowAll(true)}>Ver avisos já lidos ({ordered.length - shown.length})</button>}
    {creating && <NoticeModal teams={data.teams ?? []} onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); await load(); }} />}
  </article>;
}

function NoticeModal({ teams, onClose, onSaved }: { teams: { id: number; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ title: "", body: "", important: false, expiresOn: "", teamId: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await post({ action: "createNotice", ...form, expiresOn: form.expiresOn || null, teamId: Number(form.teamId) || null });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível publicar.");
      setSaving(false);
    }
  }

  return <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><form className="modal" onSubmit={submit}>
    <div className="modal-head"><div><h2>Novo aviso</h2><p>Aparece na Visão geral, com o botão “Li e entendi”, e todos do público recebem aviso no sino.</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
    <div className="form-grid">
      <label className="full"><span>Título</span><input autoFocus required maxLength={120} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Ex.: Nova regra para abertura de chamados" /></label>
      <label className="full"><span>Mensagem</span><textarea rows={5} maxLength={MAX_NOTICE_BODY} value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} placeholder="O que muda, a partir de quando e quem procurar em caso de dúvida." /></label>
      <label><span>Para quem</span><select value={form.teamId} onChange={(event) => setForm({ ...form, teamId: event.target.value })}><option value="">Todos</option>{teams.map((team) => <option key={team.id} value={team.id}>Só o time {team.name}</option>)}</select></label>
      <label><span>Fica no mural até (opcional)</span><input type="date" min={today} value={form.expiresOn} onChange={(event) => setForm({ ...form, expiresOn: event.target.value })} /></label>
      <label className="checkbox-line"><input type="checkbox" checked={form.important} onChange={(event) => setForm({ ...form, important: event.target.checked })} /> <span>Importante (fica no topo, em destaque)</span></label>
    </div>
    {error && <p className="modal-error">{error}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={saving || !form.title.trim()}>{saving ? "Publicando..." : "Publicar aviso"}</button></div>
  </form></div>;
}
