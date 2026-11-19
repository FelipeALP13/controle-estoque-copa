"use client";

// Tour do primeiro acesso: balões que apontam as partes principais do Portal (menu, demandas, chamados,
// busca, chat, avisos e perfil). Aparece uma vez por pessoa neste navegador; dá para rever no perfil.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import X from "lucide-react/icons/x";

/** Evento que abre o tour de novo (botão no perfil). */
export const OPEN_TOUR_EVENT = "portal-open-tour";
const SEEN_PREFIX = "portal-tour-v1:";

type Step = { target: string | null; title: string; text: string; mobileTarget?: string };

const STEPS: Step[] = [
  { target: null, title: "Boas-vindas ao Portal", text: "Um tour rápido, de menos de um minuto, pelo que você mais vai usar no dia a dia." },
  { target: ".sidebar .sidebar-nav, .sidebar nav", mobileTarget: ".menu-button", title: "Menu", text: "Todas as áreas ficam aqui: Agenda, Demandas, Chamados, Escala, Pessoas e mais. Clique no logo, no topo, para voltar à Visão geral. No computador, passe o mouse para ver os nomes ou fixe o menu aberto." },
  { target: '.sidebar button[data-key="tasks"]', title: "Demandas", text: "Suas tarefas, com prazo, checklist, horas e cronômetro. O número ao lado mostra quantas estão abertas com você (vermelho quando tem prazo vencido)." },
  { target: '.sidebar button[data-key="tickets"]', title: "Chamados", text: "Pedidos entre os times. Cada chamado cai na fila do time escolhido; quem vai atender clica em Assumir." },
  { target: ".topbar-search", title: "Buscar em tudo", text: "Ache demandas, chamados, pessoas, clientes e artigos pelo nome ou código. Atalho: Ctrl+K." },
  { target: ".chat-panel-button", title: "Chat", text: "Canais da equipe e conversas diretas. Abre ao lado, sem sair da tela em que você está." },
  { target: ".bell-button", title: "Avisos", text: "Menções, chamados novos, lembretes da agenda e mensagens diretas chegam aqui." },
  { target: ".sidebar-footer", mobileTarget: ".menu-button", title: "Seu perfil", text: "Foto, cargo, telefone, senha, tema claro ou escuro e notificações no celular. Para ver este tour de novo, é só abrir o perfil." },
];

function readSeen(key: string) { try { return window.localStorage.getItem(key) === "1"; } catch { return false; } }
function writeSeen(key: string) { try { window.localStorage.setItem(key, "1"); } catch { /* sem armazenamento: o tour pode voltar a aparecer */ } }

/** Primeiro elemento visível na tela para o seletor (o menu do celular fica escondido fora da tela). */
function visibleTarget(selector: string | null | undefined) {
  if (!selector) return null;
  for (const node of document.querySelectorAll<HTMLElement>(selector)) {
    const rect = node.getBoundingClientRect();
    if (rect.width > 4 && rect.height > 4 && rect.right > 0 && rect.left < window.innerWidth && rect.bottom > 0 && rect.top < window.innerHeight) return node;
  }
  return null;
}

/** Passos que fazem sentido nesta tela (sem o alvo visível, o passo é pulado ou usa o alvo do celular). */
function resolveSteps() {
  const seen = new Set<HTMLElement>();
  const result: { step: Step; node: HTMLElement | null }[] = [];
  for (const step of STEPS) {
    if (!step.target) { result.push({ step, node: null }); continue; }
    const node = visibleTarget(step.target) ?? visibleTarget(step.mobileTarget);
    if (!node || seen.has(node)) continue;
    seen.add(node);
    result.push({ step, node });
  }
  return result;
}

