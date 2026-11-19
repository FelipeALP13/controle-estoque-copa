"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReportsView from "./reports-view";
import TasksView from "./tasks-view";
import NotificationsBell from "./notifications-bell";
import { TimerBadge } from "./task-timer";
import SprintsView from "./sprints-view";
import ReviewsView, { type ReviewsTab } from "./reviews-view";
import Sparkles from "lucide-react/icons/sparkles";
import ClientsArea, { type ClientsTab } from "./clients-area";
import CommunityView from "./community-view";
import ChatPanel, { ChatPanelButton } from "./chat-panel";
import MessagesSquare from "lucide-react/icons/messages-square";
import ClipboardCheck from "lucide-react/icons/clipboard-check";
import Building2 from "lucide-react/icons/building-2";
import CalendarRange from "lucide-react/icons/calendar-range";
import { BrandLogo, useBrand } from "./brand-context";
import LayoutDashboard from "lucide-react/icons/layout-dashboard";
import UserCog from "lucide-react/icons/user-cog";
import PeopleView from "./people-view";
import ProjectsView from "./projects-view";
import LeadershipView from "./leadership-view";
import FolderKanban from "lucide-react/icons/folder-kanban";
import Gauge from "lucide-react/icons/gauge";
import Wrench from "lucide-react/icons/wrench";
import MaintenanceView from "./maintenance-view";
import TicketsView from "./tickets-view";
import LifeBuoy from "lucide-react/icons/life-buoy";
import BookOpen from "lucide-react/icons/book-open";
import KnowledgeView, { type ArticleDraft } from "./knowledge-view";
import AdminView from "./admin-view";
import CalendarView from "./calendar-view";
import AgendaView from "./agenda-view";
import MyDay, { useMyDayAutoOpen } from "./my-day";
import { ProductTour } from "./product-tour";
import { comingUp, DEFAULT_COVER_DAYS, shoppingList } from "./stock-forecast";
import { downloadShoppingList, shoppingWhatsAppUrl } from "./shopping-list";
import NotebookPen from "lucide-react/icons/notebook-pen";
import { useUpcomingAgenda } from "./use-agenda";
import CalendarDays from "lucide-react/icons/calendar-days";
import CommandSearch from "./command-search";
import SidebarNav, { OPEN_TASK_EVENT, useNavCounts } from "./sidebar-nav";
import { type SearchHit } from "./search";
import ShieldCheck from "lucide-react/icons/shield-check";
import { useJiraAutoSync } from "./use-jira-sync";
import Contact from "lucide-react/icons/contact";
import ListTodo from "lucide-react/icons/list-todo";
import Box from "lucide-react/icons/box";
import CalendarClock from "lucide-react/icons/calendar-clock";
import Coffee from "lucide-react/icons/coffee";
import FileDown from "lucide-react/icons/file-down";
import History from "lucide-react/icons/history";
import LogOut from "lucide-react/icons/log-out";
import PanelLeftClose from "lucide-react/icons/panel-left-close";
import PanelLeftOpen from "lucide-react/icons/panel-left-open";

/** Escolha de cada pessoa: menu lateral fixo aberto ou só ícones. */
const MENU_PINNED_KEY = "portal-menu-fixo";
import Menu from "lucide-react/icons/menu";
import PackageCheck from "lucide-react/icons/package-check";
import PackageOpen from "lucide-react/icons/package-open";
import Plus from "lucide-react/icons/plus";
import Search from "lucide-react/icons/search";
import Settings2 from "lucide-react/icons/settings-2";
import ShoppingCart from "lucide-react/icons/shopping-cart";
import ShoppingBasket from "lucide-react/icons/shopping-basket";
import TrendingDown from "lucide-react/icons/trending-down";
import TriangleAlert from "lucide-react/icons/triangle-alert";
import UserPlus from "lucide-react/icons/user-plus";
import Users from "lucide-react/icons/users";
import X from "lucide-react/icons/x";
import { WhatsAppIcon, permissionPresets, type Member, type CurrentUser, type Item, type Movement, type ModalState, type Schedule, movementCopy, fmt, toForecast, exactDate, roleLabel, playfulGreeting, ItemVisual, MemberVisual, isoDateInSaoPaulo, LoadingRows } from "./dashboard-shared";
import { HubView } from "./hub-view";
import { ScheduleView } from "./schedule-view";
import { StockRow, PlanningView, HistoryView } from "./stock-views";
import { ShoppingTrip } from "./shopping-trip";
import { CopaRequestsView } from "./copa-requests-view";
import { TeamView } from "./team-view";
import { Modal } from "./dashboard-modal";

