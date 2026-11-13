"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import KeyRound from "lucide-react/icons/key-round";
import Laptop from "lucide-react/icons/laptop";
import Pencil from "lucide-react/icons/pencil";
import Plus from "lucide-react/icons/plus";
import Search from "lucide-react/icons/search";
import Trash2 from "lucide-react/icons/trash-2";
import X from "lucide-react/icons/x";
import { assetStatusLabels, daysBetween, type AssetStatus } from "./people-tools";
import { Avatar, relativeTime } from "./task-shared";

type Person = { id: number; name: string; avatarIcon: string; avatarKey: string | null; active: boolean };
type Asset = { id: number; kind: "equipment" | "license"; name: string; category: string; identifier: string; status: AssetStatus; seats: number; purchaseDate: string | null; expiresOn: string | null; cost: number | null; notes: string; memberIds: number[]; events: { id: number; text: string; byName: string; at: string }[] };
type Data = { assets: Asset[]; people: Person[]; me: { id: number; isAdmin: boolean } };

async function call(payload: Record<string, unknown>) {
  const response = await fetch("/api/assets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json() as { error?: string };
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir.");
  return data;
}
const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const shortDate = (day: string) => day.split("-").reverse().join("/");
const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");

/** Equipamentos e licenças da empresa: com quem está cada um e o que vence. */
export default function AssetsView() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<"all" | "equipment" | "license" | "mine">("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Asset | "equipment" | "license" | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/assets", { cache: "no-store" });
      const json = await response.json() as Data & { error?: string };
      if (!response.ok) throw new Error(json.error || "Não foi possível carregar.");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar.");
    }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  const today = todayIso();
  const list = useMemo(() => {
    if (!data) return [];
    const term = fold(query.trim());
    const nameOf = (id: number) => data.people.find((person) => person.id === id)?.name ?? "";
    return data.assets.filter((asset) => (kind === "all" || (kind === "mine" ? asset.memberIds.includes(data.me.id) : asset.kind === kind))
      && (!term || fold([asset.name, asset.category, asset.identifier, ...asset.memberIds.map(nameOf)].join(" ")).includes(term)));
  }, [data, kind, query]);

  if (!data) return error ? <div className="alert error"><span>{error}</span></div> : <div className="loading-list"><span /><span /></div>;
  const active = data.assets.filter((asset) => asset.status !== "retired");
  const expiring = active.filter((asset) => asset.expiresOn && daysBetween(today, asset.expiresOn) <= 30);
  const mine = data.assets.filter((asset) => asset.memberIds.includes(data.me.id));
  const stats = [
    { label: "Equipamentos", value: active.filter((asset) => asset.kind === "equipment").length, detail: plural(active.filter((asset) => asset.kind === "equipment" && asset.status === "available").length, "disponível", "disponíveis") },
    { label: "Licenças", value: active.filter((asset) => asset.kind === "license").length, detail: `${plural(active.filter((asset) => asset.kind === "license").reduce((sum, asset) => sum + asset.memberIds.length, 0), "vaga", "vagas")} em uso` },
    { label: "Vencem em 30 dias", value: expiring.length, detail: expiring.length ? expiring.slice(0, 2).map((asset) => asset.name).join(", ") : "nada perto de vencer", warn: expiring.length > 0 },
    { label: "Com você", value: mine.length, detail: mine.length ? mine.slice(0, 2).map((asset) => asset.name).join(", ") : "nada no seu nome" },
  ];

  async function remove(asset: Asset) {
    if (!window.confirm(`Excluir “${asset.name}” e o histórico? Para guardar o histórico, prefira mudar a situação para “Baixado”.`)) return;
    try { await call({ action: "deleteAsset", assetId: asset.id }); await load(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível excluir."); }
  }

  return <div className="clients-page">
    <div className="client-stats">{stats.map((stat) => <article key={stat.label} className={"warn" in stat && stat.warn ? "warn" : ""}><small>{stat.label}</small><strong>{stat.value}</strong><span>{stat.detail}</span></article>)}</div>
    <div className="client-report assets-toolbar">
      <div className="tasks-scope" role="tablist" aria-label="Mostrar">{([["all", "Todos"], ["equipment", "Equipamentos"], ["license", "Licenças"], ["mine", "Comigo"]] as const).map(([value, label]) => <button key={value} role="tab" aria-selected={kind === value} className={kind === value ? "active" : ""} onClick={() => setKind(value)}>{label}</button>)}</div>
      <label className="assets-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nome, patrimônio ou pessoa" aria-label="Buscar" /></label>
      {data.me.isAdmin && <span className="sprint-actions"><button className="secondary-button" onClick={() => setEditing("license")}><KeyRound size={14} /> Nova licença</button><button className="primary-button" onClick={() => setEditing("equipment")}><Plus size={14} /> Novo equipamento</button></span>}
    </div>
    {error && <div className="alert error"><span>{error}</span><button onClick={() => setError("")} aria-label="Fechar aviso"><X size={16} /></button></div>}
    {list.length ? <div className="asset-list">{list.map((asset) => {
      const left = asset.expiresOn ? daysBetween(today, asset.expiresOn) : null;
      const people = asset.memberIds.map((id) => data.people.find((person) => person.id === id)).filter((person): person is Person => Boolean(person));
      return <article key={asset.id} className={`asset-row ${asset.status}`}>
        <span className="asset-icon">{asset.kind === "license" ? <KeyRound size={17} /> : <Laptop size={17} />}</span>
        <div className="asset-main"><strong>{asset.name}</strong><small>{[asset.category, asset.identifier, asset.purchaseDate ? `comprado em ${shortDate(asset.purchaseDate)}` : "", data.me.isAdmin && asset.cost !== null ? money(asset.cost) : ""].filter(Boolean).join(" · ") || (asset.kind === "license" ? "Licença" : "Equipamento")}</small></div>
        <div className="asset-people">{people.length ? <>{people.slice(0, 4).map((person) => <span key={person.id} title={person.name}><Avatar member={person} size={22} /> {people.length === 1 ? person.name : ""}</span>)}{people.length > 4 && <em>+{people.length - 4}</em>}</> : <em className="muted">Ninguém</em>}{asset.kind === "license" && <small>{asset.memberIds.length}/{asset.seats} vagas</small>}</div>
        {asset.expiresOn ? <span className={`asset-expiry ${left !== null && left < 0 ? "expired" : left !== null && left <= 30 ? "soon" : ""}`} title={asset.kind === "license" ? "Vencimento da licença" : "Fim da garantia"}>{left !== null && left < 0 ? "Venceu" : asset.kind === "license" ? "Vence" : "Garantia"} {shortDate(asset.expiresOn)}</span> : <span />}
        <em className={`asset-status ${asset.status}`}>{assetStatusLabels[asset.status]}</em>
        {data.me.isAdmin ? <span className="asset-actions"><button className="person-edit" onClick={() => setEditing(asset)} aria-label={`Editar ${asset.name}`} title="Editar"><Pencil size={13} /></button><button className="person-edit" onClick={() => void remove(asset)} aria-label={`Excluir ${asset.name}`} title="Excluir"><Trash2 size={13} /></button></span> : <span />}
      </article>;
    })}</div> : <div className="empty-state"><span><Laptop /></span><h3>{data.assets.length ? "Nada encontrado" : "Nenhum equipamento cadastrado"}</h3><p>{data.assets.length ? "Mude o filtro ou a busca." : data.me.isAdmin ? "Cadastre notebooks, monitores e licenças de software para saber com quem está cada um e receber aviso antes de vencer." : "Os administradores ainda não cadastraram os equipamentos."}</p></div>}
    {editing && <AssetModal asset={typeof editing === "string" ? null : editing} kind={typeof editing === "string" ? editing : editing.kind} people={data.people.filter((person) => person.active || (typeof editing !== "string" && editing.memberIds.includes(person.id)))} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />}
  </div>;
}

function AssetModal({ asset, kind, people, onClose, onSaved }: { asset: Asset | null; kind: "equipment" | "license"; people: Person[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: asset?.name ?? "", category: asset?.category ?? "", identifier: asset?.identifier ?? "", status: asset?.status ?? "available", seats: String(asset?.seats ?? 1), purchaseDate: asset?.purchaseDate ?? "", expiresOn: asset?.expiresOn ?? "", cost: asset?.cost !== null && asset?.cost !== undefined ? String(asset.cost).replace(".", ",") : "", notes: asset?.notes ?? "", memberIds: asset?.memberIds ?? [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const license = kind === "license";
  const toggle = (id: number) => setForm((current) => ({ ...current, memberIds: current.memberIds.includes(id) ? current.memberIds.filter((entry) => entry !== id) : [...current.memberIds, id] }));
  return <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><form className="modal asset-modal" onSubmit={async (event) => { event.preventDefault(); setSaving(true); setError(""); try { await call({ action: "saveAsset", assetId: asset?.id, kind, ...form, purchaseDate: form.purchaseDate || null, expiresOn: form.expiresOn || null }); onSaved(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível salvar."); setSaving(false); } }}>
    <div className="modal-head"><div><h2>{asset ? asset.name : license ? "Nova licença" : "Novo equipamento"}</h2><p>{license ? "Os administradores recebem aviso 30 e 7 dias antes de vencer. Não guarde chaves ou senhas aqui." : "Registre com quem está e a garantia; cada entrega e devolução fica no histórico."}</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
    <div className="form-grid">
      <label className="full"><span>Nome</span><input autoFocus required maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder={license ? "Ex.: Microsoft 365 Business" : "Ex.: Notebook Dell Latitude 5440"} /></label>
      <label><span>Tipo <em>opcional</em></span><input maxLength={60} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder={license ? "Escritório, IDE, banco de dados…" : "Notebook, monitor, headset…"} /></label>
      <label><span>{license ? "Conta ou contrato" : "Patrimônio ou nº de série"} <em>opcional</em></span><input maxLength={120} value={form.identifier} onChange={(event) => setForm({ ...form, identifier: event.target.value })} /></label>
      <label><span>Situação</span><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as AssetStatus })}>{(Object.keys(assetStatusLabels) as AssetStatus[]).map((status) => <option key={status} value={status}>{assetStatusLabels[status]}</option>)}</select></label>
      {license ? <label><span>Vagas (usuários)</span><input type="number" min={1} max={9999} value={form.seats} onChange={(event) => setForm({ ...form, seats: event.target.value })} /></label> : <label><span>Data da compra <em>opcional</em></span><input type="date" value={form.purchaseDate} onChange={(event) => setForm({ ...form, purchaseDate: event.target.value })} /></label>}
      <label><span>{license ? "Vence em" : "Garantia até"} <em>opcional</em></span><input type="date" value={form.expiresOn} onChange={(event) => setForm({ ...form, expiresOn: event.target.value })} /></label>
      <label><span>{license ? "Valor (por ano)" : "Valor"} <em>só administradores veem</em></span><input inputMode="decimal" value={form.cost} onChange={(event) => setForm({ ...form, cost: event.target.value })} placeholder="0,00" /></label>
      <fieldset className="full asset-people-picker"><legend>{license ? `Quem usa (${form.memberIds.length}/${form.seats || 1})` : "Com quem está"}</legend>
        {license ? people.map((person) => <label key={person.id} className={form.memberIds.includes(person.id) ? "on" : ""}><input type="checkbox" checked={form.memberIds.includes(person.id)} onChange={() => toggle(person.id)} /> <Avatar member={person} size={18} /> {person.name}</label>)
          : <select value={form.memberIds[0] ?? ""} onChange={(event) => setForm({ ...form, memberIds: event.target.value ? [Number(event.target.value)] : [] })} aria-label="Com quem está"><option value="">Ninguém (guardado)</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>}
      </fieldset>
      <label className="full"><span>Observações <em>opcional, só administradores veem</em></span><textarea rows={2} maxLength={2000} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Configuração, acessórios, onde está guardado…" /></label>
    </div>
    {asset && asset.events.length > 0 && <div className="asset-history"><small>Histórico</small><ul>{asset.events.map((event) => <li key={event.id}><span>{event.text}</span><em>{event.byName.split(" ")[0]} · {relativeTime(event.at)}</em></li>)}</ul></div>}
    {error && <p className="modal-error">{error}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={saving || !form.name.trim()}>{saving ? "Salvando..." : "Salvar"}</button></div>
  </form></div>;
}
