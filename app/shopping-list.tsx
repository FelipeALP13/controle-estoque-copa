"use client";

import CalendarClock from "lucide-react/icons/calendar-clock";
import FileDown from "lucide-react/icons/file-down";
import PackageCheck from "lucide-react/icons/package-check";
import ShoppingCart from "lucide-react/icons/shopping-cart";
import { COVER_OPTIONS, daysLeftLabel, shoppingMessage, type ShoppingLine } from "./stock-forecast";
import { downloadXlsx } from "./xlsx-writer";

const fmt = (value: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
const fullDate = (day: string) => day.split("-").reverse().join("/");

export const urgencyLabel = { now: "Comprar já", soon: "Comprar", later: "Em breve", ok: "Em dia" } as const;

/** Link do WhatsApp com a lista pronta. */
export function shoppingWhatsAppUrl(lines: readonly ShoppingLine[], appName: string, coverDays: number) {
  return `https://wa.me/?text=${encodeURIComponent(shoppingMessage(lines, appName, coverDays, new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date())))}`;
}

/** Planilha da lista de compras (para levar ao mercado ou mandar ao financeiro). */
export function downloadShoppingList(lines: readonly ShoppingLine[], coverDays: number, today: string) {
  downloadXlsx(`lista-de-compras-${today}.xlsx`, [{
    name: "Lista de compras",
    columns: [
      { header: "Item", width: 28 }, { header: "Categoria", width: 16 }, { header: "Comprar", type: "number", width: 10 }, { header: "Unidade", width: 10 },
      { header: "Saldo atual", type: "number", width: 12 }, { header: "Estoque mínimo", type: "number", width: 14 }, { header: "Acaba em (dias)", type: "number", width: 15 },
      { header: "Prioridade", width: 13 }, { header: "Motivo", width: 22 },
    ],
    rows: [
      ...lines.map((line) => [line.name, line.category, line.buy, line.unit, line.available, line.minimumQty, line.daysLeft === null ? null : Math.round(line.daysLeft), urgencyLabel[line.urgency], line.reason]),
      [],
      [`Quantidades para cerca de ${coverDays} dias de consumo, mais o estoque mínimo.`],
    ],
  }]);
}

/** Lista de compras completa, no Planejamento. */
export function ShoppingPanel({ lines, upcoming, coverDays, onCoverDays, appName, today }: { lines: ShoppingLine[]; upcoming: (ShoppingLine | (Omit<ShoppingLine, "buy" | "reason">))[]; coverDays: number; onCoverDays: (days: number) => void; appName: string; today: string }) {
  return <section className="shopping-panel">
    <div className="shopping-head">
      <div><span className="insight-icon"><ShoppingCart /></span><div><h3>Lista de compras automática</h3><p>Montada pelo saldo, pelo estoque mínimo e pelo ritmo de consumo de cada item.</p></div></div>
      <div className="shopping-tools">
        <label>Comprar para <select value={coverDays} onChange={(event) => onCoverDays(Number(event.target.value))}>{COVER_OPTIONS.map((days) => <option key={days} value={days}>{days} dias</option>)}</select></label>
        {lines.length > 0 && <>
          <a className="secondary-button" href={shoppingWhatsAppUrl(lines, appName, coverDays)} target="_blank" rel="noopener noreferrer">Enviar no WhatsApp</a>
          <button className="secondary-button" onClick={() => downloadShoppingList(lines, coverDays, today)}><FileDown size={15} /> Excel</button>
        </>}
      </div>
    </div>
    {lines.length ? <table className="shopping-table">
      <thead><tr><th>Item</th><th>Comprar</th><th>Tem agora</th><th>Previsão</th><th>Prioridade</th></tr></thead>
      <tbody>{lines.map((line) => <tr key={line.id} className={line.urgency}>
        <td><strong>{line.name}</strong><small>{line.category}</small></td>
        <td><b>{fmt(line.buy)}</b> {line.unit}</td>
        <td>{fmt(line.available)} {line.unit}<small>mínimo {fmt(line.minimumQty)}</small></td>
        <td>{line.reason || "—"}{line.endsOn && line.available > 0 && <small>até {fullDate(line.endsOn)}</small>}</td>
        <td><span className={`urgency ${line.urgency}`}>{urgencyLabel[line.urgency]}</span></td>
      </tr>)}</tbody>
    </table> : <div className="insight-empty"><PackageCheck /><div><strong>Nada para comprar agora</strong><p>Nenhum item acabou, está no mínimo ou acaba nos próximos 7 dias.</p></div></div>}
    {upcoming.length > 0 && <div className="shopping-upcoming">
      <h4><CalendarClock size={14} /> De olho (acabam em 8 a 14 dias)</h4>
      <ul>{upcoming.map((line) => <li key={line.id}><strong>{line.name}</strong><span>{daysLeftLabel(line.daysLeft)}{line.endsOn && ` · ${fullDate(line.endsOn)}`}</span></li>)}</ul>
    </div>}
  </section>;
}