export function ProductTour({ memberId, firstName, blocked }: { memberId: string | number | null; firstName: string; blocked: boolean }) {
  const [steps, setSteps] = useState<{ step: Step; node: HTMLElement | null }[] | null>(null);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardPos, setCardPos] = useState<{ top: number; left: number } | null>(null);
  const key = memberId ? `${SEEN_PREFIX}${memberId}` : null;

  const start = useCallback(() => { setIndex(0); setSteps(resolveSteps()); }, []);
  const finish = useCallback(() => { if (key) writeSeen(key); setSteps(null); setRect(null); setCardPos(null); }, [key]);

  // Primeira vez desta pessoa neste navegador: abre sozinho (depois do "Meu dia", se ele abrir).
  useEffect(() => {
    if (!key || blocked || readSeen(key)) return;
    const timer = window.setTimeout(() => { if (!readSeen(key)) start(); }, 1200);
    return () => window.clearTimeout(timer);
  }, [key, blocked, start]);

  useEffect(() => {
    const open = () => start();
    window.addEventListener(OPEN_TOUR_EVENT, open);
    return () => window.removeEventListener(OPEN_TOUR_EVENT, open);
  }, [start]);

  const current = steps?.[index] ?? null;

  // Posição do destaque: acompanha mudanças de tamanho e rolagem.
  useEffect(() => {
    if (!current) return;
    const update = () => setRect(current.node && current.node.isConnected ? current.node.getBoundingClientRect() : null);
    const timer = window.setTimeout(update, 0);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => { window.clearTimeout(timer); window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [current]);

  // Balão ao lado do destaque, sempre dentro da tela.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!current || !card) return;
    const margin = 12;
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top: number;
    let left: number;
    if (!rect) { top = (vh - height) / 2; left = (vw - width) / 2; }
    else if (rect.right + margin + width <= vw - margin && rect.height > vh * 0.5) { left = rect.right + margin; top = Math.min(Math.max(rect.top, margin), vh - height - margin); }
    else if (rect.right + margin + width <= vw - margin && rect.left < 120) { left = rect.right + margin; top = rect.top + rect.height / 2 - height / 2; }
    else if (rect.bottom + margin + height <= vh - margin) { top = rect.bottom + margin; left = rect.left + rect.width / 2 - width / 2; }
    else { top = rect.top - margin - height; left = rect.left + rect.width / 2 - width / 2; }
    const next = { top: Math.round(Math.min(Math.max(top, margin), vh - height - margin)), left: Math.round(Math.min(Math.max(left, margin), vw - width - margin)) };
    const timer = window.setTimeout(() => setCardPos((prev) => (prev && prev.top === next.top && prev.left === next.left ? prev : next)), 0);
    return () => window.clearTimeout(timer);
  }, [current, rect]);

  // Foco no balão assim que ele aparece (antes de posicionado ele fica invisível e não recebe foco): Esc e setas funcionam.
  const placed = cardPos !== null;
  useEffect(() => { if (current && placed) cardRef.current?.focus({ preventScroll: true }); }, [current, placed]);

  if (!steps || !current) return null;
  const last = index === steps.length - 1;
  const next = () => (last ? finish() : setIndex(index + 1));
  const back = () => setIndex(Math.max(0, index - 1));
  const title = index === 0 && firstName ? `Boas-vindas ao Portal, ${firstName}!` : current.step.title;
  const pad = 6;

  return createPortal(<div className="tour-layer" onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); finish(); }
    else if (event.key === "ArrowRight") { event.preventDefault(); next(); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); back(); }
  }}>
    {rect ? <div className="tour-spot" style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} aria-hidden="true" /> : <div className="tour-dim" aria-hidden="true" />}
    <div ref={cardRef} className="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-text" tabIndex={-1}
      style={cardPos ? { top: cardPos.top, left: cardPos.left } : { visibility: "hidden", top: 0, left: 0 }}>
      <button type="button" className="tour-close" onClick={finish} aria-label="Fechar o tour"><X size={16} /></button>
      <small className="tour-count">{index + 1} de {steps.length}</small>
      <h2 id="tour-title">{title}</h2>
      <p id="tour-text">{current.step.text}</p>
      <div className="tour-dots" aria-hidden="true">{steps.map((_, dot) => <i key={dot} className={dot === index ? "on" : ""} />)}</div>
      <div className="tour-actions">
        {index === 0 ? <button type="button" className="tour-skip" onClick={finish}>Agora não</button> : <button type="button" className="tour-skip" onClick={back}>Voltar</button>}
        <button type="button" className="primary-button" onClick={next}>{index === 0 ? "Começar" : last ? "Concluir" : "Próximo"}</button>
      </div>
    </div>
  </div>, document.body);
}
