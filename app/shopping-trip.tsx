"use client";

import { useMemo, useState } from "react";
import Check from "lucide-react/icons/check";
import Minus from "lucide-react/icons/minus";
import Plus from "lucide-react/icons/plus";
import ShoppingBasket from "lucide-react/icons/shopping-basket";
import X from "lucide-react/icons/x";
import { fmt, ItemVisual, type Item } from "./dashboard-shared";
import type { ShoppingLine } from "./stock-forecast";

type Entry = { itemId: number; qty: number; checked: boolean; suggested: number | null };

const DRAFT_KEY = "portal-copa-trip";

function readDraft(): Entry[] | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : null;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((entry): entry is Entry => entry && typeof entry.itemId === "number" && typeof entry.qty === "number" && typeof entry.checked === "boolean");
  } catch {
    return null;
  }
}

function saveDraft(entries: Entry[] | null) {
  try {
    if (entries) window.localStorage.setItem(DRAFT_KEY, JSON.stringify(entries));
    else window.localStorage.removeItem(DRAFT_KEY);
  } catch { /* sem armazenamento: a ida continua só nesta tela */ }
}

/** Começa pela lista de compras; a ida em andamento (salva no aparelho) volta com o que já foi marcado. */
function initialEntries(lines: readonly ShoppingLine[], items: readonly Item[]): Entry[] {
  const fromList: Entry[] = lines.map((line) => ({ itemId: line.id, qty: line.buy, checked: false, suggested: line.buy }));
  const draft = readDraft();
  if (!draft) return fromList;
  const exists = (id: number) => items.some((item) => item.id === id);
  const kept = draft.filter((entry) => exists(entry.itemId));
  for (const entry of fromList) if (!kept.some((saved) => saved.itemId === entry.itemId)) kept.push(entry);
  return kept;
}

/**
 * Modo "fazer compras": a lista no celular, marcando o que já foi para o carrinho.
 * No fim, um botão registra todas as compras marcadas de uma vez.
 */
export function ShoppingTrip({ lines, items, onClose, onDone }: { lines: ShoppingLine[]; items: Item[]; onClose: () => void; onDone: (count: number) => void }) {
  const [entries, setEntries] = useState<Entry[]>(() => initialEntries(lines, items));
  const [adding, setAdding] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const checked = entries.filter((entry) => entry.checked && entry.qty > 0);
  const others = items.filter((item) => !entries.some((entry) => entry.itemId === item.id));

  function update(next: Entry[]) {
    setEntries(next);
    saveDraft(next);
  }
  const change = (itemId: number, patch: Partial<Entry>) => update(entries.map((entry) => entry.itemId === itemId ? { ...entry, ...patch } : entry));
  const step = (entry: Entry, delta: number) => change(entry.itemId, { qty: Math.max(0, Math.round((entry.qty + delta) * 100) / 100), checked: entry.qty + delta > 0 ? entry.checked : false });

  function addItem(value: string) {
    const itemId = Number(value);
    setAdding("");
    if (!itemId || entries.some((entry) => entry.itemId === itemId)) return;
    update([...entries, { itemId, qty: 1, checked: true, suggested: null }]);
  }

  function cancelTrip() {
    if (checked.length && !window.confirm("Descartar esta ida ao mercado? O que você marcou não será registrado.")) return;
    saveDraft(null);
    onClose();
  }

  async function finish() {
    if (!checked.length) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "purchaseBatch", lines: checked.map((entry) => ({ itemId: entry.itemId, quantity: entry.qty })) }),
      });
      const data = await response.json() as { error?: string; registered?: number };
      if (!response.ok) throw new Error(data.error || "Não foi possível registrar as compras.");
      saveDraft(null);
      onDone(data.registered ?? checked.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível registrar as compras.");
    } finally {
      setSaving(false);
    }
  }

  const progress = entries.length ? Math.round((checked.length / entries.length) * 100) : 0;

  return <div className="modal-layer trip-layer">
    <button className="backdrop" onClick={onClose} aria-label="Fechar (a ida fica salva neste aparelho)" />
    <section className="modal trip" role="dialog" aria-modal="true" aria-labelledby="trip-title">
      <div className="modal-head trip-head">
        <div>
          <h2 id="trip-title">Fazer compras</h2>
          <p>Marque o que já foi para o carrinho. A lista fica salva neste aparelho até você registrar.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Fechar"><X /></button>
      </div>
      <div className="trip-progress" aria-live="polite">
        <span><b>{checked.length}</b> de {entries.length} no carrinho</span>
        <div className="trip-bar" aria-hidden="true"><i style={{ width: `${progress}%` }} /></div>
      </div>
      <ul className="trip-list">
        {entries.map((entry) => {
          const item = byId.get(entry.itemId);
          if (!item) return null;
          return <li key={entry.itemId} className={entry.checked ? "done" : ""}>
            <button type="button" className="trip-check" role="checkbox" aria-checked={entry.checked} disabled={entry.qty <= 0}
              onClick={() => change(entry.itemId, { checked: !entry.checked })} aria-label={`${entry.checked ? "Tirar do carrinho" : "Pôr no carrinho"}: ${item.name}`}>
              {entry.checked && <Check size={16} />}
            </button>
            <ItemVisual item={item} />
            <div className="trip-name">
              <strong>{item.name}</strong>
              <small>tem {fmt(item.unopenedQty + item.openedQty)} {item.unit}{entry.suggested !== null ? ` · sugestão ${fmt(entry.suggested)}` : " · fora da lista"}</small>
            </div>
            <div className="trip-qty">
              <button type="button" onClick={() => step(entry, -1)} aria-label={`Menos ${item.name}`} disabled={entry.qty <= 0}><Minus size={15} /></button>
              <input inputMode="decimal" value={String(entry.qty).replace(".", ",")} aria-label={`Quantidade de ${item.name} (${item.unit})`}
                onChange={(event) => { const value = Number(event.target.value.replace(",", ".")); if (Number.isFinite(value) && value >= 0) change(entry.itemId, { qty: value, checked: value > 0 ? entry.checked : false }); }} />
              <button type="button" onClick={() => step(entry, 1)} aria-label={`Mais ${item.name}`}><Plus size={15} /></button>
              <span>{item.unit}</span>
            </div>
          </li>;
        })}
        {!entries.length && <li className="trip-empty">Nada na lista de compras agora. Adicione abaixo o que for comprar.</li>}
      </ul>
      {others.length > 0 && <label className="trip-add">
        <Plus size={15} />
        <select value={adding} onChange={(event) => addItem(event.target.value)} aria-label="Adicionar outro item à compra">
          <option value="">Comprar outro item…</option>
          {others.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>}
      {error && <p className="modal-error">{error}</p>}
      <div className="modal-actions trip-actions">
        <button type="button" className="modal-delete" onClick={cancelTrip}>Descartar ida</button>
        <button type="button" className="primary-button" disabled={!checked.length || saving} onClick={finish}>
          <ShoppingBasket size={16} /> {saving ? "Registrando…" : checked.length ? `Registrar ${checked.length} ${checked.length === 1 ? "compra" : "compras"}` : "Registrar compras"}
        </button>
      </div>
    </section>
  </div>;
}
