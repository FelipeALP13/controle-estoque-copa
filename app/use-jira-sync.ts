"use client";

import { useEffect } from "react";

export const TICKETS_CHANGED = "tickets-changed";
const INTERVAL_MS = 2 * 60 * 1000;

/** Pede ao servidor para buscar chamados novos no Jira. Devolve se algo mudou. */
export async function requestJiraSync(force = false) {
  let changed = false;
  // Se a conta tiver mais itens do que cabem numa busca, continua (até 15 rodadas).
  for (let round = 0; round < 15; round += 1) {
    const response = await fetch("/api/jira", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sync", force: force && round === 0 }) });
    if (!response.ok) break;
    const data = await response.json() as { changed?: boolean; more?: boolean };
    changed ||= Boolean(data.changed);
    if (!data.more) break;
  }
  if (changed) window.dispatchEvent(new Event(TICKETS_CHANGED));
  return changed;
}

/**
 * Enquanto alguém está com o Portal aberto (aba visível), busca no Jira a cada 2 minutos.
 * O servidor ignora pedidos repetidos dentro desse intervalo, então várias abas não pesam.
 */
export function useJiraAutoSync(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let running = false;
    const run = async () => {
      if (running || document.visibilityState !== "visible") return;
      running = true;
      try { await requestJiraSync(); } catch { /* sem conexão: tenta na próxima */ } finally { running = false; }
    };
    const first = window.setTimeout(() => { void run(); }, 3000);
    const interval = window.setInterval(() => { void run(); }, INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void run(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearTimeout(first); window.clearInterval(interval); document.removeEventListener("visibilitychange", onVisible); };
  }, [enabled]);
}
