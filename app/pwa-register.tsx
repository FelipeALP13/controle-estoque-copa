"use client";

import { useEffect } from "react";
import { useSystemThemeSync } from "./theme-picker";

/** Registra o service worker (instalar como app e avisos do sistema). */
export default function PwaRegister() {
  useSystemThemeSync();
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const register = () => { navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined); };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);
  return null;
}
