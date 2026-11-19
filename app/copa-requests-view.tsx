"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import BellRing from "lucide-react/icons/bell-ring";
import Check from "lucide-react/icons/check";
import HandPlatter from "lucide-react/icons/hand-platter";
import ThumbsUp from "lucide-react/icons/thumbs-up";
import Trash2 from "lucide-react/icons/trash-2";
import X from "lucide-react/icons/x";
import { relativeTime } from "./task-shared";
import { MAX_REQUEST_NOTE, MAX_REQUEST_TITLE, REQUEST_STATUS_LABEL, type RequestStatus } from "./copa-tools";
import type { Item } from "./dashboard-shared";

type CopaRequest = {
  id: number; title: string; note: string; status: RequestStatus;
  createdByName: string; createdAt: string; mine: boolean;
  votes: number; voted: boolean; voters: string[];
  decidedByName: string | null; decidedAt: string | null; decisionNote: string;
  item: { id: number; name: string } | null; canDelete: boolean;
};
type Settings = { memberIds: number[]; channelId: number | null; channels: { id: number; name: string }[]; people: { id: number; name: string }[]; receivers: string[] };
type Data = { requests: CopaRequest[]; me: { id: number; canRequest: boolean; canDecide: boolean }; settings: Settings | null };
type Decision = { request: CopaRequest; mode: "approve" | "decline" };

