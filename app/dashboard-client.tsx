"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { passwordPolicyError } from "./auth-policy";
import { marketCategories, marketUnits } from "./inventory-standards";
import { parseMovementDate } from "./movement-policy";
import ReportsView from "./reports-view";
import TasksView, { MyTasksPanel, TeamChip } from "./tasks-view";
import NotificationsBell from "./notifications-bell";
import { APP_NAME, APP_TAGLINE } from "./brand";
import LayoutDashboard from "lucide-react/icons/layout-dashboard";
import UserCog from "lucide-react/icons/user-cog";

const sidebarTips = [
  "Na tela de Demandas, aperte a tecla C para criar uma demanda rápida.",
  "Precisa de outro time? Abra um chamado: ele cai direto na fila de quem resolve.",
  "Escreva @ e o nome da pessoa num comentário para avisá-la no sininho.",
  "Mantenha seu cargo e telefone em dia em Meu perfil: eles aparecem em Pessoas.",
  "A escala da semana pode ser enviada no WhatsApp com um clique, direto da visão geral.",
  "Use “Do meu time” nas demandas e “Fila do meu time” nos chamados para focar no que é seu.",
];
import PeopleView from "./people-view";
import ProjectsView from "./projects-view";
import LeadershipView from "./leadership-view";
import FolderKanban from "lucide-react/icons/folder-kanban";
import Gauge from "lucide-react/icons/gauge";
import TicketsView, { MyTicketsPanel } from "./tickets-view";
import LifeBuoy from "lucide-react/icons/life-buoy";
import BookOpen from "lucide-react/icons/book-open";
import KnowledgeView, { type ArticleDraft } from "./knowledge-view";
import NoticeBoard from "./notice-board";
import { useJiraAutoSync } from "./use-jira-sync";
import Contact from "lucide-react/icons/contact";
import ListTodo from "lucide-react/icons/list-todo";
import CalendarOff from "lucide-react/icons/calendar-off";
import { absentInSchedule, describeAbsence, splitAbsences } from "./absences";
import { useAbsences } from "./use-absences";
import { addDays, findOverlappingWeek, generateRotation, nextSupportWeek, normalizeTeamMembers, scheduleWhatsAppMessage,supportTeamColorLabels, supportTeamColors, supportWeekForDate, weekRangeError, type SupportTeam, type SupportTeamColor, type SupportWeek } from "./support-schedule";
import Archive from "lucide-react/icons/archive";
import BarChart3 from "lucide-react/icons/bar-chart-3";
import Box from "lucide-react/icons/box";
import CalendarClock from "lucide-react/icons/calendar-clock";
import ChevronDown from "lucide-react/icons/chevron-down";
import CircleUserRound from "lucide-react/icons/circle-user-round";
import Coffee from "lucide-react/icons/coffee";
import Ellipsis from "lucide-react/icons/ellipsis";
import FileDown from "lucide-react/icons/file-down";
import History from "lucide-react/icons/history";
import ImagePlus from "lucide-react/icons/image-plus";
import LogOut from "lucide-react/icons/log-out";
import Menu from "lucide-react/icons/menu";
import PackageCheck from "lucide-react/icons/package-check";
import PackageOpen from "lucide-react/icons/package-open";
import Pencil from "lucide-react/icons/pencil";
import Plus from "lucide-react/icons/plus";
import QrCode from "lucide-react/icons/qr-code";
import Search from "lucide-react/icons/search";
import Settings2 from "lucide-react/icons/settings-2";
import ShoppingCart from "lucide-react/icons/shopping-cart";
import Sparkles from "lucide-react/icons/sparkles";
import Trash2 from "lucide-react/icons/trash-2";
import TrendingDown from "lucide-react/icons/trending-down";
import TriangleAlert from "lucide-react/icons/triangle-alert";
import UserPlus from "lucide-react/icons/user-plus";
import Users from "lucide-react/icons/users";
import X from "lucide-react/icons/x";

function WhatsAppIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.5 11.6a8.4 8.4 0 0 1-12.4 7.3L3.5 20l1.2-4.4A8.4 8.4 0 1 1 20.5 11.6Z" />
      <path d="M8.2 7.6c.2-.4.4-.4.8-.4h.4c.2 0 .4.1.5.4l.8 2c.1.3.1.5-.1.7l-.7.8c-.2.2-.1.4 0 .6.8 1.4 2 2.4 3.5 3 .2.1.4.1.6-.1l.9-1.1c.2-.2.4-.3.7-.2l2 .9c.3.1.4.3.4.6 0 .5-.2 1.4-.8 1.9-.6.5-1.5.8-2.5.6-1.1-.2-3.7-1.1-5.8-3.1-1.7-1.6-2.8-3.6-3-4.7-.2-.9.1-1.5.4-1.9Z" />
    </svg>
  );
}

type MemberRole = "admin" | "member" | "viewer";
type MemberPermissions = {
  manageItems: boolean;
  registerPurchases: boolean;
  openItems: boolean;
  consumeItems: boolean;
  adjustStock: boolean;
  viewPlanning: boolean;
  viewHistory: boolean;
  manageSchedule: boolean;
};

const permissionPresets: Record<MemberRole, MemberPermissions> = {
  admin: { manageItems: true, registerPurchases: true, openItems: true, consumeItems: true, adjustStock: true, viewPlanning: true, viewHistory: true, manageSchedule: true },
  member: { manageItems: false, registerPurchases: true, openItems: true, consumeItems: true, adjustStock: false, viewPlanning: true, viewHistory: true, manageSchedule: false },
  viewer: { manageItems: false, registerPurchases: false, openItems: false, consumeItems: false, adjustStock: false, viewPlanning: true, viewHistory: true, manageSchedule: false },
};

const permissionOptions: { key: keyof MemberPermissions; label: string; description: string }[] = [
  { key: "manageItems", label: "Gerenciar itens", description: "Cadastrar, editar e excluir produtos" },
  { key: "registerPurchases", label: "Registrar compras", description: "Adicionar novas unidades ao estoque" },
  { key: "openItems", label: "Abrir produtos", description: "Mover unidades fechadas para em uso" },
  { key: "consumeItems", label: "Lançar consumo", description: "Baixar quantidades já abertas" },
  { key: "adjustStock", label: "Ajustar saldo", description: "Corrigir a contagem física" },
  { key: "viewPlanning", label: "Ver planejamento", description: "Consultar duração e previsão de compras" },
  { key: "viewHistory", label: "Ver histórico", description: "Consultar movimentações da equipe" },
  { key: "manageSchedule", label: "Editar escala", description: "Alterar equipes e semanas de atendimento" },
];

type Member = {
  id: number;
  userId: string;
  name: string;
  email: string;
  username: string | null;
  role: MemberRole;
  permissions: MemberPermissions;
  active: boolean;
  avatarIcon: string;
  avatarKey: string | null;
  createdAt: string;
};

type CurrentUser = Pick<Member, "userId" | "name" | "email" | "username" | "role" | "permissions" | "active" | "avatarIcon" | "avatarKey">;