export default function Home() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [schedule, setSchedule] = useState<Schedule>({ teams: [], weeks: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "low" | "open">("all");
  const [tab, setTab] = useState<"hub" | "stock" | "schedule" | "tasks" | "projects" | "panel" | "tickets" | "knowledge" | "admin" | "calendar" | "agenda" | "people" | "planning" | "reports" | "history" | "team" | "clients" | "sprints" | "reviews" | "community" | "requests" | "maintenance">("hub");
  const [communityTab, setCommunityTab] = useState<{ key: number; channel: number | null }>({ key: 0, channel: null });
  // Painel de conversas ao lado, em qualquer tela.
  const [chatPanel, setChatPanel] = useState(false);
  // Aba aberta por um aviso dentro de Clientes (incidentes) ou Pessoas (equipamentos); a chave recria a tela.
  const [subTab, setSubTab] = useState<{ clients: ClientsTab; people: "people" | "assets"; key: number }>({ clients: "clients", people: "people", key: 0 });
  // Aba de Avaliações e metas aberta por um aviso (1:1, clima); a chave recria a tela na aba certa.
  const [reviewsTab, setReviewsTab] = useState<{ tab: ReviewsTab; key: number }>({ tab: "review", key: 0 });
  const [stockMenu, setStockMenu] = useState(false);
  // Modo "fazer compras" (lista no celular, registra tudo no fim).
  const [trip, setTrip] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [taskToOpen, setTaskToOpen] = useState<number | null>(null);
  const clearTaskToOpen = useCallback(() => setTaskToOpen(null), []);
  const [ticketToOpen, setTicketToOpen] = useState<number | null>(null);
  const clearTicketToOpen = useCallback(() => setTicketToOpen(null), []);
  const [articleToOpen, setArticleToOpen] = useState<number | null>(null);
  const [articleDraft, setArticleDraft] = useState<ArticleDraft | null>(null);
  const clearArticleRequest = useCallback(() => { setArticleToOpen(null); setArticleDraft(null); }, []);
  const [projectToOpen, setProjectToOpen] = useState<number | null>(null);
  const clearProjectToOpen = useCallback(() => setProjectToOpen(null), []);
  const [eventToOpen, setEventToOpen] = useState<number | null>(null);
  const clearEventToOpen = useCallback(() => setEventToOpen(null), []);
  const [personSearch, setPersonSearch] = useState("");

  // Menu lateral: troca de tela (os itens do estoque mantêm o submenu aberto) e fecha o menu no celular.
  function go(next: typeof tab, keepStock = false) {
    if (next === "reviews") setReviewsTab((current) => ({ tab: "review", key: current.key + 1 }));
    setSubTab((current) => ({ clients: "clients", people: "people", key: current.key + 1 }));
    setTab(next);
    setStockMenu(keepStock);
    setMobileMenu(false);
  }
  /** Abre a tela de um aviso; 1:1 e clima são abas de Avaliações e metas. */
  function openView(view: typeof tab | "one_on_ones" | "pulse" | "incidents" | "assets" | "chat") {
    if (view === "chat") {
      go("community");
      setCommunityTab((current) => ({ key: current.key + 1, channel: null }));
      return;
    }
    if (view === "incidents" || view === "assets") {
      go(view === "incidents" ? "clients" : "people");
      setSubTab((current) => ({ clients: view === "incidents" ? "incidents" : "clients", people: view === "assets" ? "assets" : "people", key: current.key + 1 }));
      return;
    }
    if (view === "one_on_ones" || view === "pulse") {
      go("reviews");
      setReviewsTab((current) => ({ tab: view === "pulse" ? "pulse" : "oneonone", key: current.key + 1 }));
      return;
    }
    go(view);
  }
  const { counts: navCounts } = useNavCounts(Boolean(currentUser?.active));
  // Menu lateral estilo Instagram: faixa só com ícones que se abre ao passar o mouse (ou com o teclado).
  // Um pequeno atraso evita abrir sem querer quando o mouse só cruza a faixa.
  const [sidebarHover, setSidebarHover] = useState(false);
  const hoverTimer = useRef<number | null>(null);
  const expandSidebar = useCallback(() => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setSidebarHover(true), 140);
  }, []);
  const collapseSidebar = useCallback(() => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    setSidebarHover(false);
  }, []);
  // Menu fixo aberto (com os nomes) em telas largas. Cada pessoa escolhe; o padrão é fixo a partir de 1280px.
  const [menuPinned, setMenuPinned] = useState(false);
  const [wideScreen, setWideScreen] = useState(false);
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1100px)");
    const sync = () => setWideScreen(wide.matches);
    wide.addEventListener("change", sync);
    const first = window.setTimeout(() => {
      sync();
      let saved: string | null = null;
      try { saved = window.localStorage.getItem(MENU_PINNED_KEY); } catch { /* navegador sem armazenamento */ }
      setMenuPinned(saved === null ? window.innerWidth >= 1280 : saved === "1");
    }, 0);
    return () => { window.clearTimeout(first); wide.removeEventListener("change", sync); };
  }, []);
  const toggleMenuPinned = useCallback(() => {
    setMenuPinned((current) => {
      try { window.localStorage.setItem(MENU_PINNED_KEY, current ? "0" : "1"); } catch { /* ok */ }
      return !current;
    });
    setSidebarHover(false);
  }, []);
  const pinnedOpen = menuPinned && wideScreen;

  // Atalhos da visão geral para abrir o formulário de nova demanda / novo chamado.
  const [newTaskRequest, setNewTaskRequest] = useState(0);
  const [newTicketRequest, setNewTicketRequest] = useState(0);

  // Resultado escolhido na busca geral: abre a tela certa já no item.
  function openSearchHit(hit: SearchHit) {
    setStockMenu(false);
    setMobileMenu(false);
    if (hit.kind === "task") openTask(hit.id);
    else if (hit.kind === "ticket") openTicket(hit.id);
    else if (hit.kind === "article") openKnowledge({ articleId: hit.id });
    else if (hit.kind === "project") { setTab("projects"); setProjectToOpen(hit.id); }
    else { setPersonSearch(hit.title); setTab("people"); }
  }

  // Chamados novos do Jira chegam enquanto alguém da equipe está com o Portal aberto.
  useJiraAutoSync(Boolean(currentUser?.active));
  // Agenda: avisos na hora exata enquanto o Portal está aberto (o sino toca o som).
  const { events: upcomingAgenda } = useUpcomingAgenda(Boolean(currentUser?.active));
  // "Meu dia": abre sozinho na primeira visita do dia.
  const [myDayOpen, setMyDayOpen] = useMyDayAutoOpen(Boolean(currentUser?.active));

  function openAgenda(eventId?: number) {
    setTab("agenda");
    setStockMenu(false);
    setMobileMenu(false);
    if (eventId) setEventToOpen(eventId);
  }

  function openKnowledge(request?: { articleId?: number; draft?: ArticleDraft }) {
    setTab("knowledge");
    setStockMenu(false);
    setMobileMenu(false);
    if (request?.articleId) setArticleToOpen(request.articleId);
    if (request?.draft) setArticleDraft(request.draft);
  }

  function openTicket(ticketId?: number) {
    setTab("tickets");
    setStockMenu(false);
    setMobileMenu(false);
    if (ticketId) setTicketToOpen(ticketId);
  }

  function openTask(taskId?: number) {
    setTab("tasks");
    setStockMenu(false);
    setMobileMenu(false);
    if (taskId) setTaskToOpen(taskId);
  }
  const [mobileMenu, setMobileMenu] = useState(false);
  // Demanda criada a partir de uma mensagem do chat: o link na conversa abre a demanda aqui.
  useEffect(() => {
    const onOpen = (event: Event) => {
      const taskId = Number((event as CustomEvent<number>).detail);
      if (!taskId) return;
      setTab("tasks"); setStockMenu(false); setMobileMenu(false); setTaskToOpen(taskId);
    };
    window.addEventListener(OPEN_TASK_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_TASK_EVENT, onOpen);
  }, []);
  // No celular a gaveta aberta já mostra os nomes.
  const sidebarOpen = sidebarHover || mobileMenu || pinnedOpen;

  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) setError("");
      const response = await fetch("/api/inventory", { cache: "no-store" });
      const data = await response.json() as { error?: string; items: Item[]; movements: Movement[]; currentUser: CurrentUser; members?: Member[]; schedule?: Schedule };
      if (response.status === 401) { router.replace("/"); return; }
      if (!response.ok) throw new Error(data.error || "Não foi possível carregar o estoque.");
      setItems(data.items);
      setMovements(data.movements);
      setCurrentUser(data.currentUser);
      setMembers(data.members || []);
      setSchedule(data.schedule || { teams: [], weeks: [] });
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : "Erro ao carregar dados.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(initialLoad);
  }, [load]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    const interval = window.setInterval(refresh, 5000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  // Lista de compras automática: acabou, está no mínimo ou acaba em até 7 dias pelo ritmo de consumo.
  const [coverDays, setCoverDays] = useState(DEFAULT_COVER_DAYS);
  const { brand } = useBrand();
  const stockToday = isoDateInSaoPaulo();
  const shopping = useMemo(() => shoppingList(items.map(toForecast), stockToday, coverDays), [items, stockToday, coverDays]);
  const upcomingStock = useMemo(() => comingUp(items.map(toForecast), stockToday), [items, stockToday]);
  const shoppingIds = useMemo(() => new Set(shopping.map((line) => line.id)), [shopping]);
  const lowItems = items.filter((item) => shoppingIds.has(item.id));
  const whatsappRestockUrl = shoppingWhatsAppUrl(shopping, brand.name, coverDays);
  const openItems = items.filter((item) => item.openedQty > 0);
  const totalUnits = items.reduce((sum, item) => sum + item.unopenedQty + item.openedQty, 0);
  const measuredItems = items.filter((item) => item.analytics.averageDurationDays !== null);
  const permissions = currentUser?.permissions ?? permissionPresets.viewer;
  const isAdmin = currentUser?.role === "admin";
  const todayLabel = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long" }).format(new Date());
  const playfulNote = playfulGreeting(currentUser?.name || "Equipe", lowItems[0]?.name, openItems.length);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("pt-BR");
    return items.filter((item) => {
      const matchesSearch = !query || `${item.name} ${item.category}`.toLocaleLowerCase("pt-BR").includes(query);
      const matchesFilter = filter === "all" || (filter === "low" && shoppingIds.has(item.id)) || (filter === "open" && item.openedQty > 0);
      return matchesSearch && matchesFilter;
    });
  }, [items, search, filter, shoppingIds]);

  async function submit(payload: Record<string, unknown>, success: string): Promise<string | null> {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
      await load();
      setModal(null);
      setNotice(success);
      window.setTimeout(() => setNotice(""), 3200);
      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao salvar.";
      setError(message);
      return message;
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

  async function deleteMember(member: Member) {
    if (!window.confirm(`Excluir ${member.name}? Só é possível para quem não tem demandas, projetos ou chamados; para quem tem histórico, use "Desativado" na coluna Status.`)) return;
    await submit({ action: "deleteMember", userId: member.userId }, "Membro excluído.");
  }

  async function logout() {
    await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "logout" }) });
    router.push("/");
    router.refresh();
  }

  return (
    <div className={`app-shell ${pinnedOpen ? "menu-pinned" : ""}`}>
      <aside className={`sidebar ${mobileMenu ? "open" : ""} ${sidebarOpen ? "expanded" : ""}`}
        onMouseEnter={pinnedOpen ? undefined : expandSidebar} onMouseLeave={pinnedOpen ? undefined : collapseSidebar}
        onFocus={pinnedOpen ? undefined : expandSidebar} onBlur={pinnedOpen ? undefined : (event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) collapseSidebar(); }}>
        <div className="brand"><span className={brand.logoUrl ? "brand-mark has-logo" : "brand-mark"}><BrandLogo fallback={<Users size={21} />} /></span><div><strong>{brand.name}</strong>{brand.tagline && <small>{brand.tagline}</small>}</div></div>
        <button className="close-menu" onClick={() => setMobileMenu(false)} aria-label="Fechar menu"><X /></button>
        <SidebarNav activeKey={tab} expanded={sidebarOpen} sections={[
          { items: [
            { key: "hub", label: "Visão geral", icon: <LayoutDashboard />, onClick: () => go("hub") },
            { key: "agenda", label: "Minha agenda", icon: <NotebookPen />, onClick: () => openAgenda() },
            { key: "calendar", label: "Calendário", icon: <CalendarDays />, onClick: () => go("calendar") },
            { key: "community", label: "Chat", icon: <MessagesSquare />, onClick: () => go("community"), badge: navCounts?.chat ? { count: navCounts.chat, tone: navCounts.chatDirect ? "danger" : "info", title: `${navCounts.chat} ${navCounts.chat === 1 ? "mensagem não lida" : "mensagens não lidas"}${navCounts.chatDirect ? ` (${navCounts.chatDirect} em conversa direta)` : ""}` } : null },
          ] },
          { label: "Trabalho", items: [
            { key: "tasks", label: "Demandas", icon: <ListTodo />, onClick: () => go("tasks"), badge: navCounts ? { count: navCounts.tasks, tone: navCounts.tasksOverdue ? "danger" : "info", title: navCounts.tasksOverdue ? `${navCounts.tasks} suas em aberto, ${navCounts.tasksOverdue} com prazo vencido` : `${navCounts.tasks} suas em aberto` } : null },
            { key: "tickets", label: "Chamados", icon: <LifeBuoy />, onClick: () => openTicket(), badge: navCounts ? { count: navCounts.tickets, tone: navCounts.ticketsLate ? "danger" : "info", title: `${navCounts.tickets} na fila do seu time${navCounts.ticketsUnassigned ? `, ${navCounts.ticketsUnassigned} sem dono` : ""}${navCounts.ticketsLate ? `, ${navCounts.ticketsLate} fora do prazo` : ""}` } : null },
            { key: "sprints", label: "Sprints e retros", icon: <CalendarRange />, onClick: () => go("sprints") },
            { key: "projects", label: "Projetos", icon: <FolderKanban />, onClick: () => go("projects") },
            { key: "clients", label: "Clientes", icon: <Building2 />, onClick: () => go("clients") },
            { key: "knowledge", label: "Base de conhecimento", icon: <BookOpen />, onClick: () => openKnowledge() },
          ] },
          { label: "Equipe", items: [
            { key: "schedule", label: "Escala", icon: <CalendarClock />, onClick: () => go("schedule") },
            { key: "reviews", label: "Avaliações e metas", icon: <ClipboardCheck />, onClick: () => go("reviews") },
            { key: "people", label: "Pessoas", icon: <Contact />, onClick: () => { setPersonSearch(""); go("people"); } },
            { key: "panel", label: "Painel", icon: <Gauge />, onClick: () => go("panel") },
            { key: "maintenance", label: "Manutenção", icon: <Wrench />, onClick: () => go("maintenance") },
          ] },
          { label: "Copa", items: [
            { key: "stock-module", label: "Estoque", icon: <PackageCheck />, open: stockMenu && sidebarOpen, onClick: () => setStockMenu((open) => !open), children: [
              { key: "stock", label: "Itens e saldos", icon: null, onClick: () => go("stock", true) },
              { key: "requests", label: "Pedidos da equipe", icon: null, onClick: () => go("requests", true) },
              ...(permissions.viewPlanning ? [{ key: "planning", label: "Planejamento", icon: null, onClick: () => go("planning", true) }] : []),
              ...(permissions.viewHistory ? [{ key: "reports", label: "Relatórios", icon: null, onClick: () => go("reports", true) }, { key: "history", label: "Histórico", icon: null, onClick: () => go("history", true) }] : []),
            ] },
          ] },
          { label: "Administração", items: isAdmin ? [
            { key: "team", label: "Usuários", icon: <UserCog />, onClick: () => go("team") },
            { key: "admin", label: "Marca e segurança", icon: <ShieldCheck />, onClick: () => go("admin") },
          ] : [] },
        ]} />
        <div className="sidebar-user">
          <button className="sidebar-footer" onClick={() => currentUser && setModal({ kind: "profile" })} aria-label="Editar meu perfil" title="Meu perfil">{currentUser ? <MemberVisual member={currentUser} /> : <span className="avatar">EQ</span>}<div><strong>{currentUser?.name || "Equipe"}</strong><small>{currentUser ? `${roleLabel(currentUser.role)} · Meu perfil` : "Carregando acesso"}</small></div></button>
          <button className="signout-link" onClick={logout} title="Sair do sistema" aria-label="Sair do sistema"><LogOut size={16} /></button>
        </div>
        {wideScreen && <button className="menu-pin-toggle" onClick={toggleMenuPinned} title={pinnedOpen ? "Recolher o menu (só ícones)" : "Fixar o menu aberto, com os nomes"} aria-pressed={pinnedOpen}>
          {pinnedOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}<span>{pinnedOpen ? "Recolher menu" : "Fixar menu"}</span>
        </button>}
      </aside>

      <main>
        <header className="topbar">
          <button className="menu-button" onClick={() => setMobileMenu(true)} aria-label="Abrir menu"><Menu /></button>
          <div><h1>{tab === "hub" ? "Visão geral" : tab === "stock" ? "Estoque" : tab === "schedule" ? "Escala de atendimento" : tab === "tasks" ? "Demandas" : tab === "projects" ? "Projetos grandes" : tab === "panel" ? "Painel da liderança" :tab === "tickets" ? "Chamados internos" : tab === "knowledge" ? "Base de conhecimento" : tab === "admin" ? "Marca, histórico e cópia de segurança" : tab === "calendar" ? "Calendário" : tab === "agenda" ? "Minha agenda" : tab === "clients" ? "Clientes e sistemas" : tab === "reviews" ? "Avaliações e metas" : tab === "community" ? "Chat da equipe" : tab === "sprints" ? "Sprints e retrospectivas" :tab === "people" ? "Pessoas e times" :tab === "planning" ? "Planejamento do estoque" : tab === "requests" ? "Pedidos da Copa" : tab === "maintenance" ? "Manutenção do escritório" : tab === "reports" ? "Relatórios" : tab === "team" ? "Usuários e permissões" : "Histórico do estoque"}</h1></div>
          <div className="topbar-actions">{currentUser?.active && currentUser.role !== "viewer" && <TimerBadge onOpenTask={openTask} />}<CommandSearch onPick={openSearchHit} />{currentUser?.active && tab !== "community" && <ChatPanelButton unread={navCounts?.chat ?? 0} direct={navCounts?.chatDirect ?? 0} active={chatPanel} onClick={() => setChatPanel((value) => !value)} />}<NotificationsBell onOpenTask={openTask} onOpenTicket={openTicket} onOpenEvent={openAgenda} onOpenView={(view) => openView(view)} />{tab === "stock" && (isAdmin || permissions.manageItems) ? <button className="primary-button" onClick={() => setModal({ kind: "item" })}><Plus size={18} /> Novo item</button> : tab === "team" && isAdmin ? <button className="primary-button" onClick={() => setModal({ kind: "member" })}><UserPlus size={18} /> Adicionar membro</button> : <span className="role-chip">{currentUser ? roleLabel(currentUser.role) : "Carregando"}</span>}</div>
        </header>

        <section className={`content ${tab === "community" ? "content-full" : ""}`}>
          {error && <div className="alert error"><TriangleAlert size={18} /><span>{error}</span><button onClick={() => setError("")}><X size={16} /></button></div>}
          {notice && <div className="toast"><PackageCheck size={18} />{notice}</div>}

          {tab === "hub" ? <HubView onOpenReviews={() => go("reviews")} onOpenPulse={() => openView("pulse")} items={items} movements={movements} schedule={schedule} currentUser={currentUser} counts={navCounts} agenda={upcomingAgenda} onOpenAgenda={openAgenda} onMyDay={() => setMyDayOpen(true)} onOpen={(destination) => go(destination)} onOpenTask={openTask} onOpenTicket={openTicket} onNewTask={() => { openTask(); setNewTaskRequest((value) => value + 1); }} onNewTicket={() => { openTicket(); setNewTicketRequest((value) => value + 1); }} onSearch={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))} /> : tab === "stock" ? (
            <>
              <section className="overview-hero">
                <div className="hero-copy">
                  <p className="hero-date">{todayLabel}</p>
                  <h2>{lowItems.length ? `${lowItems.length} ${lowItems.length === 1 ? "item precisa" : "itens precisam"} de atenção` : "Tudo em ordem por aqui"}</h2>
                  <p>{lowItems.length ? "Revise a sugestão de compra e mantenha o armário abastecido pra galera." : "O estoque está acima dos mínimos definidos. Continue registrando o consumo para melhorar as previsões."}</p>
                  <div className="hero-joke"><span>😄</span><div><small>RECADO DO ARMÁRIO</small><strong>{playfulNote}</strong></div></div>
                  <div className="quick-actions">
                    <button disabled={!permissions.registerPurchases} onClick={() => setModal({ kind: "movement", type: "purchase" })}><ShoppingCart /> Registrar compra</button>
                    <button disabled={!permissions.openItems} onClick={() => setModal({ kind: "movement", type: "open" })}><PackageOpen /> Abrir item</button>
                    <button disabled={!permissions.consumeItems} onClick={() => setModal({ kind: "movement", type: "consume" })}><TrendingDown /> Lançar consumo</button>
                    <button disabled={!permissions.adjustStock} onClick={() => setModal({ kind: "movement", type: "adjust" })}><Settings2 /> Conferir saldo</button>
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
                  <div className="insight-head"><div><span className="insight-icon"><ShoppingCart /></span><div><h3>Lista de compras</h3><p>Pelo estoque mínimo e pelo ritmo de consumo de cada item.</p></div></div><span className="insight-actions">{permissions.registerPurchases && <button className="trip-start" title="Abrir a lista para marcar no mercado" onClick={() => setTrip(true)}><ShoppingBasket size={14} /><span className="action-label">Fazer compras</span></button>}{lowItems.length > 0 && <a className="whatsapp-text-link" href={whatsappRestockUrl} target="_blank" rel="noopener noreferrer" aria-label="Enviar lista por WhatsApp" title="Enviar por WhatsApp"><WhatsAppIcon size={14} /><span className="action-label">WhatsApp</span></a>}{shopping.length > 0 && <button aria-label="Baixar a lista de compras em Excel" title="Baixar em Excel" onClick={() => downloadShoppingList(shopping, coverDays, stockToday)}><FileDown size={14} /><span className="action-label">Excel</span></button>}<button aria-label="Ver itens no estoque" title="Ver no estoque" onClick={() => { setFilter("low"); document.querySelector(".section-heading")?.scrollIntoView({ behavior: "smooth" }); }}><Search size={14} /><span className="action-label">Ver no estoque</span></button></span></div>
                  {shopping.length ? <div className="restock-list">{shopping.slice(0,4).map((line) => {
                    const item = items.find((entry) => entry.id === line.id);
                    return <div key={line.id}>{item && <ItemVisual item={item} />}<div><strong>{line.name}</strong><small>{line.reason || `tem ${fmt(line.available)} ${line.unit}`}</small></div><b className={`restock-buy ${line.urgency}`}>+{fmt(line.buy)} {line.unit}</b></div>;
                  })}{shopping.length > 4 && permissions.viewPlanning && <button className="restock-more" onClick={() => setTab("planning")}>Ver a lista completa ({shopping.length})</button>}</div> : <div className="insight-empty"><PackageCheck /><div><strong>Nada para comprar agora</strong><p>Nenhum item acabou, está no mínimo ou acaba nos próximos 7 dias.</p></div></div>}
                </article>
                <article className="insight-card activity-card">
                  <div className="insight-head"><div><span className="insight-icon"><History /></span><div><h3>Atividade recente</h3><p>Últimos registros feitos pela equipe.</p></div></div><button onClick={() => setTab("history")}>Ver histórico</button></div>
                  {movements.length ? <div className="mini-activity">{movements.slice(0,4).map((movement) => {
                    const copy = movementCopy[movement.type]; const Icon = copy.icon;
                    return <div key={movement.id}><span className={`history-icon ${copy.tone}`}><Icon /></span><div><strong>{copy.label} · {movement.itemName}</strong><small>{movement.createdByName || "Equipe"} · {exactDate(movement.createdAt)}</small></div><b>{movement.type === "consume" ? "−" : movement.type === "purchase" ? "+" : ""}{fmt(Math.abs(movement.quantity))}</b></div>;
                  })}</div> : <div className="insight-empty"><History /><div><strong>Nenhuma atividade ainda</strong><p>Os lançamentos da equipe aparecerão aqui.</p></div></div>}
                </article>
              </div>

              <div className="section-heading"><div><h2>Itens do estoque</h2><p>Acompanhe o que está fechado, aberto e próximo de acabar.</p></div><div className="section-actions">{lowItems.length > 0 && <a className="secondary-button whatsapp-button" href={whatsappRestockUrl} target="_blank" rel="noopener noreferrer" aria-label="Enviar lista por WhatsApp" title="Enviar por WhatsApp"><WhatsAppIcon size={17} /> Enviar por WhatsApp</a>}<button className="secondary-button restock-export" disabled={!shopping.length} onClick={() => downloadShoppingList(shopping, coverDays, stockToday)} aria-label="Baixar a lista de compras em Excel" title="Baixar a lista de compras em Excel"><FileDown size={17} /> Lista de compras{lowItems.length > 0 && <b>{lowItems.length}</b>}</button><button className="secondary-button" aria-label="Registrar compra" title="Registrar compra" disabled={!permissions.registerPurchases} onClick={() => setModal({ kind: "movement", type: "purchase" })}><Plus size={17} /> Registrar compra</button>{permissions.registerPurchases && <button className="primary-button" onClick={() => setTrip(true)}><ShoppingBasket size={17} /> Fazer compras</button>}</div></div>

              <div className="toolbar">
                <label className="search"><Search size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar item ou categoria..." /></label>
                <div className="filters">
                  <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>Todos</button>
                  <button className={filter === "open" ? "active" : ""} onClick={() => setFilter("open")}>Abertos</button>
                  <button className={filter === "low" ? "active" : ""} onClick={() => setFilter("low")}>Para comprar {lowItems.length > 0 && <b>{lowItems.length}</b>}</button>
                </div>
              </div>

              {loading ? <LoadingRows /> : items.length === 0 ? (
                <div className="empty-state"><span><Coffee /></span><h3>Seu estoque começa aqui</h3><p>Adicione seus próprios itens ou carregue uma lista inicial com café, açúcar, biscoito, leite e chá.</p><div><button className="primary-button" onClick={() => setModal({ kind: "item" })} disabled={!permissions.manageItems}><Plus size={17} /> Adicionar item</button><button className="secondary-button" onClick={seed} disabled={saving || !permissions.manageItems}><Sparkles size={17} /> Usar lista inicial</button></div></div>
              ) : filtered.length === 0 ? (
                <div className="empty-state compact"><Search /><h3>Nenhum item encontrado</h3><p>Tente outro nome ou remova o filtro selecionado.</p></div>
              ) : (
                <div className="stock-list">
                  <div className="list-head"><span>Item</span><span>Saldo atual</span><span>Situação</span><span>Duração média</span><span>Última abertura</span><span>Ações</span></div>
                  {filtered.map((item) => <StockRow key={item.id} item={item} permissions={permissions} onAction={(type) => setModal({ kind: "movement", type, item })} onEdit={() => setModal({ kind: "item", item })} onDelete={() => deleteItem(item)} />)}
                </div>
              )}
            </>
          ) : tab === "schedule" ? <ScheduleView schedule={schedule} loading={loading} canEdit={permissions.manageSchedule} onNewTeam={() => setModal({ kind: "supportTeam" })} onEditTeam={(team) => setModal({ kind: "supportTeam", team })} onNewWeek={() => setModal({ kind: "supportWeek" })} onEditWeek={(week) => setModal({ kind: "supportWeek", week })} onGenerate={() => setModal({ kind: "generateWeeks" })} /> :tab === "planning" ? <PlanningView items={items} loading={loading} shopping={shopping} upcoming={upcomingStock} coverDays={coverDays} onCoverDays={setCoverDays} today={stockToday} onTrip={permissions.registerPurchases ? () => setTrip(true) : undefined} /> : tab === "requests" ? <CopaRequestsView items={items} onStockChanged={() => void load(true)} /> : tab === "maintenance" ? <MaintenanceView /> : tab === "reports" ? <ReportsView /> : tab === "tasks" ? <TasksView openRequest={taskToOpen} onOpenRequestHandled={clearTaskToOpen} createRequest={newTaskRequest} /> : tab === "people" ? <PeopleView key={`${personSearch}-${subTab.key}`} initialSearch={personSearch} initialTab={subTab.people} /> : tab === "projects" ? <ProjectsView onOpenTask={openTask} openRequest={projectToOpen} onOpenRequestHandled={clearProjectToOpen} /> : tab === "panel" ? <LeadershipView onOpenTask={openTask} onOpenProjects={() => setTab("projects")} /> : tab === "tickets" ? <TicketsView openRequest={ticketToOpen} onOpenRequestHandled={clearTicketToOpen} createRequest={newTicketRequest} onOpenTask={openTask} onOpenArticle={(articleId) => openKnowledge({ articleId })} onSaveSolution={(draft) => openKnowledge({ draft })} /> : tab === "clients" ? <ClientsArea key={subTab.key} initialTab={subTab.clients} onOpenTask={openTask} onOpenTicket={openTicket} /> : tab === "sprints" ? <SprintsView onOpenTask={openTask} /> : tab === "reviews" ? <ReviewsView key={reviewsTab.key} initialTab={reviewsTab.tab} /> : tab === "community" ? <CommunityView key={communityTab.key} openChannel={communityTab.channel} /> : tab === "agenda" ? <AgendaView openRequest={eventToOpen} onOpenRequestHandled={clearEventToOpen} /> : tab === "calendar" ? <CalendarView schedule={schedule} onOpenTask={openTask} onOpenEvent={openAgenda} onOpenProject={(id) => { setTab("projects"); setProjectToOpen(id); }} /> : tab === "admin" && isAdmin ? <AdminView /> : tab === "knowledge" ? <KnowledgeView openRequest={articleToOpen} draft={articleDraft} onRequestHandled={clearArticleRequest} onOpenTicket={openTicket} /> :tab === "team" ? <TeamView members={members} currentUser={currentUser} saving={saving} onAddMember={() => setModal({ kind: "member" })} onEditMember={(member) => setModal({ kind: "member", member })} onDeleteMember={deleteMember} onUpdateRole={(userId, role) => submit({ action: "updateMemberRole", userId, role }, "Permissão atualizada.")} onUpdateActive={(userId, active) => submit({ action: "updateMemberActive", userId, active }, active ? "Acesso reativado." : "Acesso desativado.")} /> : <HistoryView movements={movements} loading={loading} />}
        </section>
      </main>
      {chatPanel && tab !== "community" && <ChatPanel onClose={() => setChatPanel(false)} onOpenFull={(channel) => { setChatPanel(false); go("community"); setCommunityTab((current) => ({ key: current.key + 1, channel })); }} />}

      {mobileMenu && <button className="backdrop menu-backdrop" onClick={() => setMobileMenu(false)} aria-label="Fechar menu" />}
      {currentUser?.active && <ProductTour memberId={currentUser.userId} firstName={currentUser.name.split(/\s+/)[0]} blocked={myDayOpen || modal !== null} />}
      {myDayOpen && currentUser && <MyDay name={currentUser.name} agenda={upcomingAgenda} onClose={() => setMyDayOpen(false)} onOpenTask={openTask} onOpenTicket={openTicket} onOpenAgenda={openAgenda} />}
      {trip && <ShoppingTrip lines={shopping} items={items} onClose={() => setTrip(false)} onDone={(count) => { setTrip(false); void load(); setNotice(`${count} ${count === 1 ? "compra registrada" : "compras registradas"}.`); window.setTimeout(() => setNotice(""), 3200); }} />}
      {modal && <Modal state={modal} items={items} schedule={schedule} currentUser={currentUser} saving={saving} onClose={() => { setModal(null); setError(""); }} onSubmit={submit} />}
    </div>
  );
}