async function send(payload: Record<string, unknown>) {
  const response = await fetch("/api/copa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json().catch(() => ({})) as { error?: string; requestId?: number };
  if (!response.ok) throw Object.assign(new Error(data.error || "Não foi possível salvar."), { requestId: data.requestId });
  return data;
}

/** Pedidos da equipe para a Copa: qualquer um pede, os outros apoiam e quem cuida das compras decide. */
export function CopaRequestsView({ items, onStockChanged }: { items: Item[]; onStockChanged: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/copa", { cache: "no-store" });
      const next = await response.json() as Data & { error?: string };
      if (!response.ok) throw new Error(next.error || "Não foi possível carregar os pedidos.");
      setData(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar os pedidos.");
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => { void load(); }, 0);
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 30000);
    return () => { window.clearTimeout(first); window.clearInterval(interval); };
  }, [load]);

  async function act(payload: Record<string, unknown>) {
    setError("");
    try {
      await send(payload);
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
      return false;
    }
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError("");
    try {
      await send({ action: "createRequest", title, note });
      setTitle("");
      setNote("");
      await load();
    } catch (err) {
      const requestId = (err as { requestId?: number }).requestId;
      setError(err instanceof Error ? err.message : "Não foi possível pedir.");
      if (requestId) {
        setHighlight(requestId);
        window.setTimeout(() => document.getElementById(`copa-request-${requestId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
        window.setTimeout(() => setHighlight(null), 2600);
      }
    } finally {
      setBusy(false);
    }
  }

  const open = data?.requests.filter((request) => request.status === "open") ?? [];
  const decided = data?.requests.filter((request) => request.status !== "open") ?? [];

  return <div className="copa-requests">
    <section className="copa-ask">
      <div className="copa-ask-head">
        <span className="insight-icon"><HandPlatter /></span>
        <div><h2>O que está faltando na Copa?</h2><p>Peça um item. Quem concordar apoia, e quem cuida das compras vê os pedidos mais apoiados primeiro.</p></div>
        {data?.settings && <button type="button" className="secondary-button" onClick={() => setShowSettings((value) => !value)} aria-expanded={showSettings}><BellRing size={15} /> Quem cuida das compras</button>}
      </div>
      {data?.me.canRequest !== false && <form className="copa-ask-form" onSubmit={create}>
        <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={MAX_REQUEST_TITLE} placeholder="Ex.: adoçante, chá de camomila, pão de queijo" aria-label="O que você quer pedir" />
        <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={MAX_REQUEST_NOTE} placeholder="Detalhe (opcional): marca, sabor, quantidade" aria-label="Detalhe do pedido" />
        <button className="primary-button" disabled={busy || title.trim().length < 2}>Pedir</button>
      </form>}
    </section>

    {showSettings && data?.settings && <AlertSettings settings={data.settings} onSaved={async () => { await load(); setShowSettings(false); }} />}

    {error && <div className="alert error"><span>{error}</span><button onClick={() => setError("")} aria-label="Fechar aviso"><X size={16} /></button></div>}

    <section className="copa-board">
      <h3>Aguardando decisão {open.length > 0 && <b>{open.length}</b>}</h3>
      {!data ? <div className="loading-list" aria-label="Carregando pedidos"><span /><span /></div> : open.length === 0 ? <p className="copa-muted">Nenhum pedido aguardando. Sentiu falta de algo? Peça acima.</p> : <ul className="copa-list">
        {open.map((request) => <li key={request.id} id={`copa-request-${request.id}`} className={highlight === request.id ? "flash" : ""}>
          <button type="button" className={`copa-vote ${request.voted ? "on" : ""}`} disabled={request.mine || !data.me.canRequest}
            onClick={() => act({ action: "vote", requestId: request.id, on: !request.voted })}
            aria-pressed={request.voted} title={request.mine ? "Seu pedido já conta como apoio" : request.voted ? "Tirar meu apoio" : "Apoiar este pedido"}>
            <ThumbsUp size={16} /><b>{request.votes}</b>
          </button>
          <div className="copa-body">
            <strong>{request.title}</strong>
            {request.note && <p>{request.note}</p>}
            <small>Pedido por {request.mine ? "você" : request.createdByName} · {relativeTime(request.createdAt)}{request.votes > 1 && <span title={request.voters.join(", ")}> · apoiado por {request.voters.slice(0, 3).join(", ")}{request.voters.length > 3 ? ` e mais ${request.voters.length - 3}` : ""}</span>}</small>
          </div>
          <div className="copa-actions">
            {data.me.canDecide && <>
              <button type="button" className="secondary-button" onClick={() => setDecision({ request, mode: "approve" })}><Check size={15} /> Aprovar</button>
              <button type="button" className="secondary-button" onClick={() => setDecision({ request, mode: "decline" })}>Recusar</button>
            </>}
            {request.canDelete && <button type="button" className="copa-icon" title="Tirar o pedido" aria-label={`Tirar o pedido ${request.title}`} onClick={() => { if (window.confirm(`Tirar o pedido "${request.title}"?`)) void act({ action: "deleteRequest", requestId: request.id }); }}><Trash2 size={15} /></button>}
          </div>
        </li>)}
      </ul>}
    </section>

    {decided.length > 0 && <section className="copa-board decided">
      <h3>Decididos recentemente</h3>
      <ul className="copa-list">
        {decided.map((request) => <li key={request.id}>
          <span className={`copa-status ${request.status}`}>{REQUEST_STATUS_LABEL[request.status]}</span>
          <div className="copa-body">
            <strong>{request.title}</strong>
            <small>
              {request.decidedByName ?? "Equipe"}{request.decidedAt ? ` · ${relativeTime(request.decidedAt)}` : ""}
              {request.item && request.item.name !== request.title ? ` · no estoque como ${request.item.name}` : ""}
              {request.decisionNote ? ` · ${request.decisionNote}` : ""}
            </small>
          </div>
          <span className="copa-votes-static"><ThumbsUp size={13} /> {request.votes}</span>
        </li>)}
      </ul>
    </section>}

    {decision && <DecisionModal decision={decision} items={items} onClose={() => setDecision(null)} onDone={async (approvedNew) => { setDecision(null); await load(); if (approvedNew) onStockChanged(); }} />}
  </div>;
}

function DecisionModal({ decision, items, onClose, onDone }: { decision: Decision; items: Item[]; onClose: () => void; onDone: (approvedNew: boolean) => void }) {
  const { request, mode } = decision;
  const match = items.find((item) => item.name.localeCompare(request.title, "pt-BR", { sensitivity: "base" }) === 0);
  const [link, setLink] = useState<"new" | "existing">(match ? "existing" : "new");
  const [itemId, setItemId] = useState(match ? String(match.id) : "");
  const [name, setName] = useState(request.title);
  const [category, setCategory] = useState("Outros");
  const [unit, setUnit] = useState("un.");
  const [minimumQty, setMinimumQty] = useState("1");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const categories = useMemo(() => [...new Set(items.map((item) => item.category))].sort((a, b) => a.localeCompare(b, "pt-BR")), [items]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload: Record<string, unknown> = { action: "decide", requestId: request.id, decision: mode, note };
      if (mode === "approve") {
        if (link === "existing") payload.itemId = Number(itemId);
        else Object.assign(payload, { name, category, unit, minimumQty: Number(minimumQty.replace(",", ".")) });
      }
      await send(payload);
      onDone(mode === "approve" && link === "new");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" />
    <form className="modal" onSubmit={submit}>
      <div className="modal-head"><div><h2>{mode === "approve" ? "Aprovar pedido" : "Recusar pedido"}</h2><p>{request.title} · {request.votes} {request.votes === 1 ? "apoio" : "apoios"}. Quem pediu e quem apoiou recebem o aviso.</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
      <div className="form-grid">
        {mode === "approve" && <>
          <div className="full copa-link-choice" role="radiogroup" aria-label="Como entra no estoque">
            <label><input type="radio" checked={link === "new"} onChange={() => setLink("new")} /> Cadastrar como item novo</label>
            <label><input type="radio" checked={link === "existing"} onChange={() => setLink("existing")} disabled={!items.length} /> Já existe no estoque</label>
          </div>
          {link === "existing" ? <label className="full"><span>Item do estoque</span>
            <select value={itemId} onChange={(event) => setItemId(event.target.value)} required>
              <option value="">Escolha o item…</option>
              {items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label> : <>
            <label className="full"><span>Nome no estoque</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required /></label>
            <label><span>Categoria</span><input value={category} onChange={(event) => setCategory(event.target.value)} list="copa-categories" maxLength={40} /><datalist id="copa-categories">{categories.map((value) => <option key={value} value={value} />)}</datalist></label>
            <label><span>Unidade</span><input value={unit} onChange={(event) => setUnit(event.target.value)} maxLength={20} placeholder="pacote, caixa, un." /></label>
            <label><span>Estoque mínimo</span><input value={minimumQty} onChange={(event) => setMinimumQty(event.target.value)} inputMode="decimal" /><small>Começa com saldo zero e já entra na lista de compras.</small></label>
          </>}
        </>}
        <label className="full"><span>{mode === "approve" ? "Recado (opcional)" : "Motivo (opcional)"}</span><input value={note} onChange={(event) => setNote(event.target.value)} maxLength={200} placeholder={mode === "approve" ? "Ex.: chega na próxima compra" : "Ex.: fora do orçamento deste mês"} /></label>
      </div>
      {error && <p className="modal-error">{error}</p>}
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={saving || (mode === "approve" && link === "existing" && !itemId)}>{saving ? "Salvando…" : mode === "approve" ? "Aprovar" : "Recusar pedido"}</button></div>
    </form>
  </div>;
}

function AlertSettings({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const [picked, setPicked] = useState<number[]>(settings.memberIds);
  const [channelId, setChannelId] = useState(settings.channelId ? String(settings.channelId) : "");
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const query = filter.trim().toLocaleLowerCase("pt-BR");
  const people = settings.people.filter((person) => !query || person.name.toLocaleLowerCase("pt-BR").includes(query));
  const toggle = (id: number) => setPicked((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);

  async function save() {
    setSaving(true);
    setError("");
    try {
      await send({ action: "saveAlerts", memberIds: picked, channelId: channelId ? Number(channelId) : null });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  return <section className="copa-settings">
    <div>
      <h3>Quem cuida das compras</h3>
      <p>Recebem no sino quando um item cai para o estoque mínimo ou acaba, e quando alguém faz um pedido. Sem ninguém marcado, os administradores recebem{settings.receivers.length ? ` (hoje: ${settings.receivers.join(", ")})` : ""}.</p>
    </div>
    <input className="copa-filter" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Buscar pessoa" aria-label="Buscar pessoa" />
    <div className="copa-people">
      {people.map((person) => <label key={person.id} className={picked.includes(person.id) ? "on" : ""}><input type="checkbox" checked={picked.includes(person.id)} onChange={() => toggle(person.id)} />{person.name}</label>)}
    </div>
    <label className="copa-channel"><span>Publicar o aviso de estoque baixo também no chat</span>
      <select value={channelId} onChange={(event) => setChannelId(event.target.value)}>
        <option value="">Não publicar no chat</option>
        {settings.channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
      </select>
      <small>A mensagem entra no assunto &quot;Estoque da Copa&quot; do canal escolhido.</small>
    </label>
    {error && <p className="modal-error">{error}</p>}
    <div className="copa-settings-actions"><button type="button" className="primary-button" onClick={save} disabled={saving}>{saving ? "Salvando…" : "Salvar"}</button></div>
  </section>;
}