type Item = {
  id: number;
  name: string;
  category: string;
  unit: string;
  unopenedQty: number;
  openedQty: number;
  minimumQty: number;
  icon: string;
  imageKey: string | null;
  scanCode: string | null;
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
  | { kind: "member"; member?: Member }
  | { kind: "profile" }
  | { kind: "movement"; type: Movement["type"]; item?: Item }
  | { kind: "scanner" }
  | { kind: "supportTeam"; team?: SupportTeam }
  | { kind: "supportWeek"; week?: SupportWeek }
  | { kind: "generateWeeks" }
  | null;

type Schedule = { teams: SupportTeam[]; weeks: SupportWeek[] };

const movementCopy = {
  purchase: { label: "Compra", icon: ShoppingCart, tone: "green" },
  open: { label: "Abertura", icon: PackageOpen, tone: "amber" },
  consume: { label: "Consumo", icon: TrendingDown, tone: "red" },
  adjust: { label: "Ajuste", icon: Settings2, tone: "blue" },
} as const;

function fmt(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
}

function itemReorderPoint(item: Item) {
  return item.minimumQty;
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

function playfulGreeting(name: string, lowItem?: string, openCount = 0) {
  const firstName = name.trim().split(/\s+/)[0] || "Chefe";
  const messages = lowItem ? [
    `${firstName}, já vai comer de novo? O ${lowItem.toLocaleLowerCase("pt-BR")} nem teve tempo de se despedir.`,
    `${firstName}, o estoque baixou e todo mundo olhou pra você. Coincidência? Sei…`,
    `${firstName}, deixa um pouco de ${lowItem.toLocaleLowerCase("pt-BR")} pros outros também, campeão.`,
    `${firstName}, desse jeito o ${lowItem.toLocaleLowerCase("pt-BR")} vai pedir medida protetiva.`,
    `${firstName}, passa reto pelo cantinho do café pelo menos uma vez. Só pra gente ver uma coisa.`,
    `${firstName}, o ${lowItem.toLocaleLowerCase("pt-BR")} sumiu de novo. Quer contar alguma coisa pra equipe?`,
  ] : openCount > 0 ? [
    `${firstName}, abriu de novo? O armário já decorou até o barulho dos seus passos.`,
    `${firstName}, ${openCount === 1 ? "tem um item aberto" : `tem ${openCount} itens abertos`}. Foi você, né? Pode falar.`,
    `${firstName}, calma aí. O expediente é longo e o biscoito não vai fugir.`,
    `${firstName}, você veio trabalhar ou fazer vistoria diária no cantinho do café?`,
    `${firstName}, mais uma visita ao armário? Já pode pedir uma mesa do lado dele.`,
    `${firstName}, a embalagem mal abriu e você já apareceu. Impressionante.`,
  ] : [
    `${firstName}, nada aberto ainda. Você está bem? A equipe ficou preocupada.`,
    `${firstName}, os biscoitos sobreviveram ao dia. Ninguém esperava isso de você.`,
    `${firstName}, estoque em ordem. Hoje você resolveu dar folga pro cantinho do café?`,
    `${firstName}, nenhuma baixa suspeita. Estamos verificando se você realmente veio trabalhar.`,
    `${firstName}, o armário está intacto. Pode admitir: você almoçou antes de chegar.`,
    `${firstName}, tudo abastecido. Tenta não transformar isso num desafio pessoal.`,
  ];
  const dailySeed = `${firstName}${new Date().toISOString().slice(0, 10)}`.split("").reduce((total, character) => total + character.charCodeAt(0), 0);
  return messages[dailySeed % messages.length];
}

function mediaUrl(key: string | null) {
  return key ? `/api/media?key=${encodeURIComponent(key)}` : "";
}

function ItemVisual({ item, className = "item-avatar" }: { item: Pick<Item, "name" | "icon" | "imageKey">; className?: string }) {
  return <span className={`${className} visual-avatar`}>{item.imageKey ? <Image src={mediaUrl(item.imageKey)} alt="" fill sizes="64px" unoptimized /> : <span>{item.icon || item.name.slice(0, 2).toUpperCase()}</span>}</span>;
}

function MemberVisual({ member, className = "avatar member-avatar" }: { member: Pick<Member, "name" | "avatarIcon" | "avatarKey">; className?: string }) {
  return <span className={`${className} visual-avatar`}>{member.avatarKey ? <Image src={mediaUrl(member.avatarKey)} alt="" fill sizes="64px" unoptimized /> : <span>{member.avatarIcon || member.name.slice(0, 2).toUpperCase()}</span>}</span>;
}

const visualIcons = ["📦", "☕", "🍪", "🍬", "🥛", "🍵", "🧃", "🧻", "🧼", "🥄", "🧴", "🍫"];
const personIcons = ["👤", "🧑‍💼", "👩‍💼", "👨‍💼", "🧑‍💻", "👩‍💻", "👨‍💻", "🎧", "🧑‍🔧", "🚀", "⭐", "🐱", "🐶", "🦊"];

async function uploadImage(file: File, kind: "item" | "profile") {
  const form = new FormData();
  form.append("file", file);
  form.append("kind", kind);
  const response = await fetch("/api/media", { method: "POST", body: form });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Não foi possível enviar a imagem.");
  return String(data.imageKey);
}

function StandardChoice({ label, value, setValue, options, customLabel, helper }: { label: string; value: string; setValue: (value: string) => void; options: readonly string[]; customLabel: string; helper: string }) {
  const [custom, setCustom] = useState(Boolean(value && !options.includes(value)));
  return <label className="standard-choice">
    <span>{label}</span>
    <select required value={custom ? "__custom" : value} onChange={(event) => {
      if (event.target.value === "__custom") {
        setCustom(true);
        setValue("");
      } else {
        setCustom(false);
        setValue(event.target.value);
      }
    }}>
      <option value="" disabled>Selecione uma opção</option>
      {options.map((option) => <option key={option} value={option}>{option}</option>)}
      <option value="__custom">{customLabel}</option>
    </select>
    {custom && <input className="custom-choice-value" required autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder="Digite o valor personalizado" />}
    <small>{helper}</small>
  </label>;
}

function VisualEditor({ label, mode, setMode, icon, setIcon, imageKey, file, setFile, icons = visualIcons }: { label: string; mode: "icon" | "image"; setMode: (mode: "icon" | "image") => void; icon: string; setIcon: (icon: string) => void; imageKey: string | null; file: File | null; setFile: (file: File | null) => void; icons?: readonly string[] }) {
  const localPreview = useMemo(() => file ? URL.createObjectURL(file) : "", [file]);
  const preview = localPreview || mediaUrl(imageKey);
  const [failedPreview, setFailedPreview] = useState("");
  const previewFailed = Boolean(preview && failedPreview === preview);

  useEffect(() => () => {
    if (localPreview) URL.revokeObjectURL(localPreview);
  }, [localPreview]);

  return <div className="visual-editor full">
    <span className="field-label">{label}</span>
    <div className="visual-mode"><button type="button" className={mode === "icon" ? "active" : ""} onClick={() => setMode("icon")}>Usar ícone</button><button type="button" className={mode === "image" ? "active" : ""} onClick={() => setMode("image")}>Usar foto</button></div>
    {mode === "icon" ? <><div className="icon-options">{icons.map((option) => <button type="button" key={option} className={icon === option ? "active" : ""} onClick={() => setIcon(option)}>{option}</button>)}</div><label className="custom-icon"><span>Outro ícone ou emoji</span><input value={icon} onChange={(event) => setIcon(event.target.value.slice(0, 8))} maxLength={8} /></label></> : <label className="image-upload"><span className="image-preview">{preview && !previewFailed ? <Image src={preview} alt="" fill sizes="64px" unoptimized onError={() => setFailedPreview(preview)} /> : <ImagePlus aria-hidden="true" />}</span><span><strong>{file ? file.name : imageKey && !previewFailed ? "Trocar imagem" : "Selecionar imagem"}</strong><small>PNG, JPG ou WebP · até 3 MB</small></span><input type="file" aria-label={`Selecionar ${label.toLowerCase()}`} accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>}
  </div>;
}

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
  const [tab, setTab] = useState<"hub" | "stock" | "schedule" | "tasks" | "projects" | "panel" | "tickets" | "knowledge" | "people" | "planning" | "reports" | "history" | "team">("hub");
  const [stockMenu, setStockMenu] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [taskToOpen, setTaskToOpen] = useState<number | null>(null);
  // Uma dica por dia, a mesma para todos.
  const dailyTip = sidebarTips[Math.floor(Date.now() / 86400000) % sidebarTips.length];
  const clearTaskToOpen = useCallback(() => setTaskToOpen(null), []);
  const [ticketToOpen, setTicketToOpen] = useState<number | null>(null);
  const clearTicketToOpen = useCallback(() => setTicketToOpen(null), []);
  const [articleToOpen, setArticleToOpen] = useState<number | null>(null);
  const [articleDraft, setArticleDraft] = useState<ArticleDraft | null>(null);
  const clearArticleRequest = useCallback(() => { setArticleToOpen(null); setArticleDraft(null); }, []);
  // Chamados novos do Jira chegam enquanto alguém da equipe está com o Portal aberto.
  useJiraAutoSync(Boolean(currentUser?.active));

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

  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) setError("");
      const response = await fetch("/api/inventory", { cache: "no-store" });
      const data = await response.json();
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

  const lowItems = items.filter((item) => item.unopenedQty + item.openedQty <= itemReorderPoint(item));
  const restockMessage = [
    `🛒 *Lista de reposição — ${APP_NAME}*`,
    "",
    "Precisamos repor:",
    ...lowItems.map((item) => {
      const available = item.unopenedQty + item.openedQty;
      const suggested = Math.max(1, Math.ceil(item.minimumQty - available));
      return `• *${item.name}* — saldo: ${fmt(available)} ${item.unit} · mínimo: ${fmt(item.minimumQty)} · comprar: ${suggested} ${item.unit}`;
    }),
    "",
    `Gerado em ${new Intl.DateTimeFormat("pt-BR").format(new Date())}.`,
  ].join("\n");
  const whatsappRestockUrl = `https://wa.me/?text=${encodeURIComponent(restockMessage)}`;
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
      const matchesSearch = !query || `${item.name} ${item.category} ${item.scanCode || ""}`.toLocaleLowerCase("pt-BR").includes(query);
      const matchesFilter = filter === "all" || (filter === "low" && item.unopenedQty + item.openedQty <= itemReorderPoint(item)) || (filter === "open" && item.openedQty > 0);
      return matchesSearch && matchesFilter;
    });
  }, [items, search, filter]);

  async function submit(payload: Record<string, unknown>, success: string): Promise<string | null> {
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
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenu ? "open" : ""}`}>
        <div className="brand"><span className="brand-mark"><Users size={21} /></span><div><strong>{APP_NAME}</strong><small>{APP_TAGLINE}</small></div></div>
        <button className="close-menu" onClick={() => setMobileMenu(false)} aria-label="Fechar menu"><X /></button>
        <nav>
          <button className={tab === "hub" ? "active" : ""} onClick={() => { setTab("hub"); setStockMenu(false); setMobileMenu(false); }}><LayoutDashboard /> Visão geral</button>
          <div className={`sidebar-module ${["stock", "planning", "reports", "history"].includes(tab) ? "selected" : ""}`}>
            <button className="module-trigger" aria-expanded={stockMenu} onClick={() => setStockMenu((open) => !open)}><PackageCheck /> <span>Estoque</span><ChevronDown className={stockMenu ? "open" : ""} /></button>
            {stockMenu && <div className="sidebar-subnav">
              <button className={tab === "stock" ? "active" : ""} onClick={() => { setTab("stock"); setStockMenu(true); setMobileMenu(false); }}>Itens e saldos</button>
              {permissions.viewPlanning && <button className={tab === "planning" ? "active" : ""} onClick={() => { setTab("planning"); setStockMenu(true); setMobileMenu(false); }}>Planejamento</button>}
              {permissions.viewHistory && <button className={tab === "reports" ? "active" : ""} onClick={() => { setTab("reports"); setStockMenu(true); setMobileMenu(false); }}>Relatórios</button>}
              {permissions.viewHistory && <button className={tab === "history" ? "active" : ""} onClick={() => { setTab("history"); setStockMenu(true); setMobileMenu(false); }}>Histórico</button>}
            </div>}
          </div>
          <button className={tab === "schedule" ? "active" : ""} onClick={() => { setTab("schedule"); setStockMenu(false); setMobileMenu(false); }}><CalendarClock /> Escala</button>
          <button className={tab === "tasks" ? "active" : ""} onClick={() => { setTab("tasks"); setStockMenu(false); setMobileMenu(false); }}><ListTodo /> Demandas</button>
          <button className={tab === "projects" ? "active" : ""} onClick={() => { setTab("projects"); setStockMenu(false); setMobileMenu(false); }}><FolderKanban /> Projetos</button>
          <button className={tab === "panel" ? "active" : ""} onClick={() => { setTab("panel"); setStockMenu(false); setMobileMenu(false); }}><Gauge /> Painel</button>
          <button className={tab === "tickets" ? "active" : ""} onClick={() => openTicket()}><LifeBuoy /> Chamados</button>
          <button className={tab === "knowledge" ? "active" : ""} onClick={() => openKnowledge()}><BookOpen /> Base de conhecimento</button>
          <button className={tab === "people" ? "active" : ""} onClick={() => { setTab("people"); setStockMenu(false); setMobileMenu(false); }}><Contact /> Pessoas</button>
          {isAdmin && <button className={tab === "team" ? "active" : ""} onClick={() => { setTab("team"); setStockMenu(false); setMobileMenu(false); }}><UserCog /> Usuários</button>}
        </nav>
        <div className="sidebar-tip">
          <span><Sparkles size={16} /> Dica</span>
          <p>{dailyTip}</p>
        </div>
        <button className="sidebar-footer" onClick={() => currentUser && setModal({ kind: "profile" })} aria-label="Editar meu perfil">{currentUser ? <MemberVisual member={currentUser} /> : <span className="avatar">EQ</span>}<div><strong>{currentUser?.name || "Equipe"}</strong><small>{currentUser ? `${roleLabel(currentUser.role)} · Meu perfil` : "Carregando acesso"}</small></div><CircleUserRound size={18} /></button>
        <button className="signout-link" onClick={logout}><LogOut size={15} /> Sair do sistema</button>
      </aside>

      <main>
        <header className="topbar">
          <button className="menu-button" onClick={() => setMobileMenu(true)} aria-label="Abrir menu"><Menu /></button>
          <div><p className="eyebrow">PORTAL DA EQUIPE</p><h1>{tab === "hub" ? "Visão geral" : tab === "stock" ? "Estoque" : tab === "schedule" ? "Escala de atendimento" : tab === "tasks" ? "Demandas" : tab === "projects" ? "Projetos grandes" : tab === "panel" ? "Painel da liderança" :tab === "tickets" ? "Chamados internos" : tab === "knowledge" ? "Base de conhecimento" :tab === "people" ? "Pessoas e times" :tab === "planning" ? "Planejamento do estoque" : tab === "reports" ? "Relatórios" : tab === "team" ? "Usuários e permissões" : "Histórico do estoque"}</h1></div>
          <div className="topbar-actions"><NotificationsBell onOpenTask={openTask} onOpenTicket={openTicket} />{tab === "stock" && (isAdmin || permissions.manageItems) ? <button className="primary-button" onClick={() => setModal({ kind: "item" })}><Plus size={18} /> Novo item</button> : tab === "team" && isAdmin ? <button className="primary-button" onClick={() => setModal({ kind: "member" })}><UserPlus size={18} /> Adicionar membro</button> : <span className="role-chip">{currentUser ? roleLabel(currentUser.role) : "Carregando"}</span>}</div>
        </header>

        <section className="content">
          {error && <div className="alert error"><TriangleAlert size={18} /><span>{error}</span><button onClick={() => setError("")}><X size={16} /></button></div>}
          {notice && <div className="toast"><PackageCheck size={18} />{notice}</div>}

          {tab === "hub" ? <HubView items={items} movements={movements} schedule={schedule} currentUser={currentUser} isAdmin={isAdmin} onOpen={(destination) => setTab(destination)} onOpenTask={openTask} onOpenTicket={openTicket} /> : tab === "stock" ? (
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
                  <div className="insight-head"><div><span className="insight-icon"><ShoppingCart /></span><div><h3>Lista de reposição</h3><p>Prioridades calculadas pelo estoque mínimo.</p></div></div><span className="insight-actions">{lowItems.length > 0 && <a className="whatsapp-text-link" href={whatsappRestockUrl} target="_blank" rel="noopener noreferrer" aria-label="Enviar lista por WhatsApp" title="Enviar por WhatsApp"><WhatsAppIcon size={14} /><span className="action-label">WhatsApp</span></a>}<a href="/api/export?type=restock" download aria-label="Exportar itens para compra" title="Exportar itens"><FileDown size={14} /><span className="action-label">Exportar itens</span></a><button aria-label="Ver itens no estoque" title="Ver no estoque" onClick={() => { setFilter("low"); document.querySelector(".section-heading")?.scrollIntoView({ behavior: "smooth" }); }}><Search size={14} /><span className="action-label">Ver no estoque</span></button></span></div>
                  {lowItems.length ? <div className="restock-list">{lowItems.slice(0,4).map((item) => {
                    const total = item.unopenedQty + item.openedQty;
                    return <div key={item.id}><ItemVisual item={item} /><div><strong>{item.name}</strong><small>{fmt(total)} {item.unit} disponíveis</small></div></div>;
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

              <div className="section-heading"><div><h2>Itens do estoque</h2><p>Acompanhe o que está fechado, aberto e próximo de acabar.</p></div><div className="section-actions">{lowItems.length > 0 && <a className="secondary-button whatsapp-button" href={whatsappRestockUrl} target="_blank" rel="noopener noreferrer" aria-label="Enviar lista por WhatsApp" title="Enviar por WhatsApp"><WhatsAppIcon size={17} /> Enviar por WhatsApp</a>}<a className="secondary-button restock-export" href="/api/export?type=restock" download aria-label="Exportar itens para compra" title="Exportar itens para compra"><FileDown size={17} /> Exportar itens para compra{lowItems.length > 0 && <b>{lowItems.length}</b>}</a><button className="secondary-button" aria-label="Registrar compra" title="Registrar compra" disabled={!permissions.registerPurchases} onClick={() => setModal({ kind: "movement", type: "purchase" })}><Plus size={17} /> Registrar compra</button></div></div>

              <div className="toolbar">
                <label className="search"><Search size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar item ou categoria..." /></label>
                <button className="secondary-button scan-button" onClick={() => setModal({ kind: "scanner" })}><QrCode size={17} /> Ler código</button>
                <div className="filters">
                  <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>Todos</button>
                  <button className={filter === "open" ? "active" : ""} onClick={() => setFilter("open")}>Abertos</button>
                  <button className={filter === "low" ? "active" : ""} onClick={() => setFilter("low")}>Baixo estoque {lowItems.length > 0 && <b>{lowItems.length}</b>}</button>
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
          ) : tab === "schedule" ? <ScheduleView schedule={schedule} loading={loading} canEdit={permissions.manageSchedule} onNewTeam={() => setModal({ kind: "supportTeam" })} onEditTeam={(team) => setModal({ kind: "supportTeam", team })} onNewWeek={() => setModal({ kind: "supportWeek" })} onEditWeek={(week) => setModal({ kind: "supportWeek", week })} onGenerate={() => setModal({ kind: "generateWeeks" })} /> :tab === "planning" ? <PlanningView items={items} loading={loading} /> : tab === "reports" ? <ReportsView /> : tab === "tasks" ? <TasksView openRequest={taskToOpen} onOpenRequestHandled={clearTaskToOpen} /> : tab === "people" ? <PeopleView /> : tab === "projects" ? <ProjectsView onOpenTask={openTask} /> : tab === "panel" ? <LeadershipView onOpenTask={openTask} onOpenProjects={() => setTab("projects")} /> : tab === "tickets" ? <TicketsView openRequest={ticketToOpen} onOpenRequestHandled={clearTicketToOpen} onOpenTask={openTask} onOpenArticle={(articleId) => openKnowledge({ articleId })} onSaveSolution={(draft) => openKnowledge({ draft })} /> : tab === "knowledge" ? <KnowledgeView openRequest={articleToOpen} draft={articleDraft} onRequestHandled={clearArticleRequest} onOpenTicket={openTicket} /> :tab === "team" ? <TeamView members={members} currentUser={currentUser} saving={saving} onAddMember={() => setModal({ kind: "member" })} onEditMember={(member) => setModal({ kind: "member", member })} onDeleteMember={deleteMember} onUpdateRole={(userId, role) => submit({ action: "updateMemberRole", userId, role }, "Permissão atualizada.")} onUpdateActive={(userId, active) => submit({ action: "updateMemberActive", userId, active }, active ? "Acesso reativado." : "Acesso desativado.")} /> : <HistoryView movements={movements} loading={loading} />}
        </section>
      </main>

      {mobileMenu && <button className="backdrop menu-backdrop" onClick={() => setMobileMenu(false)} aria-label="Fechar menu" />}
      {modal && <Modal state={modal} items={items} schedule={schedule} currentUser={currentUser} saving={saving} onClose={() => { setModal(null); setError(""); }} onSubmit={submit} onScanItem={(item) => setModal({ kind: "movement", type: item.openedQty > 0 ? "consume" : "open", item })} />}
    </div>
  );
}

function greeting() {
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/Sao_Paulo" }).format(new Date()));
  return hour < 12 ? "BOM DIA" : hour < 18 ? "BOA TARDE" : "BOA NOITE";
}

/** "Terça-feira, 10 de novembro": só a primeira letra maiúscula. */
function todayLong() {
  const text = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long", timeZone: "America/Sao_Paulo" }).format(new Date());
  return text.charAt(0).toLocaleUpperCase("pt-BR") + text.slice(1);
}

function HubView({ items, movements, schedule, currentUser, isAdmin, onOpen, onOpenTask, onOpenTicket }: { items: Item[]; movements: Movement[]; schedule: Schedule; currentUser: CurrentUser | null; isAdmin: boolean; onOpen: (destination: "stock" | "schedule" | "people" | "team") => void; onOpenTask: (taskId?: number) => void; onOpenTicket: (ticketId?: number) => void }) {
  const today = isoDateInSaoPaulo();
  const currentWeek = supportWeekForDate(schedule.weeks, today);
  const nextWeek = nextSupportWeek(schedule.weeks, today);
  const featuredWeek = currentWeek ?? nextWeek;
  const featuredTeam = featuredWeek ? findTeam(schedule, featuredWeek.teamId) : null;
  const whatsappMessage = scheduleWhatsAppMessage(schedule.teams, schedule.weeks, today);
  const lowItems = items.filter((item) => item.unopenedQty + item.openedQty <= itemReorderPoint(item));
  const openItems = items.filter((item) => item.openedQty > 0);
  const firstName = currentUser?.name.split(/\s+/)[0] || "Equipe";
  const away = useAbsences();
  const outToday = splitAbsences(away.absences, today).now;
  const nameOf = (id: number) => away.people.find((person) => person.id === id)?.name ?? "";

  return <>
    <section className="hub-welcome">
      <div><p className="eyebrow">{greeting()}, {firstName.toLocaleUpperCase("pt-BR")}</p><h2>O que você precisa hoje?</h2><p>Suas demandas, os chamados do seu time, a escala e o estoque da copa, num só lugar.</p></div>
      <span>{todayLong()}</span>
    </section>

    <div className="hub-modules">
      <article className="hub-module-card inventory-module">
        <div className="hub-module-head"><span><Archive /></span><div><small>MÓDULO</small><h2>Estoque</h2></div></div>
        <p>Itens, compras, consumo, planejamento e histórico em uma área exclusiva.</p>
        <div className="hub-module-metrics"><div><strong>{items.length}</strong><span>itens</span></div><div><strong>{openItems.length}</strong><span>em uso</span></div><div className={lowItems.length ? "attention" : ""}><strong>{lowItems.length}</strong><span>para repor</span></div></div>
        <button onClick={() => onOpen("stock")}>Abrir módulo de estoque <span>→</span></button>
      </article>
      <article className={`hub-module-card schedule-module ${featuredTeam?.color ?? "purple"}`}>
        <div className="hub-module-head"><span><CalendarClock /></span><div><small>MÓDULO</small><h2>Escala</h2></div></div>
        {featuredTeam && featuredWeek ? <><p>{currentWeek ? "Equipe responsável hoje" : "Próxima equipe programada"}</p><div className="hub-support-team"><strong>{featuredTeam.name}</strong><span>{featuredTeam.members.join(" · ")}</span><small>{weekLabel(featuredWeek)}</small></div></> : <p>Consulte as equipes e os próximos períodos de atendimento.</p>}
        {outToday.length > 0 && <p className="hub-away"><CalendarOff size={13} /> <span><b>Fora hoje:</b> {outToday.map((absence) => `${nameOf(absence.memberId)} (${describeAbsence(absence, today).toLowerCase()})`).join(", ")}</span></p>}
        {whatsappMessage && <a className="hub-whatsapp" href={whatsappUrl(whatsappMessage)} target="_blank" rel="noopener noreferrer"><WhatsAppIcon size={15} /> Enviar escala no WhatsApp</a>}
        <button onClick={() => onOpen("schedule")}>Abrir escala de atendimento <span>→</span></button>
      </article>
    </div>

    <NoticeBoard />

    <div className="hub-work-grid">
      <MyTasksPanel onOpen={onOpenTask} />
      <MyTicketsPanel onOpen={onOpenTicket} />
    </div>

    <div className="hub-bottom-grid">
      <article className="hub-activity">
        <div className="hub-panel-title"><div><span><History /></span><div><h3>Últimas movimentações</h3><p>Atividade recente do estoque</p></div></div><button onClick={() => onOpen("stock")}>Ver estoque</button></div>
        {movements.length ? movements.slice(0, 3).map((movement) => <div className="hub-activity-row" key={movement.id}><span>{movementCopy[movement.type].label.slice(0,1)}</span><div><strong>{movementCopy[movement.type].label} · {movement.itemName}</strong><small>{movement.createdByName || "Equipe"} · {exactDate(movement.createdAt)}</small></div><b>{fmt(Math.abs(movement.quantity))} {movement.unit}</b></div>) : <div className="hub-empty-row"><History /><span><strong>Nenhuma movimentação ainda</strong><small>As atualizações do estoque aparecerão aqui.</small></span></div>}
      </article>
      <article className="hub-internal-card">
        <span><Users /></span><div><small>{APP_TAGLINE.toLocaleUpperCase("pt-BR")}</small><h3>Pessoas e times</h3><p>Veja quem é quem, de qual time e como falar com cada pessoa. Cada um usa sua própria conta, e as ações ficam registradas.</p><div className="hub-internal-actions"><button onClick={() => onOpen("people")}>Ver pessoas</button>{isAdmin && <button onClick={() => onOpen("team")}>Gerenciar usuários</button>}</div></div>
      </article>
    </div>
  </>;
}

function isoDateInSaoPaulo(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function scheduleDate(value: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("pt-BR", { ...options, timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

function weekLabel(week: Pick<SupportWeek, "start" | "end">) {
  const start = scheduleDate(week.start, { day: "2-digit", month: "short" }).replaceAll(".", "");
  const end = scheduleDate(week.end, { day: "2-digit", month: "short" }).replaceAll(".", "");
  return `${start} a ${end}`;
}

function whatsappUrl(message: string) {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

function findTeam(schedule: Schedule, teamId: number) {
  return schedule.teams.find((team) => team.id === teamId) ?? null;
}

function scheduleRangeLabel(weeks: SupportWeek[]) {
  if (!weeks.length) return "";
  const first = weeks[0].start;
  const last = weeks.at(-1)!.end;
  const month = (value: string) => scheduleDate(value, { month: "short" }).replace(".", "").toLocaleUpperCase("pt-BR");
  const firstYear = first.slice(0, 4);
  const lastYear = last.slice(0, 4);
  return firstYear === lastYear ? `${month(first)}–${month(last)} ${lastYear}` : `${month(first)} ${firstYear} – ${month(last)} ${lastYear}`;
}

function ScheduleView({ schedule, loading, canEdit, onNewTeam, onEditTeam, onNewWeek, onEditWeek, onGenerate }: { schedule: Schedule; loading: boolean; canEdit: boolean; onNewTeam: () => void; onEditTeam: (team: SupportTeam) => void; onNewWeek: () => void; onEditWeek: (week: SupportWeek) => void; onGenerate: () => void }) {
  const [showPast, setShowPast] = useState(false);
  const away = useAbsences();
  if (loading) return <LoadingRows />;
  const today = isoDateInSaoPaulo();
  // Quem da equipe estará de férias/folga no período da semana.
  const absentIn = (week: Pick<SupportWeek, "start" | "end">, team: SupportTeam) => absentInSchedule(team.members, away.people, away.absences, week.start, week.end);
  const weeks = [...schedule.weeks].sort((a, b) => a.start.localeCompare(b.start));
  const currentWeek = supportWeekForDate(weeks, today);
  const nextWeek = nextSupportWeek(weeks, today);
  const highlightedWeek = currentWeek ?? nextWeek ?? weeks.at(-1) ?? null;
  const highlightedTeam = highlightedWeek ? findTeam(schedule, highlightedWeek.teamId) : null;
  const whatsappMessage = scheduleWhatsAppMessage(schedule.teams, weeks, today);
  const pastWeeks = weeks.filter((week) => week.end < today);
  const visibleWeeks = showPast ? weeks : weeks.filter((week) => week.end >= today);

  return (
    <>
      {canEdit && <div className="schedule-toolbar">
        <div><strong>Edição da escala</strong><small>As mudanças aparecem para toda a equipe na hora.</small></div>
        <div className="schedule-toolbar-actions">
          <button className="secondary-button" onClick={onNewTeam}><UserPlus size={16} /> Nova equipe</button>
          <button className="secondary-button" disabled={!schedule.teams.length} onClick={onGenerate}><Sparkles size={16} /> Gerar semanas</button>
          <button className="primary-button" disabled={!schedule.teams.length} onClick={onNewWeek}><Plus size={16} /> Nova semana</button>
        </div>
      </div>}

      {highlightedWeek && highlightedTeam ? <section className={`schedule-hero ${highlightedTeam.color}`}>
        <div className="schedule-hero-copy">
          <p className="eyebrow">{currentWeek ? "ATENDIMENTO DE HOJE" : nextWeek ? "PRÓXIMO ATENDIMENTO" : "ÚLTIMO PERÍODO DA ESCALA"}</p>
          <h2>{highlightedTeam.name}</h2>
          <p>{currentWeek ? `Responsável pela semana de ${weekLabel(highlightedWeek)}.` : nextWeek ? `A próxima escala começa em ${scheduleDate(highlightedWeek.start, { weekday: "long", day: "2-digit", month: "long" })}.` : `A escala cadastrada terminou em ${scheduleDate(highlightedWeek.end, { day: "2-digit", month: "long" })}. Cadastre as próximas semanas.`}</p>
          {highlightedWeek.note && <p className="schedule-hero-note">{highlightedWeek.note}</p>}
          <div className="schedule-member-list">{highlightedTeam.members.map((member) => <span key={member}>{member}</span>)}</div>
          {absentIn(highlightedWeek, highlightedTeam).map(({ name, absence }) => <p key={name} className="schedule-away"><CalendarOff size={14} /> {name}: {describeAbsence(absence, today).toLowerCase()}. Combine quem cobre.</p>)}
          {whatsappMessage && <a className="secondary-button whatsapp-button schedule-whatsapp" href={whatsappUrl(whatsappMessage)} target="_blank" rel="noopener noreferrer"><WhatsAppIcon size={17} /> Enviar escala no WhatsApp</a>}
        </div>
        <div className="schedule-hero-date"><CalendarClock /><small>{currentWeek ? "Semana atual" : nextWeek ? "Próxima semana" : "Último período"}</small><strong>{weekLabel(highlightedWeek)}</strong><span>Escala {highlightedWeek.start.slice(0, 4)}</span></div>
      </section> : <div className="empty-state"><span><CalendarClock /></span><h3>Nenhuma semana cadastrada</h3><p>{canEdit ? (schedule.teams.length ? "Cadastre uma semana ou gere várias de uma vez com o rodízio das equipes." : "Comece criando as equipes de atendimento.") : "A escala ainda não foi preenchida. Fale com um administrador."}</p></div>}

      {schedule.teams.length > 0 && <div className="schedule-teams">
        {schedule.teams.map((team) => <article key={team.id} className={`schedule-team-card ${team.color}`}>
          <div><span className="schedule-team-dot" /><div><small>Time de atendimento</small><strong>{team.name}</strong></div>{canEdit && <button className="schedule-edit-button" onClick={() => onEditTeam(team)} aria-label={`Editar ${team.name}`} title="Editar equipe"><Pencil size={14} /></button>}</div>
          <ul>{team.members.map((member) => <li key={member}>{member}</li>)}</ul>
        </article>)}
      </div>}

      {weeks.length > 0 && <>
        <div className="section-heading schedule-title"><div><h2>{showPast ? "Todas as semanas" : "Próximas semanas"}</h2><p>Dias fora dos períodos cadastrados ficam sem atendimento.</p></div><div className="schedule-title-actions">{pastWeeks.length > 0 && <button className="schedule-past-toggle" onClick={() => setShowPast((value) => !value)}>{showPast ? "Ocultar concluídas" : `Ver concluídas (${pastWeeks.length})`}</button>}<span className="schedule-year">{scheduleRangeLabel(weeks)}</span></div></div>
        {visibleWeeks.length ? <div className="schedule-weeks">
          {visibleWeeks.map((week) => {
            const team = findTeam(schedule, week.teamId);
            const state = week.id === currentWeek?.id ? "current" : week.end < today ? "past" : "upcoming";
            return <article key={week.id} className={`schedule-week ${team?.color ?? "purple"} ${state}`}>
              <div className="schedule-week-date"><small>{scheduleDate(week.start, { month: "short" }).replace(".", "")}</small><strong>{scheduleDate(week.start, { day: "2-digit" })}</strong></div>
              <div><span>{state === "current" ? "Esta semana" : state === "past" ? "Concluída" : "Programada"}</span><h3>{team?.name ?? "Equipe removida"}</h3><p>{weekLabel(week)}{week.note ? ` · ${week.note}` : ""}</p></div>
              <div className="schedule-week-side">
                <div className="schedule-week-members">{team?.members.map((member) => { const out = absentIn(week, team).find((entry) => entry.name === member); return <span key={member} className={out ? "away" : ""} title={out ? describeAbsence(out.absence, today) : undefined}>{member}{out && <CalendarOff size={11} />}</span>; })}</div>
                {canEdit && <button className="schedule-edit-button" onClick={() => onEditWeek(week)} aria-label={`Editar semana de ${weekLabel(week)}`} title="Editar semana"><Pencil size={14} /></button>}
              </div>
            </article>;
          })}
        </div> : <div className="empty-state compact"><CalendarClock /><h3>Nenhuma semana futura</h3><p>{canEdit ? "Use “Gerar semanas” para continuar o rodízio." : "As próximas semanas ainda não foram cadastradas."}</p></div>}
      </>}
    </>
  );
}

function StockRow({ item, permissions, onAction, onEdit, onDelete }: { item: Item; permissions: MemberPermissions; onAction: (type: Movement["type"]) => void; onEdit: () => void; onDelete: () => void }) {
  const total = item.unopenedQty + item.openedQty;
  const isLow = total <= itemReorderPoint(item);
  return (
    <article className="stock-row">
      <div className="item-cell"><ItemVisual item={item} /><div><strong>{item.name}</strong><small>{item.category} · mínimo {fmt(item.minimumQty)} {item.unit}</small></div></div>
      <div className="balance-cell"><strong>{fmt(total)} <small>{item.unit}</small></strong><div><span>{fmt(item.unopenedQty)} fechado</span><i /> <span>{fmt(item.openedQty)} aberto</span></div></div>
      <div><span className={`status ${isLow ? "low" : "ok"}`}>{isLow ? <TriangleAlert size={14} /> : <PackageCheck size={14} />}{isLow ? "Repor" : "Em dia"}</span></div>
      <div className="duration-cell">{item.analytics.averageDurationDays !== null ? <><strong>{fmt(item.analytics.averageDurationDays)} dias</strong><small>{item.analytics.monthlyRecommendation} {item.unit}/30 dias</small></> : item.analytics.activeDays !== null ? <><strong>Em medição</strong><small>Há {fmt(item.analytics.activeDays)} dias</small></> : <><strong>Sem histórico</strong><small>Registre abertura e consumo</small></>}</div>
      <div className="opened-cell"><strong>{relativeDate(item.lastOpenedAt)}</strong>{item.lastOpenedAt && <small>{new Intl.DateTimeFormat("pt-BR").format(new Date(item.lastOpenedAt))}</small>}</div>
      <div className="row-actions">
        <details className="mobile-movement-menu">
          <summary aria-label={`Movimentações de ${item.name}`} title="Movimentações"><Ellipsis size={19} /></summary>
          <div className="mobile-movement-popover">
            <button type="button" disabled={!permissions.openItems || item.unopenedQty <= 0} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); onAction("open"); }}><PackageOpen size={17} /><span>Abrir produto</span></button>
            <button type="button" disabled={!permissions.consumeItems || item.openedQty <= 0} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); onAction("consume"); }}><TrendingDown size={17} /><span>Registrar consumo</span></button>
            <button type="button" disabled={!permissions.registerPurchases} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); onAction("purchase"); }}><Plus size={17} /><span>Registrar compra</span></button>
          </div>
        </details>
        <button className="desktop-movement-action" title="Registrar abertura" disabled={!permissions.openItems || item.unopenedQty <= 0} onClick={() => onAction("open")}><PackageOpen size={17} /></button>
        <button className="desktop-movement-action" title="Registrar consumo" disabled={!permissions.consumeItems || item.openedQty <= 0} onClick={() => onAction("consume")}><TrendingDown size={17} /></button>
        <button className="desktop-movement-action" title="Registrar compra" disabled={!permissions.registerPurchases} onClick={() => onAction("purchase")}><ShoppingCart size={17} /></button>
        <button title="Ajustar saldo" disabled={!permissions.adjustStock} onClick={() => onAction("adjust")}><Settings2 size={17} /></button>
        <button title="Editar item" disabled={!permissions.manageItems} onClick={onEdit}><Pencil size={16} /></button>
        <button className="danger-action" title="Excluir item" aria-label={`Excluir ${item.name}`} disabled={!permissions.manageItems} onClick={onDelete}><Trash2 size={16} /></button>
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
              <div className="planning-card-head"><ItemVisual item={item} /><div><strong>{item.name}</strong><small>{item.category} · {item.unit}</small></div><span className={`measure-badge ${measuredItem ? "ready" : "waiting"}`}>{measuredItem ? "Calculado" : "Em medição"}</span></div>
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

function TeamView({ members, currentUser, saving, onAddMember, onEditMember, onDeleteMember, onUpdateRole, onUpdateActive }: { members: Member[]; currentUser: CurrentUser | null; saving: boolean; onAddMember: () => void; onEditMember: (member: Member) => void; onDeleteMember: (member: Member) => void; onUpdateRole: (userId: string, role: MemberRole) => void; onUpdateActive: (userId: string, active: boolean) => void }) {
  return (
    <>
      <div className="team-intro">
        <span className="team-intro-icon"><Users /></span>
        <div><p className="eyebrow">ACESSO INDIVIDUAL</p><h2>Usuários e permissões</h2><p>Cada pessoa entra com sua própria conta, e tudo o que ela faz fica registrado no nome dela. Cargo, telefone e times ficam na área Pessoas.</p></div>
      </div>
      <div className="permission-cards">
        <article><strong>Administrador</strong><p>Acesso total: cria usuários, monta os times, edita a escala, atende qualquer chamado e pode excluir demandas e chamados.</p></article>
        <article><strong>Membro</strong><p>Cria e edita demandas, abre chamados e atende os do seu time. No estoque e na escala, faz o que o administrador liberar.</p></article>
        <article><strong>Somente leitura</strong><p>Consulta demandas, chamados, escala, estoque e pessoas, sem alterar nada.</p></article>
      </div>
      <div className="team-panel">
        <div className="section-heading team-heading"><div><h2>Usuários cadastrados</h2><p>Crie o usuário e a senha inicial e escolha o perfil. As permissões extras do estoque e da escala ficam na aba Permissões de cada pessoa.</p></div><div className="team-heading-actions"><span>{members.length} {members.length === 1 ? "usuário" : "usuários"}</span><button className="secondary-button" onClick={onAddMember}><UserPlus size={16} /> Adicionar membro</button></div></div>
        <div className="team-table">
          <div className="team-table-head"><span>Usuário</span><span>Permissão</span><span>Status</span><span>Entrada</span><span>Ações</span></div>
          {members.map((member) => <div className="team-row" key={member.userId}>
            <div className="member-cell"><MemberVisual member={member} /><div><strong>{member.name}</strong><small>@{member.username || "acesso-pendente"} · {member.email}{member.userId === currentUser?.userId ? " · você" : ""}</small></div></div>
            <select aria-label={`Permissão de ${member.name}`} disabled={saving || member.userId === currentUser?.userId} value={member.role} onChange={(event) => onUpdateRole(member.userId, event.target.value as MemberRole)}><option value="admin">Administrador</option><option value="member">Membro</option><option value="viewer">Somente leitura</option></select>
            <button className={`access-toggle ${member.active ? "active" : "inactive"}`} disabled={saving || member.userId === currentUser?.userId} onClick={() => onUpdateActive(member.userId, !member.active)}>{member.active ? "Ativo" : "Desativado"}</button>
            <span className="member-date">{new Intl.DateTimeFormat("pt-BR").format(new Date(member.createdAt))}</span>
            <div className="member-actions"><button className="member-edit" disabled={member.userId === currentUser?.userId} onClick={() => onEditMember(member)} aria-label={`Editar ${member.name}`} title={member.userId === currentUser?.userId ? "Use Meu perfil" : "Editar membro"}><Pencil size={15} /></button><button className="member-delete" disabled={member.userId === currentUser?.userId} onClick={() => onDeleteMember(member)} aria-label={`Excluir ${member.name}`} title="Excluir membro"><Trash2 size={15} /></button></div>
          </div>)}
        </div>
        <p className="team-access-note">O usuário e a senha dão acesso ao sistema. As permissões são verificadas novamente pelo servidor em cada operação.</p>
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

function nextMondayAfter(isoDate: string) {
  const weekday = new Date(`${isoDate}T12:00:00Z`).getUTCDay();
  return addDays(isoDate, ((8 - weekday) % 7) || 7);
}

/** Sugere o próximo período e a próxima equipe a partir do fim da escala atual. */
function scheduleSuggestion(schedule: Schedule) {
  const today = isoDateInSaoPaulo();
  const last = [...schedule.weeks].sort((a, b) => a.start.localeCompare(b.start)).at(-1);
  const base = last && last.end >= today ? last.end : addDays(today, -1);
  const start = nextMondayAfter(base);
  const lastTeamIndex = last ? schedule.teams.findIndex((team) => team.id === last.teamId) : -1;
  const nextTeam = schedule.teams[(lastTeamIndex + 1) % Math.max(1, schedule.teams.length)];
  return { start, end: addDays(start, 4), teamId: nextTeam?.id ?? 0 };
}

function SupportTeamFields({ name, setName, color, setColor, membersText, setMembersText }: { name: string; setName: (value: string) => void; color: SupportTeamColor; setColor: (value: SupportTeamColor) => void; membersText: string; setMembersText: (value: string) => void }) {
  const preview = normalizeTeamMembers(membersText.split(/\n|,/));
  return <>
    <label className="full"><span>Nome da equipe</span><input autoFocus required maxLength={40} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Equipe Azul" /></label>
    <div className="full team-color-field"><span className="field-label">Cor</span><div className="team-color-options">{supportTeamColors.map((option) => <button type="button" key={option} className={`team-color-swatch ${option} ${color === option ? "active" : ""}`} onClick={() => setColor(option)} aria-pressed={color === option}><i />{supportTeamColorLabels[option]}</button>)}</div></div>
    <label className="full"><span>Integrantes</span><textarea required value={membersText} onChange={(event) => setMembersText(event.target.value)} placeholder={"Um nome por linha\nEx.: Ana Souza\nBruno Lima"} rows={5} /><small>{preview.length ? `${preview.length} ${preview.length === 1 ? "integrante" : "integrantes"}: ${preview.join(" · ")}` : "Escreva um nome por linha (ou separe por vírgula)."}</small></label>
  </>;
}

function Modal({ state, items, schedule, currentUser, saving, onClose, onSubmit, onScanItem }: { state: NonNullable<ModalState>; items: Item[]; schedule: Schedule; currentUser: CurrentUser | null; saving: boolean; onClose: () => void; onSubmit: (payload: Record<string, unknown>, success: string) => Promise<string | null>; onScanItem: (item: Item) => void }) {
  const editingTeam = state.kind === "supportTeam" ? state.team : undefined;
  const editingWeek = state.kind === "supportWeek" ? state.week : undefined;
  const suggestion = useMemo(() => scheduleSuggestion(schedule), [schedule]);
  const [teamName, setTeamName] = useState(editingTeam?.name ?? "");
  const [teamColor, setTeamColor] = useState<SupportTeamColor>(editingTeam?.color ?? supportTeamColors.find((color) => !schedule.teams.some((team) => team.color === color)) ?? "purple");
  const [teamMembersText, setTeamMembersText] = useState(editingTeam?.members.join("\n") ?? "");
  const [weekStart, setWeekStart] = useState(editingWeek?.start ?? suggestion.start);
  const [weekEnd, setWeekEnd] = useState(editingWeek?.end ?? suggestion.end);
  const [weekTeamId, setWeekTeamId] = useState(String(editingWeek?.teamId ?? suggestion.teamId));
  const [weekNote, setWeekNote] = useState(editingWeek?.note ?? "");
  const [generateStart, setGenerateStart] = useState(suggestion.start);
  const [generateCount, setGenerateCount] = useState("8");
  const [generateDays, setGenerateDays] = useState("5");
  const [generateFirstTeam, setGenerateFirstTeam] = useState(String(suggestion.teamId));
  const [generateTeamIds, setGenerateTeamIds] = useState<number[]>(schedule.teams.map((team) => team.id));
  const rotationTeamIds = useMemo(() => {
    const ordered = schedule.teams.map((team) => team.id).filter((id) => generateTeamIds.includes(id));
    const firstIndex = Math.max(0, ordered.indexOf(Number(generateFirstTeam)));
    return [...ordered.slice(firstIndex), ...ordered.slice(0, firstIndex)];
  }, [schedule.teams, generateTeamIds, generateFirstTeam]);
  const generatedPreview = useMemo(() => state.kind === "generateWeeks" ? generateRotation(generateStart, Number(generateCount), rotationTeamIds, Number(generateDays)).map((week) => ({ ...week, conflict: findOverlappingWeek(schedule.weeks, week) })) : [], [state.kind, generateStart, generateCount, generateDays, rotationTeamIds, schedule.weeks]);
  const weekConflict = state.kind === "supportWeek" && !weekRangeError(weekStart, weekEnd) ? findOverlappingWeek(schedule.weeks, { start: weekStart, end: weekEnd }, editingWeek?.id) : null;
  const editing = state.kind === "item" ? state.item : undefined;
  const editingMember = state.kind === "member" ? state.member : undefined;
  const preselected = state.kind === "movement" ? state.item : undefined;
  const [itemId, setItemId] = useState(String(preselected?.id ?? items[0]?.id ?? ""));
  const [name, setName] = useState(editing?.name ?? "");
  const [category, setCategory] = useState(editing?.category ?? "");
  const [unit, setUnit] = useState(editing?.unit ?? "");
  const [minimumQty, setMinimumQty] = useState(String(editing?.minimumQty ?? 2));
  const [scanCode, setScanCode] = useState(editing?.scanCode ?? "");
  const [itemIcon, setItemIcon] = useState(editing?.icon ?? "📦");
  const [itemImageKey, setItemImageKey] = useState<string | null>(editing?.imageKey ?? null);
  const [itemVisualMode, setItemVisualMode] = useState<"icon" | "image">(editing?.imageKey ? "image" : "icon");
  const [itemFile, setItemFile] = useState<File | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [occurredAt, setOccurredAt] = useState("");
  const maximumMovementDate = useMemo(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
  }, []);
  const selected = items.find((item) => item.id === Number(itemId));
  const [unopenedQty, setUnopenedQty] = useState(String(preselected?.unopenedQty ?? selected?.unopenedQty ?? 0));
  const [openedQty, setOpenedQty] = useState(String(preselected?.openedQty ?? selected?.openedQty ?? 0));
  const [note, setNote] = useState("");
  const profile = state.kind === "profile" ? currentUser : null;
  const [memberName, setMemberName] = useState(editingMember?.name ?? profile?.name ?? "");
  const [memberEmail, setMemberEmail] = useState(editingMember?.email ?? profile?.email ?? "");
  const [memberUsername, setMemberUsername] = useState(editingMember?.username ?? profile?.username ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [memberPassword, setMemberPassword] = useState("");
  const [memberRole, setMemberRole] = useState<MemberRole>(editingMember?.role ?? profile?.role ?? "member");
  const [memberPermissions, setMemberPermissions] = useState<MemberPermissions>(editingMember?.permissions ?? profile?.permissions ?? permissionPresets.member);
  const [memberActive, setMemberActive] = useState(editingMember?.active ?? true);
  const [memberTab, setMemberTab] = useState<"general" | "permissions">("general");
  const [avatarIcon, setAvatarIcon] = useState(editingMember?.avatarIcon ?? profile?.avatarIcon ?? "👤");
  const [avatarKey] = useState<string | null>(editingMember?.avatarKey ?? profile?.avatarKey ?? null);
  const [avatarMode, setAvatarMode] = useState<"icon" | "image">((editingMember?.avatarKey ?? profile?.avatarKey) ? "image" : "icon");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [profileExtra, setProfileExtra] = useState<{ memberId: number; jobTitle: string; phone: string; teams: { name: string; color: string; isLead: boolean }[] } | null>(null);

  // Cargo, telefone e times vêm da área Pessoas.
  useEffect(() => {
    if (state.kind !== "profile") return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/people", { cache: "no-store" });
        if (!response.ok) return;
        const people = await response.json() as { people: { id: number; jobTitle: string; phone: string }[]; teams: { name: string; color: string; members: { memberId: number; isLead: boolean }[] }[]; me: { id: number } };
        const mine = people.people.find((person) => person.id === people.me.id);
        if (!cancelled && mine) setProfileExtra({
          memberId: mine.id,
          jobTitle: mine.jobTitle,
          phone: mine.phone,
          teams: people.teams.flatMap((team) => team.members.filter((row) => row.memberId === mine.id).map((row) => ({ name: team.name, color: team.color, isLead: row.isLead }))),
        });
      } catch { /* sem a área Pessoas, o perfil continua funcionando */ }
    })();
    return () => { cancelled = true; };
  }, [state.kind]);
  const [formError, setFormError] = useState("");
  const [scannerCode, setScannerCode] = useState("");
  const [scannerMessage, setScannerMessage] = useState("Aponte a câmera para um código de barras ou QR Code.");
  const [scannerSupported, setScannerSupported] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (state.kind !== "scanner") return;
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    const start = async () => {
      const Detector = (window as unknown as { BarcodeDetector?: new (options: { formats: string[] }) => { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
      if (!Detector) {
        setScannerSupported(false);
        setScannerMessage("Leitura automática não disponível neste navegador. Digite o código abaixo.");
        return;
      }
      setScannerSupported(true);
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (!videoRef.current || stopped) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const detector = new Detector({ formats: ["qr_code", "ean_13", "ean_8", "code_128", "upc_a", "upc_e"] });
        const scan = async () => {
          if (stopped || !videoRef.current) return;
          try { const codes = await detector.detect(videoRef.current); if (codes[0]?.rawValue) { setScannerCode(codes[0].rawValue); setScannerMessage("Código encontrado."); return; } } catch { /* tenta novamente */ }
          timer = window.setTimeout(scan, 350);
        };
        void scan();
      } catch { setScannerSupported(false); setScannerMessage("Não foi possível abrir a câmera. Digite o código abaixo."); }
    };
    void start();
    return () => { stopped = true; window.clearTimeout(timer); stream?.getTracks().forEach((track) => track.stop()); };
  }, [state.kind]);

  const title = state.kind === "supportTeam" ? (editingTeam ? "Editar equipe" : "Nova equipe") : state.kind === "supportWeek" ? (editingWeek ? "Editar semana" : "Nova semana") : state.kind === "generateWeeks" ? "Gerar semanas" : state.kind === "profile" ? "Meu perfil" : state.kind === "member" ? (editingMember ? "Editar membro" : "Adicionar membro") : state.kind === "item" ? (editing ? "Editar item" : "Novo item") : state.kind === "scanner" ? "Ler código do item" : movementCopy[state.type].label;
  const description = state.kind === "supportTeam" ? "Defina o nome, a cor e quem faz parte desta equipe de atendimento." : state.kind === "supportWeek" ? "Escolha o período e a equipe responsável pelo atendimento." : state.kind === "generateWeeks" ? "Crie várias semanas de uma vez, alternando as equipes na ordem escolhida." : state.kind === "profile" ? "Atualize seus dados de acesso e como você aparece nos registros." : state.kind === "member" ? (editingMember ? "Atualize os dados, redefina a senha e ajuste as permissões deste usuário." : "Crie o usuário, a senha inicial e escolha exatamente o que a pessoa poderá fazer.") : state.kind === "item" ? "Edite os dados, a aparência e o código de leitura do item." : state.kind === "scanner" ? "Use a câmera ou digite o código para localizar rapidamente um produto." : {
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

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    try {
      setFormError("");
      setUploading(true);
      if (state.kind === "supportTeam") {
        const teamMembers = normalizeTeamMembers(teamMembersText.split(/\n|,/));
        if (!teamMembers.length) throw new Error("Adicione pelo menos um integrante à equipe.");
        const submissionError = await onSubmit({ action: "saveSupportTeam", teamId: editingTeam?.id, name: teamName, color: teamColor, members: teamMembers }, editingTeam ? "Equipe atualizada." : "Equipe criada.");
        if (submissionError) throw new Error(submissionError);
        return;
      }
      if (state.kind === "supportWeek") {
        const rangeError = weekRangeError(weekStart, weekEnd);
        if (rangeError) throw new Error(rangeError);
        const submissionError = await onSubmit({ action: "saveSupportWeek", weekId: editingWeek?.id, start: weekStart, end: weekEnd, teamId: Number(weekTeamId), note: weekNote }, editingWeek ? "Semana atualizada." : "Semana adicionada à escala.");
        if (submissionError) throw new Error(submissionError);
        return;
      }
      if (state.kind === "generateWeeks") {
        if (!rotationTeamIds.length) throw new Error("Escolha pelo menos uma equipe para o rodízio.");
        const submissionError = await onSubmit({ action: "generateSupportWeeks", start: generateStart, count: Number(generateCount), daysPerWeek: Number(generateDays), teamIds: rotationTeamIds }, `${generatedPreview.length} semanas adicionadas à escala.`);
        if (submissionError) throw new Error(submissionError);
        return;
      }
      if (state.kind === "scanner") {
        const found = items.find((item) => item.scanCode && item.scanCode.trim().toLocaleLowerCase("pt-BR") === scannerCode.trim().toLocaleLowerCase("pt-BR"));
        if (!found) throw new Error("Nenhum item cadastrado com este código.");
        onScanItem(found);
        return;
      }
      if (state.kind === "profile" || state.kind === "member") {
        if (state.kind === "member" && !editingMember && !memberPassword) throw new Error("Crie uma senha inicial para o novo membro.");
        const passwordError = memberPassword ? passwordPolicyError(memberPassword) : null;
        if (passwordError) throw new Error(passwordError);
        if (state.kind === "profile" && memberPassword && !currentPassword) throw new Error("Informe sua senha atual para criar uma nova senha.");
        const uploadedAvatarKey = avatarMode === "image" && avatarFile ? await uploadImage(avatarFile, "profile") : avatarMode === "image" ? avatarKey : null;
        let submissionError: string | null;
        if (state.kind === "profile") {
          // Cargo e telefone moram em Pessoas; salva antes, porque o onSubmit fecha a janela.
          if (profileExtra) {
            const response = await fetch("/api/people", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "updatePerson", memberId: profileExtra.memberId, jobTitle: profileExtra.jobTitle, phone: profileExtra.phone }) });
            if (!response.ok) throw new Error(((await response.json()) as { error?: string }).error || "Não foi possível salvar cargo e telefone.");
          }
          submissionError = await onSubmit({ action: "updateProfile", name: memberName, email: memberEmail, username: memberUsername, currentPassword, password: memberPassword, avatarIcon, avatarKey: uploadedAvatarKey }, "Perfil e acesso atualizados.");
        } else {
          submissionError = await onSubmit({ action: editingMember ? "updateMember" : "addMember", userId: editingMember?.userId, name: memberName, email: memberEmail, username: memberUsername, password: memberPassword, role: memberRole, permissions: memberPermissions, active: memberActive, avatarIcon, avatarKey: uploadedAvatarKey }, editingMember ? "Membro atualizado." : "Membro adicionado.");
        }
        if (submissionError) throw new Error(submissionError);
        return;
      }
      if (state.kind === "item") {
        const uploadedItemKey = itemVisualMode === "image" && itemFile ? await uploadImage(itemFile, "item") : itemVisualMode === "image" ? itemImageKey : null;
        setItemImageKey(uploadedItemKey);
        await onSubmit({ action: editing ? "updateItem" : "addItem", itemId: editing?.id, name, category, unit, minimumQty: Number(minimumQty), scanCode, icon: itemIcon, imageKey: uploadedItemKey }, editing ? "Item atualizado." : "Novo item cadastrado.");
        return;
      }
      const payload: Record<string, unknown> = { action: "movement", type: state.type, itemId: Number(itemId), quantity: Number(quantity), note };
      if (occurredAt) {
        const movementDate = parseMovementDate(occurredAt);
        if (movementDate.error) throw new Error(movementDate.error);
        payload.occurredAt = movementDate.iso;
      }
      if (state.type === "adjust") { payload.unopenedQty = Number(unopenedQty); payload.openedQty = Number(openedQty); }
      await onSubmit(payload, `${movementCopy[state.type].label} registrada.`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Não foi possível salvar.");
    } finally {
      setUploading(false);
    }
  }

  async function handleScheduleDelete() {
    const confirmation = editingTeam ? `Excluir a ${editingTeam.name}? Só é possível quando ela não tem semanas na escala.` : editingWeek ? `Excluir a semana de ${weekLabel(editingWeek)} da escala?` : "";
    if (!confirmation || !window.confirm(confirmation)) return;
    setFormError("");
    const submissionError = editingTeam
      ? await onSubmit({ action: "deleteSupportTeam", teamId: editingTeam.id }, "Equipe excluída.")
      : await onSubmit({ action: "deleteSupportWeek", weekId: editingWeek!.id }, "Semana removida da escala.");
    if (submissionError) setFormError(submissionError);
  }

  const isScheduleModal = state.kind === "supportTeam" || state.kind === "supportWeek" || state.kind === "generateWeeks";
  const generateBlocked = state.kind === "generateWeeks" && (!generatedPreview.length || generatedPreview.some((week) => week.conflict));

  return (
    <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><form className={`modal ${state.kind === "member" ? "member-modal" : ""}`} onSubmit={handleSubmit}>
      <div className="modal-head"><div><p className="eyebrow">{isScheduleModal ? "ESCALA DE ATENDIMENTO" : state.kind === "profile" ? "CONFIGURAÇÕES PESSOAIS" : state.kind === "member" ? "GESTÃO DE ACESSO" : state.kind === "item" ? "CADASTRO EDITÁVEL" : state.kind === "scanner" ? "LEITURA RÁPIDA" : "MOVIMENTAÇÃO DO ESTOQUE"}</p><h2>{title}</h2><p>{description}</p></div><button type="button" onClick={onClose}><X /></button></div>
      {state.kind === "member" && <div className="member-tabs"><button type="button" className={memberTab === "general" ? "active" : ""} onClick={() => setMemberTab("general")}>Geral</button><button type="button" className={memberTab === "permissions" ? "active" : ""} onClick={() => setMemberTab("permissions")}>Permissões</button></div>}
      <div className="form-grid">
        {state.kind === "supportTeam" ? <SupportTeamFields name={teamName} setName={setTeamName} color={teamColor} setColor={setTeamColor} membersText={teamMembersText} setMembersText={setTeamMembersText} /> : state.kind === "supportWeek" ? <>
          <label><span>Início</span><input type="date" required value={weekStart} onChange={(event) => { const value = event.target.value; setWeekStart(value); if (!editingWeek && value && (!weekEnd || weekEnd < value)) setWeekEnd(addDays(value, 4)); }} /></label>
          <label><span>Fim</span><input type="date" required min={weekStart} value={weekEnd} onChange={(event) => setWeekEnd(event.target.value)} /></label>
          <label className="full"><span>Equipe responsável</span><select required value={weekTeamId} onChange={(event) => setWeekTeamId(event.target.value)}>{schedule.teams.map((team) => <option key={team.id} value={team.id}>{team.name} — {team.members.join(", ")}</option>)}</select></label>
          <label className="full"><span>Observação <em>opcional</em></span><input maxLength={140} value={weekNote} onChange={(event) => setWeekNote(event.target.value)} placeholder="Ex.: sem expediente na sexta (feriado)" /><small>Aparece junto do período para toda a equipe.</small></label>
          {weekConflict && <p className="schedule-conflict full"><TriangleAlert size={15} /> Conflita com a semana de {weekLabel(weekConflict)}. Ajuste as datas antes de salvar.</p>}
        </> : state.kind === "generateWeeks" ? <>
          <label><span>Primeira semana começa em</span><input type="date" required value={generateStart} onChange={(event) => setGenerateStart(event.target.value)} /></label>
          <label><span>Quantidade de semanas</span><input type="number" required min="1" max="52" value={generateCount} onChange={(event) => setGenerateCount(event.target.value)} /></label>
          <label><span>Dias de atendimento por semana</span><select value={generateDays} onChange={(event) => setGenerateDays(event.target.value)}>{[1, 2, 3, 4, 5, 6, 7].map((days) => <option key={days} value={days}>{days} {days === 1 ? "dia" : "dias"}{days === 5 ? " (seg. a sex.)" : ""}</option>)}</select></label>
          <label><span>Começar pela equipe</span><select value={generateFirstTeam} onChange={(event) => setGenerateFirstTeam(event.target.value)}>{schedule.teams.filter((team) => generateTeamIds.includes(team.id)).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
          <div className="full generate-teams"><span className="field-label">Equipes no rodízio</span><div>{schedule.teams.map((team) => <label key={team.id} className={`generate-team ${team.color}`}><input type="checkbox" checked={generateTeamIds.includes(team.id)} onChange={(event) => { const checked = event.target.checked; setGenerateTeamIds((current) => checked ? [...current, team.id] : current.filter((id) => id !== team.id)); if (!checked && Number(generateFirstTeam) === team.id) setGenerateFirstTeam(String(schedule.teams.find((other) => other.id !== team.id && generateTeamIds.includes(other.id))?.id ?? "")); }} /><i />{team.name}</label>)}</div></div>
          <div className="full generate-preview"><span className="field-label">Prévia</span>{generatedPreview.length ? <ol>{generatedPreview.map((week) => { const team = findTeam(schedule, week.teamId); return <li key={week.start} className={week.conflict ? "conflict" : ""}><span className={`generate-dot ${team?.color ?? "purple"}`} /><strong>{weekLabel(week)}</strong><small>{team?.name}</small>{week.conflict && <em>conflita com {weekLabel(week.conflict)}</em>}</li>; })}</ol> : <small>Preencha os campos para ver as semanas.</small>}</div>
          {generateBlocked && generatedPreview.length > 0 && <p className="schedule-conflict full"><TriangleAlert size={15} /> Algumas semanas conflitam com a escala atual. Mude a data inicial ou a quantidade.</p>}
        </> : state.kind === "profile" ? <>
          <VisualEditor label="Sua imagem" icons={personIcons} mode={avatarMode} setMode={setAvatarMode} icon={avatarIcon} setIcon={setAvatarIcon} imageKey={avatarKey} file={avatarFile} setFile={setAvatarFile} />
          <label className="full"><span>Nome</span><input autoFocus required value={memberName} onChange={(e) => setMemberName(e.target.value)} placeholder="Ex.: Ana Souza" /></label>
          <label><span>Usuário</span><input required minLength={3} autoCapitalize="none" value={memberUsername} onChange={(e) => setMemberUsername(e.target.value)} placeholder="Ex.: ana" /></label>
          <label><span>E-mail</span><input required type="email" value={memberEmail} onChange={(e) => setMemberEmail(e.target.value)} placeholder="ana@empresa.com" /></label>
          {profileExtra && <>
            <label><span>Cargo</span><input maxLength={60} value={profileExtra.jobTitle} onChange={(e) => setProfileExtra({ ...profileExtra, jobTitle: e.target.value })} placeholder="Ex.: Analista de Suporte" /></label>
            <label><span>Telefone ou ramal</span><input maxLength={30} inputMode="tel" value={profileExtra.phone} onChange={(e) => setProfileExtra({ ...profileExtra, phone: e.target.value })} placeholder="Ex.: (11) 98765-4321" /></label>
            <div className="profile-teams full"><span>Seus times</span><div>{profileExtra.teams.length ? profileExtra.teams.map((team) => <TeamChip key={team.name} team={team} lead={team.isLead} />) : <small>Você ainda não está em nenhum time. Peça a um administrador para incluir você.</small>}</div></div>
          </>}
          <div className="password-change full"><div><strong>Alterar senha</strong><small>Deixe os dois campos vazios para manter a senha atual. A nova senha deve ter 8+ caracteres, letras e números.</small></div><div className="password-change-fields"><label><span>Senha atual</span><input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Sua senha atual" /></label><label><span>Nova senha</span><input type="password" value={memberPassword} onChange={(e) => setMemberPassword(e.target.value)} placeholder="8+ caracteres, letras e números" /><small className={memberPassword && passwordPolicyError(memberPassword) ? "field-error" : ""}>{memberPassword ? passwordPolicyError(memberPassword) || "Senha válida." : "Mínimo de 8 caracteres, com letras e números."}</small></label></div></div>
          <div className="profile-role full"><span>Seu nível de acesso</span><strong>{roleLabel(memberRole)}</strong></div>
        </> : state.kind === "member" ? memberTab === "general" ? <>
          <VisualEditor label="Avatar do usuário" icons={personIcons} mode={avatarMode} setMode={setAvatarMode} icon={avatarIcon} setIcon={setAvatarIcon} imageKey={avatarKey} file={avatarFile} setFile={setAvatarFile} />
          <label><span>Nome</span><input autoFocus required value={memberName} onChange={(e) => setMemberName(e.target.value)} placeholder="Ex.: Ana Souza" /></label>
          <label><span>Usuário de acesso</span><input required minLength={3} autoCapitalize="none" value={memberUsername} onChange={(e) => setMemberUsername(e.target.value)} placeholder="Ex.: ana" /></label>
          <label><span>{editingMember ? "Redefinir senha" : "Senha inicial"}</span><input required={!editingMember} type="password" value={memberPassword} onChange={(e) => setMemberPassword(e.target.value)} placeholder={editingMember ? "Deixe em branco para manter" : "8+ caracteres, letras e números"} /><small className={memberPassword && passwordPolicyError(memberPassword) ? "field-error" : ""}>{memberPassword ? passwordPolicyError(memberPassword) || "Senha válida." : editingMember ? "Deixe em branco para manter. Para trocar: 8+ caracteres, letras e números." : "Obrigatória: mínimo de 8 caracteres, com letras e números."}</small></label>
          <label><span>E-mail</span><input required type="email" value={memberEmail} onChange={(e) => setMemberEmail(e.target.value)} placeholder="ana@empresa.com" /></label>
            <label><span>Perfil base</span><select value={memberRole} onChange={(e) => { const role = e.target.value as MemberRole; setMemberRole(role); setMemberPermissions(permissionPresets[role]); }}><option value="admin">Administrador</option><option value="member">Membro</option><option value="viewer">Somente leitura</option></select></label>
            <label><span>Status</span><select value={memberActive ? "active" : "inactive"} onChange={(event) => setMemberActive(event.target.value === "active")}><option value="active">Ativo</option><option value="inactive">Desativado</option></select></label>
          <div className="account-security-note full"><span>🔐</span><div><strong>Credenciais protegidas</strong><small>A senha é transformada em um código seguro e não pode ser visualizada depois de salva.</small></div></div>
        </> : <>
          <div className="permission-editor full">
            <div className="permission-editor-head"><div><strong>Permissões individuais</strong><small>{memberRole === "admin" ? "Administradores possuem acesso total obrigatório." : `Defina exatamente o que ${memberName || "este usuário"} poderá fazer.`}</small></div><span>{memberRole === "admin" ? "Acesso total" : `${Object.values(memberPermissions).filter(Boolean).length} de ${permissionOptions.length}`}</span></div>
            <div className="permission-options">
              {permissionOptions.map((option) => <label key={option.key} className={memberRole === "admin" ? "locked" : ""}><input type="checkbox" checked={memberRole === "admin" || memberPermissions[option.key]} disabled={memberRole === "admin"} onChange={(event) => setMemberPermissions((current) => ({ ...current, [option.key]: event.target.checked }))} /><span><strong>{option.label}</strong><small>{option.description}</small></span></label>)}
            </div>
          </div>
          <div className="permission-help full"><strong>Perfil base: {roleLabel(memberRole)}</strong><p>Você pode personalizar as opções acima. Administradores sempre mantêm acesso completo ao sistema.</p><button type="button" onClick={() => setMemberTab("general")}>Voltar aos dados gerais</button></div>
        </> : state.kind === "item" ? <>
          <VisualEditor label="Aparência do item" mode={itemVisualMode} setMode={setItemVisualMode} icon={itemIcon} setIcon={setItemIcon} imageKey={itemImageKey} file={itemFile} setFile={setItemFile} />
          <label className="full"><span>Nome do item</span><input autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Café em pó" /></label>
          <StandardChoice label="Categoria" value={category} setValue={setCategory} options={marketCategories} customLabel="Outra categoria..." helper="Escolha um padrão ou crie uma categoria personalizada." />
          <StandardChoice label="Unidade de controle" value={unit} setValue={setUnit} options={marketUnits} customLabel="Outra unidade..." helper="Escolha como o item será comprado e contado." />
          <label><span>Estoque mínimo</span><input required min="0" step="0.01" type="number" value={minimumQty} onChange={(e) => setMinimumQty(e.target.value)} /><small>Aviso de reposição.</small></label>
          <label className="full"><span>Código de barras ou QR</span><input value={scanCode} onChange={(e) => setScanCode(e.target.value)} placeholder="Leia ou digite o código do produto" /><small>Usado no botão “Ler código” para localizar o item.</small></label>
        </> : state.kind === "scanner" ? <>
          <div className={`scanner-view full ${scannerSupported ? "" : "scanner-fallback"}`}>{scannerSupported ? <video ref={videoRef} muted playsInline /> : <QrCode aria-hidden="true" />}<p>{scannerMessage}</p></div>
          <label className="full"><span>Código encontrado ou digitado</span><input autoFocus value={scannerCode} onChange={(e) => setScannerCode(e.target.value)} placeholder="Código de barras ou QR" /></label>
          {scannerCode && items.find((item) => item.scanCode === scannerCode) && <div className="scanner-match full"><PackageCheck /><div><strong>{items.find((item) => item.scanCode === scannerCode)?.name}</strong><small>Item localizado. Confirme para registrar a movimentação.</small></div></div>}
        </> : <>
          <label className="full"><span>Item</span><select required value={itemId} onChange={(e) => changeSelected(e.target.value)} disabled={Boolean(preselected)}>{items.map((item) => <option key={item.id} value={item.id}>{item.name} — {fmt(item.unopenedQty + item.openedQty)} {item.unit}</option>)}</select></label>
          {state.type === "adjust" ? <>
            <label><span>Quantidade fechada</span><input min="0" step="0.01" type="number" required value={unopenedQty} onChange={(e) => setUnopenedQty(e.target.value)} /></label>
            <label><span>Quantidade aberta</span><input min="0" step="0.01" type="number" required value={openedQty} onChange={(e) => setOpenedQty(e.target.value)} /></label>
          </> : <label className="full"><span>Quantidade ({selected?.unit ?? "un."})</span><input autoFocus min="0.01" step="0.01" type="number" required value={quantity} onChange={(e) => setQuantity(e.target.value)} /><small>{selected && state.type === "open" ? `Disponível fechado: ${fmt(selected.unopenedQty)} ${selected.unit}` : selected && state.type === "consume" ? `Disponível aberto: ${fmt(selected.openedQty)} ${selected.unit}` : "Use números decimais quando necessário."}</small></label>}
          <label className="full retroactive-opening"><span>{{ purchase: "Data e hora da compra", open: "Data e hora da abertura", consume: "Data e hora do consumo", adjust: "Data e hora do ajuste" }[state.type]} <em>opcional</em></span><input type="datetime-local" max={maximumMovementDate} value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} /><small>Deixe vazio para registrar agora. Preencha quando esta movimentação aconteceu anteriormente.</small></label>
          <label className="full"><span>Observação <em>opcional</em></span><textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: compra mensal, contagem feita pela manhã..." /></label>
        </>}
      </div>
      {formError && <p className="modal-error">{formError}</p>}
      <div className="modal-actions">{(editingTeam || editingWeek) && <button type="button" className="secondary-button modal-delete" disabled={saving} onClick={handleScheduleDelete}><Trash2 size={15} /> Excluir</button>}<button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={saving || uploading || (state.kind === "movement" && !itemId) || (state.kind === "scanner" && !scannerCode) || Boolean(weekConflict) || generateBlocked}>{saving || uploading ? "Salvando..." : state.kind === "supportTeam" ? (editingTeam ? "Salvar equipe" : "Criar equipe") : state.kind === "supportWeek" ? (editingWeek ? "Salvar semana" : "Adicionar semana") : state.kind === "generateWeeks" ? `Gerar ${generatedPreview.length || ""} semanas` : state.kind === "profile" ? "Salvar perfil" : state.kind === "member" ? (editingMember ? "Salvar membro" : "Adicionar membro") : state.kind === "scanner" ? "Usar este item" : "Confirmar"}</button></div>
    </form></div>
  );
}

function LoadingRows() {
  return <div className="loading-list">{[1, 2, 3, 4].map((line) => <span key={line} />)}</div>;
}
