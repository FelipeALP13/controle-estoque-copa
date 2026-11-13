"use client";

import { useEffect, useState } from "react";
import Monitor from "lucide-react/icons/monitor";
import Moon from "lucide-react/icons/moon";
import Sun from "lucide-react/icons/sun";
import { applyTheme, readTheme, saveTheme, type ThemeChoice } from "./theme";

const options: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Escuro", icon: Moon },
  { value: "system", label: "Automático", icon: Monitor },
];

/** Meu perfil: aparência do Portal neste navegador. */
export default function ThemePicker() {
  const [choice, setChoice] = useState<ThemeChoice>("system");
  useEffect(() => { const timer = window.setTimeout(() => setChoice(readTheme()), 0); return () => window.clearTimeout(timer); }, []);
  return <div className="theme-picker full">
    <div><strong>Aparência</strong><small>Vale para este navegador. “Automático” segue o modo claro/escuro do computador ou celular.</small></div>
    <div className="theme-options" role="radiogroup" aria-label="Aparência">
      {options.map((option) => { const Icon = option.icon; return <button key={option.value} type="button" role="radio" aria-checked={choice === option.value} className={choice === option.value ? "active" : ""} onClick={() => { setChoice(option.value); saveTheme(option.value); }}><Icon size={15} /> {option.label}</button>; })}
    </div>
  </div>;
}

/** Acompanha a troca de claro/escuro do sistema quando a escolha é "Automático". */
export function useSystemThemeSync() {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => { if (readTheme() === "system") applyTheme("system"); };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
}
