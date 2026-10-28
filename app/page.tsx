"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArrowDownToLine,
  Box,
  Coffee,
  History,
  Menu,
  PackageCheck,
  PackageOpen,
  Pencil,
  Plus,
  Search,
  Settings2,
  ShoppingCart,
  Sparkles,
  TrendingDown,
  TriangleAlert,
  X,
} from "lucide-react";

type Item = {
  id: number;
  name: string;
  category: string;
  unit: string;
  unopenedQty: number;
  openedQty: number;
  minimumQty: number;
  lastOpenedAt: string | null;
};

type Movement = {
  id: number;
  itemId: number;
  itemName: string;
  unit: string;
  type: "purchase" | "open" | "consume" | "adjust";
  quantity: number;
  note: string;
  createdAt: string;
};

type ModalState =
  | { kind: "item"; item?: Item }
  | { kind: "movement"; type: Movement["type"]; item?: Item }
  | null;

const movementCopy = {
  purchase: { label: "Compra", icon: ShoppingCart, tone: "green" },
  open: { label: "Abertura", icon: PackageOpen, tone: "amber" },
  consume: { label: "Consumo", icon: TrendingDown, tone: "red" },
  adjust: { label: "Ajuste", icon: Settings2, tone: "blue" },
} as const;

function fmt(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
}

function relativeDate(value: string | null) {
  if (!value) return "Nunca aberto";
  const date = new Date(value);
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (days <= 0) return "Aberto hoje";
  if (days === 1) return "Aberto ontem";
  return `Aberto há ${days} dias`;
}

function exactDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export default function Home() {
  const [items, setItems] = useState<Item[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "low" | "open">("all");
  const [tab, setTab] = useState<"stock" | "history">("stock");
  const [modal, setModal] = useState<ModalState>(null);
  const [mobileMenu, setMobileMenu] = useState(false);

  async function load() {
    try {
      setError("");
      const response = await fetch("/api/inventory", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível carregar o estoque.");
      setItems(data.items);
      setMovements(data.movements);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar dados.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const lowItems = items.filter((item) => item.unopenedQty + item.openedQty <= item.minimumQty);
  const openItems = items.filter((item) => item.openedQty > 0);
  const totalUnits = items.reduce((sum, item) => sum + item.unopenedQty + item.openedQty, 0);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("pt-BR");
    return items.filter((item) => {
      const matchesSearch = !query || `${item.name} ${item.category}`.toLocaleLowerCase("pt-BR").includes(query);
      const matchesFilter = filter === "all" || (filter === "low" && item.unopenedQty + item.openedQty <= item.minimumQty) || (filter === "open" && item.openedQty > 0);
      return matchesSearch && matchesFilter;
    });
  }, [items, search, filter]);

  async function submit(payload: Record<string, unknown>, success: string) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
      await load();
      setModal(null);
      setNotice(success);
      window.setTimeout(() => setNotice(""), 3200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function seed() {
    await submit({ action: "seed" }, "Itens iniciais adicionados.");
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenu ? "open" : ""}`}>
        <div className="brand"><span className="brand-mark"><Coffee size={21} /></span><div><strong>Estoque</strong><small>Copa da empresa</small></div></div>
        <button className="close-menu" onClick={() => setMobileMenu(false)} aria-label="Fechar menu"><X /></button>
        <nav>
          <button className={tab === "stock" ? "active" : ""} onClick={() => { setTab("stock"); setMobileMenu(false); }}><Archive /> Visão geral</button>
          <button className={tab === "history" ? "active" : ""} onClick={() => { setTab("history"); setMobileMenu(false); }}><History /> Histórico</button>
        </nav>
        <div className="sidebar-tip">
          <span><Sparkles size={16} /> Dica</span>
          <p>Registre a abertura antes de lançar o consumo. Assim você sempre saberá o que está em uso.</p>
        </div>
        <div className="sidebar-footer"><span className="avatar">FC</span><div><strong>Controle interno</strong><small>Dados compartilhados</small></div></div>
      </aside>

      <main>
        <header className="topbar">
          <button className="menu-button" onClick={() => setMobileMenu(true)} aria-label="Abrir menu"><Menu /></button>
          <div><p className="eyebrow">CONTROLE DA COPA</p><h1>{tab === "stock" ? "Visão geral do estoque" : "Histórico de movimentações"}</h1></div>
          <button className="primary-button" onClick={() => setModal({ kind: "item" })}><Plus size={18} /> Novo item</button>
        </header>

        <section className="content">
          {error && <div className="alert error"><TriangleAlert size={18} /><span>{error}</span><button onClick={() => setError("")}><X size={16} /></button></div>}
          {notice && <div className="toast"><PackageCheck size={18} />{notice}</div>}

          {tab === "stock" ? (
            <>
              <div className="stats-grid">
                <article className="stat-card"><span className="stat-icon blue"><Box /></span><div><small>Itens cadastrados</small><strong>{items.length}</strong><p>{fmt(totalUnits)} unidades no total</p></div></article>
                <article className="stat-card"><span className="stat-icon amber"><PackageOpen /></span><div><small>Em uso agora</small><strong>{openItems.length}</strong><p>{openItems.length ? "Com embalagem aberta" : "Nada aberto"}</p></div></article>
                <article className={`stat-card ${lowItems.length ? "attention" : ""}`}><span className="stat-icon red"><TriangleAlert /></span><div><small>Precisam de reposição</small><strong>{lowItems.length}</strong><p>{lowItems.length ? "No estoque mínimo ou abaixo" : "Estoque saudável"}</p></div></article>
              </div>

              <div className="section-heading"><div><h2>Itens do estoque</h2><p>Acompanhe o que está fechado, aberto e próximo de acabar.</p></div><button className="secondary-button" onClick={() => setModal({ kind: "movement", type: "purchase" })}><ArrowDownToLine size={17} /> Registrar compra</button></div>

              <div className="toolbar">
                <label className="search"><Search size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar item ou categoria..." /></label>
                <div className="filters">
                  <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>Todos</button>
                  <button className={filter === "open" ? "active" : ""} onClick={() => setFilter("open")}>Abertos</button>
                  <button className={filter === "low" ? "active" : ""} onClick={() => setFilter("low")}>Baixo estoque {lowItems.length > 0 && <b>{lowItems.length}</b>}</button>
                </div>
              </div>

              {loading ? <LoadingRows /> : items.length === 0 ? (
                <div className="empty-state"><span><Coffee /></span><h3>Seu estoque começa aqui</h3><p>Adicione seus próprios itens ou carregue uma lista inicial com café, açúcar, biscoito, leite e chá.</p><div><button className="primary-button" onClick={() => setModal({ kind: "item" })}><Plus size={17} /> Adicionar item</button><button className="secondary-button" onClick={seed} disabled={saving}><Sparkles size={17} /> Usar lista inicial</button></div></div>
              ) : filtered.length === 0 ? (
                <div className="empty-state compact"><Search /><h3>Nenhum item encontrado</h3><p>Tente outro nome ou remova o filtro selecionado.</p></div>
              ) : (
                <div className="stock-list">
                  <div className="list-head"><span>Item</span><span>Saldo atual</span><span>Situação</span><span>Última abertura</span><span>Ações</span></div>
                  {filtered.map((item) => <StockRow key={item.id} item={item} onAction={(type) => setModal({ kind: "movement", type, item })} onEdit={() => setModal({ kind: "item", item })} />)}
                </div>
              )}
            </>
          ) : <HistoryView movements={movements} loading={loading} />}
        </section>
      </main>

      {mobileMenu && <button className="backdrop menu-backdrop" onClick={() => setMobileMenu(false)} aria-label="Fechar menu" />}
      {modal && <Modal state={modal} items={items} saving={saving} onClose={() => { setModal(null); setError(""); }} onSubmit={submit} />}
    </div>
  );
}

function StockRow({ item, onAction, onEdit }: { item: Item; onAction: (type: Movement["type"]) => void; onEdit: () => void }) {
  const total = item.unopenedQty + item.openedQty;
  const isLow = total <= item.minimumQty;
  const initial = item.name.slice(0, 2).toUpperCase();
  return (
    <article className="stock-row">
      <div className="item-cell"><span className="item-avatar">{initial}</span><div><strong>{item.name}</strong><small>{item.category} · mínimo {fmt(item.minimumQty)} {item.unit}</small></div></div>
      <div className="balance-cell"><strong>{fmt(total)} <small>{item.unit}</small></strong><div><span>{fmt(item.unopenedQty)} fechado</span><i /> <span>{fmt(item.openedQty)} aberto</span></div></div>
      <div><span className={`status ${isLow ? "low" : "ok"}`}>{isLow ? <TriangleAlert size={14} /> : <PackageCheck size={14} />}{isLow ? "Repor" : "Em dia"}</span></div>
      <div className="opened-cell"><strong>{relativeDate(item.lastOpenedAt)}</strong>{item.lastOpenedAt && <small>{new Intl.DateTimeFormat("pt-BR").format(new Date(item.lastOpenedAt))}</small>}</div>
      <div className="row-actions">
        <button title="Registrar abertura" disabled={item.unopenedQty <= 0} onClick={() => onAction("open")}><PackageOpen size={17} /></button>
        <button title="Registrar consumo" disabled={item.openedQty <= 0} onClick={() => onAction("consume")}><TrendingDown size={17} /></button>
        <button title="Registrar compra" onClick={() => onAction("purchase")}><ShoppingCart size={17} /></button>
        <button title="Ajustar saldo" onClick={() => onAction("adjust")}><Settings2 size={17} /></button>
        <button title="Editar item" onClick={onEdit}><Pencil size={16} /></button>
      </div>
    </article>
  );
}

function HistoryView({ movements, loading }: { movements: Movement[]; loading: boolean }) {
  if (loading) return <LoadingRows />;
  return (
    <>
      <div className="section-heading history-title"><div><h2>Atividade recente</h2><p>Compras, aberturas, consumos e ajustes registrados no sistema.</p></div></div>
      {movements.length === 0 ? <div className="empty-state"><span><History /></span><h3>Nenhuma movimentação ainda</h3><p>Quando você registrar uma compra, abertura ou consumo, o evento aparecerá aqui.</p></div> : (
        <div className="history-list">
          {movements.map((movement) => {
            const copy = movementCopy[movement.type];
            const Icon = copy.icon;
            const sign = movement.type === "consume" ? "−" : movement.type === "purchase" ? "+" : "";
            return <article key={movement.id}><span className={`history-icon ${copy.tone}`}><Icon /></span><div><strong>{copy.label} de {movement.itemName}</strong><p>{movement.note || (movement.type === "open" ? "Embalagem colocada em uso" : "Sem observações")}</p></div><div className="history-meta"><strong>{sign}{fmt(Math.abs(movement.quantity))} {movement.unit}</strong><small>{exactDate(movement.createdAt)}</small></div></article>;
          })}
        </div>
      )}
    </>
  );
}

function Modal({ state, items, saving, onClose, onSubmit }: { state: NonNullable<ModalState>; items: Item[]; saving: boolean; onClose: () => void; onSubmit: (payload: Record<string, unknown>, success: string) => Promise<void> }) {
  const editing = state.kind === "item" ? state.item : undefined;
  const preselected = state.kind === "movement" ? state.item : undefined;
  const [itemId, setItemId] = useState(String(preselected?.id ?? items[0]?.id ?? ""));
  const [name, setName] = useState(editing?.name ?? "");
  const [category, setCategory] = useState(editing?.category ?? "Bebidas");
  const [unit, setUnit] = useState(editing?.unit ?? "pacote");
  const [minimumQty, setMinimumQty] = useState(String(editing?.minimumQty ?? 2));
  const [quantity, setQuantity] = useState("1");
  const selected = items.find((item) => item.id === Number(itemId));
  const [unopenedQty, setUnopenedQty] = useState(String(preselected?.unopenedQty ?? selected?.unopenedQty ?? 0));
  const [openedQty, setOpenedQty] = useState(String(preselected?.openedQty ?? selected?.openedQty ?? 0));
  const [note, setNote] = useState("");

  const title = state.kind === "item" ? (editing ? "Editar item" : "Novo item") : movementCopy[state.type].label;
  const description = state.kind === "item" ? "Defina como este produto será acompanhado." : {
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

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (state.kind === "item") {
      onSubmit({ action: editing ? "updateItem" : "addItem", itemId: editing?.id, name, category, unit, minimumQty: Number(minimumQty) }, editing ? "Item atualizado." : "Novo item cadastrado.");
      return;
    }
    const payload: Record<string, unknown> = { action: "movement", type: state.type, itemId: Number(itemId), quantity: Number(quantity), note };
    if (state.type === "adjust") { payload.unopenedQty = Number(unopenedQty); payload.openedQty = Number(openedQty); }
    onSubmit(payload, `${movementCopy[state.type].label} registrada.`);
  }

  return (
    <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><form className="modal" onSubmit={handleSubmit}>
      <div className="modal-head"><div><p className="eyebrow">MOVIMENTAÇÃO DO ESTOQUE</p><h2>{title}</h2><p>{description}</p></div><button type="button" onClick={onClose}><X /></button></div>
      <div className="form-grid">
        {state.kind === "item" ? <>
          <label className="full"><span>Nome do item</span><input autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Café em pó" /></label>
          <label><span>Categoria</span><select value={category} onChange={(e) => setCategory(e.target.value)}><option>Bebidas</option><option>Lanches</option><option>Mercearia</option><option>Descartáveis</option><option>Limpeza</option><option>Outros</option></select></label>
          <label><span>Unidade de controle</span><select value={unit} onChange={(e) => setUnit(e.target.value)}><option>pacote</option><option>caixa</option><option>unidade</option><option>garrafa</option><option>kg</option><option>litro</option></select></label>
          <label className="full"><span>Estoque mínimo</span><input required min="0" step="0.01" type="number" value={minimumQty} onChange={(e) => setMinimumQty(e.target.value)} /><small>O sistema avisará quando o saldo total chegar a este número.</small></label>
        </> : <>
          <label className="full"><span>Item</span><select required value={itemId} onChange={(e) => changeSelected(e.target.value)} disabled={Boolean(preselected)}>{items.map((item) => <option key={item.id} value={item.id}>{item.name} — {fmt(item.unopenedQty + item.openedQty)} {item.unit}</option>)}</select></label>
          {state.type === "adjust" ? <>
            <label><span>Quantidade fechada</span><input min="0" step="0.01" type="number" required value={unopenedQty} onChange={(e) => setUnopenedQty(e.target.value)} /></label>
            <label><span>Quantidade aberta</span><input min="0" step="0.01" type="number" required value={openedQty} onChange={(e) => setOpenedQty(e.target.value)} /></label>
          </> : <label className="full"><span>Quantidade ({selected?.unit ?? "un."})</span><input autoFocus min="0.01" step="0.01" type="number" required value={quantity} onChange={(e) => setQuantity(e.target.value)} /><small>{selected && state.type === "open" ? `Disponível fechado: ${fmt(selected.unopenedQty)} ${selected.unit}` : selected && state.type === "consume" ? `Disponível aberto: ${fmt(selected.openedQty)} ${selected.unit}` : "Use números decimais quando necessário."}</small></label>}
          <label className="full"><span>Observação <em>opcional</em></span><textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: compra mensal, contagem feita pela manhã..." /></label>
        </>}
      </div>
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={saving || (state.kind === "movement" && !itemId)}>{saving ? "Salvando..." : "Confirmar"}</button></div>
    </form></div>
  );
}

function LoadingRows() {
  return <div className="loading-list">{[1, 2, 3, 4].map((line) => <span key={line} />)}</div>;
}
