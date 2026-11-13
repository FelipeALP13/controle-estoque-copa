"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { type ForecastInput } from "./stock-forecast";
import { type SupportTeam, type SupportWeek } from "./support-schedule";
import ImagePlus from "lucide-react/icons/image-plus";
import PackageOpen from "lucide-react/icons/package-open";
import Settings2 from "lucide-react/icons/settings-2";
import ShoppingCart from "lucide-react/icons/shopping-cart";
import TrendingDown from "lucide-react/icons/trending-down";

export function WhatsAppIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.5 11.6a8.4 8.4 0 0 1-12.4 7.3L3.5 20l1.2-4.4A8.4 8.4 0 1 1 20.5 11.6Z" />
      <path d="M8.2 7.6c.2-.4.4-.4.8-.4h.4c.2 0 .4.1.5.4l.8 2c.1.3.1.5-.1.7l-.7.8c-.2.2-.1.4 0 .6.8 1.4 2 2.4 3.5 3 .2.1.4.1.6-.1l.9-1.1c.2-.2.4-.3.7-.2l2 .9c.3.1.4.3.4.6 0 .5-.2 1.4-.8 1.9-.6.5-1.5.8-2.5.6-1.1-.2-3.7-1.1-5.8-3.1-1.7-1.6-2.8-3.6-3-4.7-.2-.9.1-1.5.4-1.9Z" />
    </svg>
  );
}

export type MemberRole = "admin" | "member" | "viewer";
export type MemberPermissions = {
  manageItems: boolean;
  registerPurchases: boolean;
  openItems: boolean;
  consumeItems: boolean;
  adjustStock: boolean;
  viewPlanning: boolean;
  viewHistory: boolean;
  manageSchedule: boolean;
};

export const permissionPresets: Record<MemberRole, MemberPermissions> = {
  admin: { manageItems: true, registerPurchases: true, openItems: true, consumeItems: true, adjustStock: true, viewPlanning: true, viewHistory: true, manageSchedule: true },
  member: { manageItems: false, registerPurchases: true, openItems: true, consumeItems: true, adjustStock: false, viewPlanning: true, viewHistory: true, manageSchedule: false },
  viewer: { manageItems: false, registerPurchases: false, openItems: false, consumeItems: false, adjustStock: false, viewPlanning: true, viewHistory: true, manageSchedule: false },
};

export const permissionOptions: { key: keyof MemberPermissions; label: string; description: string }[] = [
  { key: "manageItems", label: "Gerenciar itens", description: "Cadastrar, editar e excluir produtos" },
  { key: "registerPurchases", label: "Registrar compras", description: "Adicionar novas unidades ao estoque" },
  { key: "openItems", label: "Abrir produtos", description: "Mover unidades fechadas para em uso" },
  { key: "consumeItems", label: "Lançar consumo", description: "Baixar quantidades já abertas" },
  { key: "adjustStock", label: "Ajustar saldo", description: "Corrigir a contagem física" },
  { key: "viewPlanning", label: "Ver planejamento", description: "Consultar duração e previsão de compras" },
  { key: "viewHistory", label: "Ver histórico", description: "Consultar movimentações da equipe" },
  { key: "manageSchedule", label: "Editar escala", description: "Alterar equipes e semanas de atendimento" },
];

