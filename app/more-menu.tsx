"use client";

// Botão "Mais": junta ações usadas de vez em quando, para a barra da tela ficar limpa.
import { useEffect, useRef, useState } from "react";
import Ellipsis from "lucide-react/icons/ellipsis";

export type MoreAction = { key: string; label: string; icon?: React.ReactNode; onClick: () => void; disabled?: boolean; title?: string };

export function MoreMenu({ actions, label = "Mais" }: { actions: MoreAction[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  if (!actions.length) return null;
  return <div className="more-menu" ref={ref}>
    <button type="button" className="secondary-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}><Ellipsis size={15} /> {label}</button>
    {open && <div className="more-menu-pop" role="menu">
      {actions.map((action) => <button key={action.key} type="button" role="menuitem" disabled={action.disabled} title={action.title} onClick={() => { setOpen(false); action.onClick(); }}>{action.icon}{action.label}</button>)}
    </div>}
  </div>;
}
