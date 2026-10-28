"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArrowDownToLine,
  BarChart3,
  Box,
  CalendarClock,
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
  Trash2,
  TrendingDown,
  TriangleAlert,
  UserPlus,
  Users,
  X,
} from "lucide-react";

type MemberRole = "admin" | "member" | "viewer";

type Member = {
  id: number;
  userId: string;
  name: string;
  email: string;
  role: MemberRole;
  active: boolean;
  createdAt: string;
};

type CurrentUser = Pick<Member, "userId" | "name" | "email" | "role">;

type Item = {
  id: number;
  name: string;
  category: string;
  unit: string;
  unopenedQty: number;
  openedQty: number;
  minimumQty: number;
  lastOpenedAt: string | null;
  analytics: {
    averageDurationDays: number | null;
    lastDurationDays: number | null;
    completedCycles: number;
    activeDays: number | null;
    monthlyRecommendation: number | null;
    estimatedCoverageDays: number | null;
  };
};

type Movement = {
  id: number;
  itemId: number;
  itemName: string;
  unit: string;
  type: "purchase" | "open" | "consume" | "adjust";
  quantity: number;
  note: string;
  createdByName: string | null;
  createdAt: string;
};

type ModalState =
  | { kind: "item"; item?: Item }
  | { kind: "member" }
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

function roleLabel(role: MemberRole) {
  return role === "admin" ? "Administrador" : role === "member" ? "Membro" : "Somente leitura";
}

