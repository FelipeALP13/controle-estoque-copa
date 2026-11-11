"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import ChevronDown from "lucide-react/icons/chevron-down";
import { TICKETS_CHANGED } from "./use-jira-sync";

export type NavBadge = { count: number; tone?: "info" | "alert"; title: string };
export type NavItem = { key: string; label: string; icon: ReactNode; onClick: () => void; badge?: NavBadge | null; children?: NavItem[]; open?: boolean };
export type NavSection = { label?: string; items: NavItem[] };

export type NavCounts = { tasks: number; tasksOverdue: number; tickets: number; ticketsLate: number; ticketsUnassigned: number };

/** Contadores do menu (minhas demandas e fila de chamados), atualizados a cada minuto e quando chegam chamados novos. */
export function useNavCounts(enabled: boolean) {
  const [counts, setCounts] = useState<NavCounts | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/counts", { cache: "no-store" });
      if (response.ok) setCounts(await response.json() as NavCounts);
    } catch { /* sem conexão: mantém os números anteriores */ }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const first = window.setTimeout(() => { void load(); }, 800);
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60000);
    const refresh = () => { void load(); };
    window.addEventListener(TICKETS_CHANGED, refresh);
    window.addEventListener("focus", refresh);
    return () => { window.clearTimeout(first); window.clearInterval(interval); window.removeEventListener(TICKETS_CHANGED, refresh); window.removeEventListener("focus", refresh); };
  }, [enabled, load]);
  return { counts, reload: load };
}

/** Número no item do menu; "pula" quando aumenta. */
function Badge({ badge }: { badge: NavBadge }) {
  const previous = useRef(badge.count);
  const [bump, setBump] = useState(false);
  useEffect(() => {
    if (badge.count > previous.current) {
      const start = window.setTimeout(() => setBump(true), 0);
      const end = window.setTimeout(() => setBump(false), 700);
      previous.current = badge.count;
      return () => { window.clearTimeout(start); window.clearTimeout(end); };
    }
    previous.current = badge.count;
  }, [badge.count]);
  if (!badge.count) return null;
  return <b className={`nav-badge ${badge.tone ?? "info"} ${bump ? "bump" : ""}`} title={badge.title} aria-label={badge.title}>{badge.count > 99 ? "99+" : badge.count}</b>;
}

/**
 * Menu lateral em seções, com um destaque que desliza até o item ativo.
 * O item ativo é marcado por `activeKey` (ou pelo item pai, quando o submenu está fechado).
 */
export default function SidebarNav({ sections, activeKey }: { sections: NavSection[]; activeKey: string }) {
  const navRef = useRef<HTMLElement>(null);
  const [indicator, setIndicator] = useState<{ top: number; height: number } | null>(null);
  let index = 0;

  const place = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    // Submenu fechado: o destaque fica no item pai (o filho está escondido).
    const target = nav.querySelector<HTMLElement>(`button[data-parent-of~="${activeKey}"]`) ?? nav.querySelector<HTMLElement>(`button[data-key="${activeKey}"]`);
    const next = target ? { top: target.offsetTop, height: target.offsetHeight } : null;
    // Só atualiza quando a posição muda (senão a tela entraria num ciclo de atualizações).
    setIndicator((current) => (current?.top === next?.top && current?.height === next?.height ? current : next));
  }, [activeKey]);

  useLayoutEffect(() => { place(); });
  useEffect(() => {
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [place]);

  const render = (item: NavItem, child = false, hidden = false) => {
    const order = index++;
    const active = item.key === activeKey;
    const childKeys = item.children?.map((entry) => entry.key).join(" ");
    const containsActive = Boolean(item.children?.some((entry) => entry.key === activeKey));
    return <button key={item.key} type="button" data-key={item.key} data-parent-of={!item.open ? childKeys : undefined}
      className={`${child ? "nav-child" : "nav-item"} ${active ? "active" : ""} ${containsActive ? "contains-active" : ""}`}
      style={{ "--i": order } as React.CSSProperties} onClick={item.onClick} tabIndex={hidden ? -1 : undefined} aria-hidden={hidden || undefined} aria-current={active ? "page" : undefined} aria-expanded={item.children ? Boolean(item.open) : undefined}>
      {!child && <span className="nav-icon">{item.icon}</span>}
      <span className="nav-label">{item.label}</span>
      {item.badge && <Badge badge={item.badge} />}
      {item.children && <ChevronDown className={`nav-caret ${item.open ? "open" : ""}`} />}
    </button>;
  };

  return <nav ref={navRef} className="sidebar-nav" aria-label="Menu principal" onTransitionEnd={(event) => { if ((event.target as HTMLElement).classList?.contains("nav-submenu")) place(); }}>
    {indicator && <span className="nav-indicator" style={{ transform: `translateY(${indicator.top}px)`, height: indicator.height }} aria-hidden="true" />}
    {sections.map((section, sectionIndex) => {
      const items = section.items;
      if (!items.length) return null;
      return <div key={section.label ?? `s${sectionIndex}`} className="nav-section">
        {section.label && <span className="nav-section-label" style={{ "--i": index } as React.CSSProperties}>{section.label}</span>}
        {items.map((item) => item.children ? <div key={item.key} className={`nav-module ${item.open ? "open" : ""}`}>
          {render(item)}
          <div className="nav-submenu"><div>{item.children.map((childItem) => render(childItem, true, !item.open))}</div></div>
        </div> : render(item))}
      </div>;
    })}
  </nav>;
}
