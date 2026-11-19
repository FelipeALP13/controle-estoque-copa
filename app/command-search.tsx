"use client";

import { useEffect, useRef, useState } from "react";
import BookOpen from "lucide-react/icons/book-open";
import FolderKanban from "lucide-react/icons/folder-kanban";
import LifeBuoy from "lucide-react/icons/life-buoy";
import ListTodo from "lucide-react/icons/list-todo";
import Search from "lucide-react/icons/search";
import UserRound from "lucide-react/icons/user-round";
import Zap from "lucide-react/icons/zap";
import { searchKindLabels, type SearchHit, type SearchKind } from "./search";
import { fold } from "./knowledge";

const icons: Record<SearchKind, typeof Search> = { task: ListTodo, ticket: LifeBuoy, article: BookOpen, project: FolderKanban, person: UserRound };
const order: SearchKind[] = ["task", "ticket", "article", "project", "person"];

/** Ação rápida da busca (Ctrl+K): criar algo ou ir para uma tela sem passar pelo menu. */
export type QuickAction = { id: string; label: string; hint?: string; keywords?: string; icon?: typeof Search; run: () => void };

/** Ações cujo nome ou palavras-chave contêm todas as palavras digitadas (sem acento e sem maiúsculas). */
export function matchActions(actions: readonly QuickAction[], query: string) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return actions.slice(0, 8);
  return actions.filter((action) => { const text = fold(`${action.label} ${action.keywords ?? ""}`); return words.every((word) => text.includes(word)); }).slice(0, 6);
}

type Entry = { type: "action"; action: QuickAction } | { type: "hit"; hit: SearchHit };

/** Busca geral: Ctrl+K (ou /) abre; setas escolhem; Enter abre o item ou executa a ação. */
export default function CommandSearch({ onPick, actions = [] }: { onPick: (hit: SearchHit) => void; actions?: QuickAction[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]");
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setOpen(true); }
      else if (event.key === "/" && !typing && !event.ctrlKey && !event.metaKey) { event.preventDefault(); setOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Busca com uma pequena espera enquanto digita; ignora respostas antigas.
  useEffect(() => {
    if (!open) return;
    const text = query.trim();
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (text.length < 2) { setResults([]); setLoading(false); return; }
      setLoading(true);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(text)}`, { cache: "no-store" });
        const data = await response.json() as { results?: SearchHit[] };
        if (!cancelled) { setResults(data.results ?? []); setActive(0); }
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query, open]);

  const grouped = order.flatMap((kind) => results.filter((hit) => hit.kind === kind));
  const matched = matchActions(actions, query);
  const entries: Entry[] = [...matched.map((action) => ({ type: "action" as const, action })), ...grouped.map((hit) => ({ type: "hit" as const, hit }))];

  function close() { setOpen(false); setQuery(""); setResults([]); setActive(0); }
  function pick(hit: SearchHit) { close(); onPick(hit); }
  function runAction(action: QuickAction) { close(); action.run(); }
  function choose(entry: Entry | undefined) { if (!entry) return; if (entry.type === "action") runAction(entry.action); else pick(entry.hit); }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") { event.preventDefault(); close(); }
    else if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => Math.min(entries.length - 1, index + 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => Math.max(0, index - 1)); }
    else if (event.key === "Enter" && entries[active]) { event.preventDefault(); choose(entries[active]); }
  }

  useEffect(() => { listRef.current?.querySelector(".active")?.scrollIntoView({ block: "nearest" }); }, [active]);

  const text = query.trim();
  return <>
    <button className="topbar-search" onClick={() => setOpen(true)} title="Buscar em tudo e ações rápidas (Ctrl+K)"><Search size={15} /><span>Buscar</span><kbd>Ctrl K</kbd></button>
    {open && <div className="modal-layer search-layer" onKeyDown={onKeyDown}>
      <button className="backdrop" onClick={close} aria-label="Fechar busca" />
      <div className="command-search" role="dialog" aria-label="Buscar em tudo">
        <label className="command-input"><Search size={17} /><input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); }} placeholder="Buscar ou fazer algo: “nova demanda”, “escala”, DEM-12, boleto..." aria-label="Buscar" /><kbd>Esc</kbd></label>
        <div className="command-results" ref={listRef}>
          {matched.length > 0 && <section>
            <h4>{text ? "Ações" : "Ações rápidas"}</h4>
            {matched.map((action, index) => {
              const Icon = action.icon ?? Zap;
              return <button key={action.id} className={`command-item command-action ${index === active ? "active" : ""}`} onMouseEnter={() => setActive(index)} onClick={() => runAction(action)}>
                <Icon size={15} />
                <span className="command-title">{action.label}</span>
                {action.hint && <small>{action.hint}</small>}
              </button>;
            })}
          </section>}
          {text.length < 2 ? <p className="command-hint">Digite pelo menos 2 letras para buscar. Dá para buscar pelo código: DEM-12, CH-3, PRJ-5, AS-0019 ou a chave do Jira.</p>
            : loading && !results.length ? <p className="command-hint">Buscando...</p>
            : !grouped.length ? (matched.length ? null : <p className="command-hint">Nada encontrado para “{text}”.</p>)
            : order.map((kind) => {
              const hits = grouped.filter((hit) => hit.kind === kind);
              if (!hits.length) return null;
              const Icon = icons[kind];
              return <section key={kind}>
                <h4>{searchKindLabels[kind]}</h4>
                {hits.map((hit) => {
                  const index = matched.length + grouped.indexOf(hit);
                  return <button key={`${hit.kind}-${hit.id}`} className={`command-item ${index === active ? "active" : ""} ${hit.closed ? "closed" : ""}`} onMouseEnter={() => setActive(index)} onClick={() => pick(hit)}>
                    <Icon size={15} />
                    {hit.codes[0] && <span className="task-code">{hit.codes[0]}</span>}
                    <span className="command-title">{hit.title}</span>
                    <small>{hit.subtitle}</small>
                  </button>;
                })}
              </section>;
            })}
        </div>
        <footer><span><kbd>↑</kbd><kbd>↓</kbd> escolher</span><span><kbd>Enter</kbd> abrir ou fazer</span><span><kbd>Esc</kbd> fechar</span></footer>
      </div>
    </div>}
  </>;
}