export type Member = {
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

export type CurrentUser = Pick<Member, "userId" | "name" | "email" | "username" | "role" | "permissions" | "active" | "avatarIcon" | "avatarKey">;

export type Item = {
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

export type Movement = {
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

export type ModalState =
  | { kind: "item"; item?: Item }
  | { kind: "member"; member?: Member }
  | { kind: "profile" }
  | { kind: "movement"; type: Movement["type"]; item?: Item }
  | { kind: "supportTeam"; team?: SupportTeam }
  | { kind: "supportWeek"; week?: SupportWeek }
  | { kind: "generateWeeks" }
  | null;

export type Schedule = { teams: SupportTeam[]; weeks: SupportWeek[] };

export const movementCopy = {
  purchase: { label: "Compra", icon: ShoppingCart, tone: "green" },
  open: { label: "Abertura", icon: PackageOpen, tone: "amber" },
  consume: { label: "Consumo", icon: TrendingDown, tone: "red" },
  adjust: { label: "Ajuste", icon: Settings2, tone: "blue" },
} as const;

export function fmt(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
}

/** Dados do item para a previsão de consumo e a lista de compras. */
export function toForecast(item: Item): ForecastInput {
  return { id: item.id, name: item.name, unit: item.unit, category: item.category, unopenedQty: item.unopenedQty, openedQty: item.openedQty, minimumQty: item.minimumQty, averageDurationDays: item.analytics.averageDurationDays };
}

export function relativeDate(value: string | null) {
  if (!value) return "Nunca aberto";
  const date = new Date(value);
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (days <= 0) return "Aberto hoje";
  if (days === 1) return "Aberto ontem";
  return `Aberto há ${days} dias`;
}

export function exactDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function roleLabel(role: MemberRole) {
  return role === "admin" ? "Administrador" : role === "member" ? "Membro" : "Somente leitura";
}

export function playfulGreeting(name: string, lowItem?: string, openCount = 0) {
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

export function ItemVisual({ item, className = "item-avatar" }: { item: Pick<Item, "name" | "icon" | "imageKey">; className?: string }) {
  return <span className={`${className} visual-avatar`}>{item.imageKey ? <Image src={mediaUrl(item.imageKey)} alt="" fill sizes="64px" unoptimized /> : <span>{item.icon || item.name.slice(0, 2).toUpperCase()}</span>}</span>;
}

export function MemberVisual({ member, className = "avatar member-avatar" }: { member: Pick<Member, "name" | "avatarIcon" | "avatarKey">; className?: string }) {
  return <span className={`${className} visual-avatar`}>{member.avatarKey ? <Image src={mediaUrl(member.avatarKey)} alt="" fill sizes="64px" unoptimized /> : <span>{member.avatarIcon || member.name.slice(0, 2).toUpperCase()}</span>}</span>;
}

const visualIcons = ["📦", "☕", "🍪", "🍬", "🥛", "🍵", "🧃", "🧻", "🧼", "🥄", "🧴", "🍫"];
export const personIcons = ["👤", "🧑‍💼", "👩‍💼", "👨‍💼", "🧑‍💻", "👩‍💻", "👨‍💻", "🎧", "🧑‍🔧", "🚀", "⭐", "🐱", "🐶", "🦊"];

export async function uploadImage(file: File, kind: "item" | "profile") {
  const form = new FormData();
  form.append("file", file);
  form.append("kind", kind);
  const response = await fetch("/api/media", { method: "POST", body: form });
  const data = await response.json() as { error?: string; imageKey?: string };
  if (!response.ok) throw new Error(data.error || "Não foi possível enviar a imagem.");
  return String(data.imageKey);
}

export function StandardChoice({ label, value, setValue, options, customLabel, helper }: { label: string; value: string; setValue: (value: string) => void; options: readonly string[]; customLabel: string; helper: string }) {
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

export function VisualEditor({ label, mode, setMode, icon, setIcon, imageKey, file, setFile, icons = visualIcons }: { label: string; mode: "icon" | "image"; setMode: (mode: "icon" | "image") => void; icon: string; setIcon: (icon: string) => void; imageKey: string | null; file: File | null; setFile: (file: File | null) => void; icons?: readonly string[] }) {
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

export function greeting() {
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/Sao_Paulo" }).format(new Date()));
  return hour < 12 ? "BOM DIA" : hour < 18 ? "BOA TARDE" : "BOA NOITE";
}

/** "Terça-feira, 10 de novembro": só a primeira letra maiúscula. */
export function todayLong() {
  const text = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long", timeZone: "America/Sao_Paulo" }).format(new Date());
  return text.charAt(0).toLocaleUpperCase("pt-BR") + text.slice(1);
}

export function isoDateInSaoPaulo(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function scheduleDate(value: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("pt-BR", { ...options, timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

export function weekLabel(week: Pick<SupportWeek, "start" | "end">) {
  const start = scheduleDate(week.start, { day: "2-digit", month: "short" }).replaceAll(".", "");
  const end = scheduleDate(week.end, { day: "2-digit", month: "short" }).replaceAll(".", "");
  return `${start} a ${end}`;
}

export function whatsappUrl(message: string) {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

export function findTeam(schedule: Schedule, teamId: number) {
  return schedule.teams.find((team) => team.id === teamId) ?? null;
}

export function scheduleRangeLabel(weeks: SupportWeek[]) {
  if (!weeks.length) return "";
  const first = weeks[0].start;
  const last = weeks.at(-1)!.end;
  const month = (value: string) => scheduleDate(value, { month: "short" }).replace(".", "").toLocaleUpperCase("pt-BR");
  const firstYear = first.slice(0, 4);
  const lastYear = last.slice(0, 4);
  return firstYear === lastYear ? `${month(first)}–${month(last)} ${lastYear}` : `${month(first)} ${firstYear} – ${month(last)} ${lastYear}`;
}

export function LoadingRows() {
  return <div className="loading-list">{[1, 2, 3, 4].map((line) => <span key={line} />)}</div>;
}
