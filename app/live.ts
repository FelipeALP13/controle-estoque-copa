"use client";

// Atualização ao vivo: consulta /api/live a cada poucos segundos (só com a aba visível) e, quando alguém
// da equipe muda algo, avisa as telas abertas para recarregarem os dados, sem precisar apertar F5.
import { useEffect, useRef } from "react";

export const LIVE_EVENT = "portal-live";
const INTERVAL_MS = 8000;

/** Fica no painel principal: vigia a versão e dispara o aviso para as telas. */
export function useLiveSync(enabled: boolean) {
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const response = await fetch("/api/live", { cache: "no-store" });
        if (!response.ok) return;
        const { version } = await response.json() as { version: string };
        if (stopped) return;
        if (last.current !== null && version !== last.current) window.dispatchEvent(new Event(LIVE_EVENT));
        last.current = version;
      } catch { /* sem rede: tenta de novo no próximo ciclo */ } finally {
        busy = false;
      }
    };
    void check();
    const timer = window.setInterval(() => { void check(); }, INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => { stopped = true; window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", onVisible); };
  }, [enabled]);
}

/** Recarrega a tela quando alguém muda algo (o callback é o "load" da tela). */
export function useLiveRefresh(reload: () => unknown) {
  const latest = useRef(reload);
  useEffect(() => { latest.current = reload; }, [reload]);
  useEffect(() => {
    const onLive = () => { void latest.current(); };
    window.addEventListener(LIVE_EVENT, onLive);
    return () => window.removeEventListener(LIVE_EVENT, onLive);
  }, []);
}