export default function Home() {
  const [items, setItems] = useState<Item[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "low" | "open">("all");
  const [tab, setTab] = useState<"stock" | "planning" | "history" | "team">("stock");
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
      setCurrentUser(data.currentUser);
      setMembers(data.members || []);
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
  const measuredItems = items.filter((item) => item.analytics.averageDurationDays !== null);
  const canWrite = Boolean(currentUser && currentUser.role !== "viewer");
  const isAdmin = currentUser?.role === "admin";
  const todayLabel = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long" }).format(new Date());
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

  async function deleteItem(item: Item) {
    if (!window.confirm(`Excluir ${item.name}? O histórico e as medições deste item também serão removidos.`)) return;
    await submit({ action: "deleteItem", itemId: item.id }, "Item excluído.");
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenu ? "open" : ""}`}>
        <div className="brand"><span className="brand-mark"><Coffee size={21} /></span><div><strong>Estoque</strong><small>Copa da empresa</small></div></div>
        <button className="close-menu" onClick={() => setMobileMenu(false)} aria-label="Fechar menu"><X /></button>
        <nav>
          <button className={tab === "stock" ? "active" : ""} onClick={() => { setTab("stock"); setMobileMenu(false); }}><Archive /> Visão geral</button>
          <button className={tab === "planning" ? "active" : ""} onClick={() => { setTab("planning"); setMobileMenu(false); }}><BarChart3 /> Planejamento</button>
          <button className={tab === "history" ? "active" : ""} onClick={() => { setTab("history"); setMobileMenu(false); }}><History /> Histórico</button>
          {isAdmin && <button className={tab === "team" ? "active" : ""} onClick={() => { setTab("team"); setMobileMenu(false); }}><Users /> Equipe</button>}
        </nav>
        <div className="sidebar-tip">
          <span><Sparkles size={16} /> Dica</span>
          <p>Registre a abertura antes de lançar o consumo. Assim você sempre saberá o que está em uso.</p>
        </div>
        <div className="sidebar-footer"><span className="avatar">{currentUser?.name?.slice(0,2).toUpperCase() || "EQ"}</span><div><strong>{currentUser?.name || "Equipe"}</strong><small>{currentUser ? roleLabel(currentUser.role) : "Carregando acesso"}</small></div></div>
      </aside>

      <main>
        <header className="topbar">
          <button className="menu-button" onClick={() => setMobileMenu(true)} aria-label="Abrir menu"><Menu /></button>
          <div><p className="eyebrow">CONTROLE DA COPA</p><h1>{tab === "stock" ? "Visão geral do estoque" : tab === "planning" ? "Planejamento de compras" : tab === "team" ? "Usuários e permissões" : "Histórico de movimentações"}</h1></div>
          {isAdmin ? <button className="primary-button" onClick={() => setModal(tab === "team" ? { kind: "member" } : { kind: "item" })}>{tab === "team" ? <><UserPlus size={18} /> Adicionar membro</> : <><Plus size={18} /> Novo item</>}</button> : <span className="role-chip">{currentUser ? roleLabel(currentUser.role) : "Carregando"}</span>}
        </header>

        <section className="content">
          {error && <div className="alert error"><TriangleAlert size={18} /><span>{error}</span><button onClick={() => setError("")}><X size={16} /></button></div>}
          {notice && <div className="toast"><PackageCheck size={18} />{notice}</div>}

          {tab === "stock" ? (
            <>
              <section className="overview-hero">
                <div className="hero-copy">
                  <p className="hero-date">{todayLabel}</p>
                  <h2>{lowItems.length ? `${lowItems.length} ${lowItems.length === 1 ? "item precisa" : "itens precisam"} de atenção` : "Tudo em ordem por aqui"}</h2>
                  <p>{lowItems.length ? "Revise a sugestão de compra e mantenha a copa abastecida para a equipe." : "O estoque está acima dos mínimos definidos. Continue registrando o consumo para melhorar as previsões."}</p>
                  <div className="quick-actions">
                    <button disabled={!canWrite} onClick={() => setModal({ kind: "movement", type: "purchase" })}><ShoppingCart /> Registrar compra</button>
                    <button disabled={!canWrite} onClick={() => setModal({ kind: "movement", type: "open" })}><PackageOpen /> Abrir item</button>
                    <button disabled={!canWrite} onClick={() => setModal({ kind: "movement", type: "consume" })}><TrendingDown /> Lançar consumo</button>
                    <button disabled={!isAdmin} onClick={() => setModal({ kind: "movement", type: "adjust" })}><Settings2 /> Conferir saldo</button>
                  </div>
                </div>
                <div className="hero-status">
                  <span className={lowItems.length ? "needs-attention" : "healthy"}>{lowItems.length ? <TriangleAlert /> : <PackageCheck />}</span>
                  <small>Situação atual</small>
                  <strong>{lowItems.length ? "Atenção" : "Em dia"}</strong>
                  <p>{items.length ? `${items.length - lowItems.length} de ${items.length} itens dentro do mínimo` : "Cadastre o primeiro item"}</p>
                </div>
              </section>

              <div className="stats-grid">
                <article className="stat-card"><span className="stat-icon blue"><Box /></span><div><small>Itens cadastrados</small><strong>{items.length}</strong><p>{fmt(totalUnits)} unidades no total</p></div></article>
                <article className="stat-card"><span className="stat-icon amber"><PackageOpen /></span><div><small>Em uso agora</small><strong>{openItems.length}</strong><p>{openItems.length ? "Com embalagem aberta" : "Nada aberto"}</p></div></article>
                <article className={`stat-card ${lowItems.length ? "attention" : ""}`}><span className="stat-icon red"><TriangleAlert /></span><div><small>Precisam de reposição</small><strong>{lowItems.length}</strong><p>{lowItems.length ? "No estoque mínimo ou abaixo" : "Tudo dentro do mínimo"}</p></div></article>
                <article className="stat-card"><span className="stat-icon green"><CalendarClock /></span><div><small>Previsões confiáveis</small><strong>{measuredItems.length}</strong><p>{measuredItems.length ? "Com ciclo de consumo completo" : "Ainda coletando histórico"}</p></div></article>
              </div>

              <div className="overview-insights">
                <article className="insight-card attention-card">
                  <div className="insight-head"><div><span className="insight-icon"><ShoppingCart /></span><div><h3>Lista de reposição</h3><p>Prioridades calculadas pelo estoque mínimo.</p></div></div><button onClick={() => { setFilter("low"); document.querySelector(".section-heading")?.scrollIntoView({ behavior: "smooth" }); }}>Ver no estoque</button></div>
                  {lowItems.length ? <div className="restock-list">{lowItems.slice(0,4).map((item) => {
                    const total = item.unopenedQty + item.openedQty;
                    const suggested = Math.max(1, Math.ceil((item.analytics.monthlyRecommendation ?? item.minimumQty + 1) - total));
                    return <div key={item.id}><span className="item-avatar">{item.name.slice(0,2).toUpperCase()}</span><div><strong>{item.name}</strong><small>{fmt(total)} {item.unit} disponíveis</small></div><b>Comprar {suggested}</b></div>;
                  })}</div> : <div className="insight-empty"><PackageCheck /><div><strong>Nada para comprar agora</strong><p>Todos os itens estão acima do mínimo.</p></div></div>}
                </article>
                <article className="insight-card activity-card">
                  <div className="insight-head"><div><span className="insight-icon"><History /></span><div><h3>Atividade recente</h3><p>Últimos registros feitos pela equipe.</p></div></div><button onClick={() => setTab("history")}>Ver histórico</button></div>
                  {movements.length ? <div className="mini-activity">{movements.slice(0,4).map((movement) => {
                    const copy = movementCopy[movement.type]; const Icon = copy.icon;
                    return <div key={movement.id}><span className={`history-icon ${copy.tone}`}><Icon /></span><div><strong>{copy.label} · {movement.itemName}</strong><small>{movement.createdByName || "Equipe"} · {exactDate(movement.createdAt)}</small></div><b>{movement.type === "consume" ? "−" : movement.type === "purchase" ? "+" : ""}{fmt(Math.abs(movement.quantity))}</b></div>;
                  })}</div> : <div className="insight-empty"><History /><div><strong>Nenhuma atividade ainda</strong><p>Os lançamentos da equipe aparecerão aqui.</p></div></div>}
                </article>
              </div>

              <div className="section-heading"><div><h2>Itens do estoque</h2><p>Acompanhe o que está fechado, aberto e próximo de acabar.</p></div><button className="secondary-button" disabled={!canWrite} onClick={() => setModal({ kind: "movement", type: "purchase" })}><ArrowDownToLine size={17} /> Registrar compra</button></div>

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
                  <div className="list-head"><span>Item</span><span>Saldo atual</span><span>Situação</span><span>Duração média</span><span>Última abertura</span><span>Ações</span></div>
                  {filtered.map((item) => <StockRow key={item.id} item={item} role={currentUser?.role ?? "viewer"} onAction={(type) => setModal({ kind: "movement", type, item })} onEdit={() => setModal({ kind: "item", item })} onDelete={() => deleteItem(item)} />)}
                </div>
              )}
            </>
          ) : tab === "planning" ? <PlanningView items={items} loading={loading} /> : tab === "team" ? <TeamView members={members} currentUser={currentUser} saving={saving} onAddMember={() => setModal({ kind: "member" })} onUpdateRole={(userId, role) => submit({ action: "updateMemberRole", userId, role }, "Permissão atualizada.")} onUpdateActive={(userId, active) => submit({ action: "updateMemberActive", userId, active }, active ? "Acesso reativado." : "Acesso desativado.")} /> : <HistoryView movements={movements} loading={loading} />}
        </section>
      </main>

      {mobileMenu && <button className="backdrop menu-backdrop" onClick={() => setMobileMenu(false)} aria-label="Fechar menu" />}
      {modal && <Modal state={modal} items={items} saving={saving} onClose={() => { setModal(null); setError(""); }} onSubmit={submit} />}
    </div>
  );
}

function StockRow({ item, role, onAction, onEdit, onDelete }: { item: Item; role: MemberRole; onAction: (type: Movement["type"]) => void; onEdit: () => void; onDelete: () => void }) {
  const total = item.unopenedQty + item.openedQty;
  const isLow = total <= item.minimumQty;
  const initial = item.name.slice(0, 2).toUpperCase();
  return (
    <article className="stock-row">
      <div className="item-cell"><span className="item-avatar">{initial}</span><div><strong>{item.name}</strong><small>{item.category} · mínimo {fmt(item.minimumQty)} {item.unit}</small></div></div>
      <div className="balance-cell"><strong>{fmt(total)} <small>{item.unit}</small></strong><div><span>{fmt(item.unopenedQty)} fechado</span><i /> <span>{fmt(item.openedQty)} aberto</span></div></div>
      <div><span className={`status ${isLow ? "low" : "ok"}`}>{isLow ? <TriangleAlert size={14} /> : <PackageCheck size={14} />}{isLow ? "Repor" : "Em dia"}</span></div>
      <div className="duration-cell">{item.analytics.averageDurationDays !== null ? <><strong>{fmt(item.analytics.averageDurationDays)} dias</strong><small>{item.analytics.monthlyRecommendation} {item.unit}/30 dias</small></> : item.analytics.activeDays !== null ? <><strong>Em medição</strong><small>Há {fmt(item.analytics.activeDays)} dias</small></> : <><strong>Sem histórico</strong><small>Registre abertura e consumo</small></>}</div>
      <div className="opened-cell"><strong>{relativeDate(item.lastOpenedAt)}</strong>{item.lastOpenedAt && <small>{new Intl.DateTimeFormat("pt-BR").format(new Date(item.lastOpenedAt))}</small>}</div>
      <div className="row-actions">
        <button title="Registrar abertura" disabled={role === "viewer" || item.unopenedQty <= 0} onClick={() => onAction("open")}><PackageOpen size={17} /></button>
        <button title="Registrar consumo" disabled={role === "viewer" || item.openedQty <= 0} onClick={() => onAction("consume")}><TrendingDown size={17} /></button>
        <button title="Registrar compra" disabled={role === "viewer"} onClick={() => onAction("purchase")}><ShoppingCart size={17} /></button>
        <button title="Ajustar saldo" disabled={role !== "admin"} onClick={() => onAction("adjust")}><Settings2 size={17} /></button>
        <button title="Editar item" disabled={role !== "admin"} onClick={onEdit}><Pencil size={16} /></button>
        <button className="danger-action" title="Excluir item" aria-label={`Excluir ${item.name}`} disabled={role !== "admin"} onClick={onDelete}><Trash2 size={16} /></button>
      </div>
    </article>
  );
}

function PlanningView({ items, loading }: { items: Item[]; loading: boolean }) {
  if (loading) return <LoadingRows />;
  const measured = items.filter((item) => item.analytics.averageDurationDays !== null);
  const monthlyTotal = measured.reduce((sum, item) => sum + (item.analytics.monthlyRecommendation ?? 0), 0);
  return (
    <>
      <div className="planning-summary">
        <article><span className="stat-icon blue"><CalendarClock /></span><div><small>Itens com média calculada</small><strong>{measured.length} de {items.length}</strong><p>Após um ciclo completo de uso</p></div></article>
        <article><span className="stat-icon amber"><ShoppingCart /></span><div><small>Compra estimada por mês</small><strong>{monthlyTotal}</strong><p>Soma dos itens já medidos</p></div></article>
      </div>
      <div className="section-heading planning-title"><div><h2>Duração e previsão por item</h2><p>A média usa os últimos oito ciclos completos e melhora conforme a equipe registra o consumo.</p></div></div>
      {items.length === 0 ? <div className="empty-state"><span><BarChart3 /></span><h3>Ainda não há itens para analisar</h3><p>Cadastre os produtos e registre as aberturas e consumos para gerar as previsões.</p></div> : (
        <div className="planning-grid">
          {items.map((item) => {
            const analytics = item.analytics;
            const measuredItem = analytics.averageDurationDays !== null;
            return <article key={item.id} className="planning-card">
              <div className="planning-card-head"><span className="item-avatar">{item.name.slice(0,2).toUpperCase()}</span><div><strong>{item.name}</strong><small>{item.category} · {item.unit}</small></div><span className={`measure-badge ${measuredItem ? "ready" : "waiting"}`}>{measuredItem ? "Calculado" : "Em medição"}</span></div>
              <div className="planning-metrics">
                <div><small>Duração média</small><strong>{measuredItem ? `${fmt(analytics.averageDurationDays!)} dias` : analytics.activeDays !== null ? `${fmt(analytics.activeDays)} dias em uso` : "—"}</strong></div>
                <div><small>Sugestão para 30 dias</small><strong>{analytics.monthlyRecommendation ? `${analytics.monthlyRecommendation} ${item.unit}` : "Aguardando dados"}</strong></div>
                <div><small>Cobertura do saldo atual</small><strong>{analytics.estimatedCoverageDays !== null ? `cerca de ${fmt(analytics.estimatedCoverageDays)} dias` : "Aguardando dados"}</strong></div>
                <div><small>Ciclos usados no cálculo</small><strong>{analytics.completedCycles || "Nenhum ainda"}</strong></div>
              </div>
              <p className="planning-note">{measuredItem ? `A última unidade durou ${fmt(analytics.lastDurationDays!)} dias. A recomendação considera o ritmo médio de consumo da equipe.` : analytics.activeDays !== null ? "Este item já está sendo medido. A previsão aparece quando o saldo aberto chegar a zero." : "Abra uma unidade e registre o consumo até zerar para iniciar a medição."}</p>
            </article>;
          })}
        </div>
      )}
    </>
  );
}

function TeamView({ members, currentUser, saving, onAddMember, onUpdateRole, onUpdateActive }: { members: Member[]; currentUser: CurrentUser | null; saving: boolean; onAddMember: () => void; onUpdateRole: (userId: string, role: MemberRole) => void; onUpdateActive: (userId: string, active: boolean) => void }) {
  return (
    <>
      <div className="team-intro">
        <span className="team-intro-icon"><Users /></span>
        <div><p className="eyebrow">ACESSO INDIVIDUAL</p><h2>Equipe e permissões</h2><p>Cada pessoa entra com sua própria conta. Os lançamentos ficam associados ao usuário e as permissões são verificadas pelo servidor.</p></div>
      </div>
      <div className="permission-cards">
        <article><strong>Administrador</strong><p>Gerencia itens, confere saldos, altera permissões e registra movimentações.</p></article>
        <article><strong>Membro</strong><p>Registra compras, aberturas e consumos, sem alterar cadastros ou permissões.</p></article>
        <article><strong>Somente leitura</strong><p>Consulta estoque, planejamento e histórico, sem fazer lançamentos.</p></article>
      </div>
      <div className="team-panel">
        <div className="section-heading team-heading"><div><h2>Usuários cadastrados</h2><p>Cadastre a equipe por e-mail e defina o que cada pessoa poderá fazer.</p></div><div className="team-heading-actions"><span>{members.length} {members.length === 1 ? "usuário" : "usuários"}</span><button className="secondary-button" onClick={onAddMember}><UserPlus size={16} /> Adicionar membro</button></div></div>
        <div className="team-table">
          <div className="team-table-head"><span>Usuário</span><span>Permissão</span><span>Status</span><span>Entrada</span></div>
          {members.map((member) => <div className="team-row" key={member.userId}>
            <div className="member-cell"><span className="avatar member-avatar">{member.name.slice(0,2).toUpperCase()}</span><div><strong>{member.name}</strong><small>{member.email}{member.userId === currentUser?.userId ? " · você" : ""}</small></div></div>
            <select aria-label={`Permissão de ${member.name}`} disabled={saving || member.userId === currentUser?.userId} value={member.role} onChange={(event) => onUpdateRole(member.userId, event.target.value as MemberRole)}><option value="admin">Administrador</option><option value="member">Membro</option><option value="viewer">Somente leitura</option></select>
            <button className={`access-toggle ${member.active ? "active" : "inactive"}`} disabled={saving || member.userId === currentUser?.userId} onClick={() => onUpdateActive(member.userId, !member.active)}>{member.active ? "Ativo" : "Desativado"}</button>
            <span className="member-date">{new Intl.DateTimeFormat("pt-BR").format(new Date(member.createdAt))}</span>
          </div>)}
        </div>
        <p className="team-access-note">O cadastro define as permissões dentro do sistema. A pessoa também precisa estar autorizada a abrir este Site privado.</p>
      </div>
    </>
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
            return <article key={movement.id}><span className={`history-icon ${copy.tone}`}><Icon /></span><div><strong>{copy.label} de {movement.itemName}</strong><p>{movement.note || (movement.type === "open" ? "Embalagem colocada em uso" : "Sem observações")} · por {movement.createdByName || "Equipe"}</p></div><div className="history-meta"><strong>{sign}{fmt(Math.abs(movement.quantity))} {movement.unit}</strong><small>{exactDate(movement.createdAt)}</small></div></article>;
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
  const [memberName, setMemberName] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<MemberRole>("member");

  const title = state.kind === "member" ? "Adicionar membro" : state.kind === "item" ? (editing ? "Editar item" : "Novo item") : movementCopy[state.type].label;
  const description = state.kind === "member" ? "Cadastre a pessoa e escolha a permissão inicial. O acesso será reconhecido pelo e-mail informado." : state.kind === "item" ? "Defina como este produto será acompanhado." : {
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
    if (state.kind === "member") {
      onSubmit({ action: "addMember", name: memberName, email: memberEmail, role: memberRole }, "Membro adicionado.");
      return;
    }
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
      <div className="modal-head"><div><p className="eyebrow">{state.kind === "member" ? "GESTÃO DE ACESSO" : "MOVIMENTAÇÃO DO ESTOQUE"}</p><h2>{title}</h2><p>{description}</p></div><button type="button" onClick={onClose}><X /></button></div>
      <div className="form-grid">
        {state.kind === "member" ? <>
          <label className="full"><span>Nome</span><input autoFocus required value={memberName} onChange={(e) => setMemberName(e.target.value)} placeholder="Ex.: Ana Souza" /></label>
          <label className="full"><span>E-mail da conta</span><input required type="email" value={memberEmail} onChange={(e) => setMemberEmail(e.target.value)} placeholder="ana@empresa.com" /><small>Use o mesmo e-mail que a pessoa utiliza para acessar o Site.</small></label>
          <label className="full"><span>Permissão inicial</span><select value={memberRole} onChange={(e) => setMemberRole(e.target.value as MemberRole)}><option value="admin">Administrador</option><option value="member">Membro</option><option value="viewer">Somente leitura</option></select></label>
        </> : state.kind === "item" ? <>
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
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={saving || (state.kind === "movement" && !itemId)}>{saving ? "Salvando..." : state.kind === "member" ? "Adicionar membro" : "Confirmar"}</button></div>
    </form></div>
  );
}

function LoadingRows() {
  return <div className="loading-list">{[1, 2, 3, 4].map((line) => <span key={line} />)}</div>;
}
