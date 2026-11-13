"use client";

import { APP_NAME } from "./brand";
import { comingUp, daysLeftLabel, forecastItem, shoppingList } from "./stock-forecast";
import { ShoppingPanel, urgencyLabel } from "./shopping-list";
import BarChart3 from "lucide-react/icons/bar-chart-3";
import CalendarClock from "lucide-react/icons/calendar-clock";
import Ellipsis from "lucide-react/icons/ellipsis";
import History from "lucide-react/icons/history";
import PackageCheck from "lucide-react/icons/package-check";
import PackageOpen from "lucide-react/icons/package-open";
import Pencil from "lucide-react/icons/pencil";
import Plus from "lucide-react/icons/plus";
import Settings2 from "lucide-react/icons/settings-2";
import ShoppingCart from "lucide-react/icons/shopping-cart";
import Trash2 from "lucide-react/icons/trash-2";
import TrendingDown from "lucide-react/icons/trending-down";
import TriangleAlert from "lucide-react/icons/triangle-alert";
import { type MemberPermissions, type Item, type Movement, movementCopy, fmt, toForecast, relativeDate, exactDate, ItemVisual, isoDateInSaoPaulo, LoadingRows } from "./dashboard-shared";

export function StockRow({ item, permissions, onAction, onEdit, onDelete }: { item: Item; permissions: MemberPermissions; onAction: (type: Movement["type"]) => void; onEdit: () => void; onDelete: () => void }) {
  const total = item.unopenedQty + item.openedQty;
  const forecast = forecastItem(toForecast(item), isoDateInSaoPaulo());
  const isLow = forecast.urgency === "now" || forecast.urgency === "soon";
  return (
    <article className="stock-row">
      <div className="item-cell"><ItemVisual item={item} /><div><strong>{item.name}</strong><small>{item.category} · mínimo {fmt(item.minimumQty)} {item.unit}</small></div></div>
      <div className="balance-cell"><strong>{fmt(total)} <small>{item.unit}</small></strong><div><span>{fmt(item.unopenedQty)} fechado</span><i /> <span>{fmt(item.openedQty)} aberto</span></div></div>
      <div><span className={`status ${isLow ? "low" : forecast.urgency === "later" ? "later" : "ok"}`}>{isLow ? <TriangleAlert size={14} /> : <PackageCheck size={14} />}{urgencyLabel[forecast.urgency]}</span></div>
      <div className="duration-cell">{item.analytics.averageDurationDays !== null ? <><strong>{fmt(item.analytics.averageDurationDays)} dias</strong><small>{daysLeftLabel(forecast.daysLeft) || `${item.analytics.monthlyRecommendation} ${item.unit}/30 dias`}</small></> : item.analytics.activeDays !== null ? <><strong>Em medição</strong><small>Há {fmt(item.analytics.activeDays)} dias</small></> : <><strong>Sem histórico</strong><small>Registre abertura e consumo</small></>}</div>
      <div className="opened-cell"><strong>{relativeDate(item.lastOpenedAt)}</strong>{item.lastOpenedAt && <small>{new Intl.DateTimeFormat("pt-BR").format(new Date(item.lastOpenedAt))}</small>}</div>
      <div className="row-actions">
        <details className="mobile-movement-menu">
          <summary aria-label={`Movimentações de ${item.name}`} title="Movimentações"><Ellipsis size={19} /></summary>
          <div className="mobile-movement-popover">
            <button type="button" disabled={!permissions.openItems || item.unopenedQty <= 0} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); onAction("open"); }}><PackageOpen size={17} /><span>Abrir produto</span></button>
            <button type="button" disabled={!permissions.consumeItems || item.openedQty <= 0} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); onAction("consume"); }}><TrendingDown size={17} /><span>Registrar consumo</span></button>
            <button type="button" disabled={!permissions.registerPurchases} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); onAction("purchase"); }}><Plus size={17} /><span>Registrar compra</span></button>
          </div>
        </details>
        <button className="desktop-movement-action" title="Registrar abertura" disabled={!permissions.openItems || item.unopenedQty <= 0} onClick={() => onAction("open")}><PackageOpen size={17} /></button>
        <button className="desktop-movement-action" title="Registrar consumo" disabled={!permissions.consumeItems || item.openedQty <= 0} onClick={() => onAction("consume")}><TrendingDown size={17} /></button>
        <button className="desktop-movement-action" title="Registrar compra" disabled={!permissions.registerPurchases} onClick={() => onAction("purchase")}><ShoppingCart size={17} /></button>
        <button title="Ajustar saldo" disabled={!permissions.adjustStock} onClick={() => onAction("adjust")}><Settings2 size={17} /></button>
        <button title="Editar item" disabled={!permissions.manageItems} onClick={onEdit}><Pencil size={16} /></button>
        <button className="danger-action" title="Excluir item" aria-label={`Excluir ${item.name}`} disabled={!permissions.manageItems} onClick={onDelete}><Trash2 size={16} /></button>
      </div>
    </article>
  );
}

export function PlanningView({ items, loading, shopping, upcoming, coverDays, onCoverDays, today }: { items: Item[]; loading: boolean; shopping: ReturnType<typeof shoppingList>; upcoming: ReturnType<typeof comingUp>; coverDays: number; onCoverDays: (days: number) => void; today: string }) {
  if (loading) return <LoadingRows />;
  const measured = items.filter((item) => item.analytics.averageDurationDays !== null);
  const monthlyTotal = measured.reduce((sum, item) => sum + (item.analytics.monthlyRecommendation ?? 0), 0);
  return (
    <>
      <ShoppingPanel lines={shopping} upcoming={upcoming} coverDays={coverDays} onCoverDays={onCoverDays} appName={APP_NAME} today={today} />
      <div className="planning-summary">
        <article><span className="stat-icon blue"><CalendarClock /></span><div><small>Itens com média calculada</small><strong>{measured.length} de {items.length}</strong><p>Após um ciclo completo de uso</p></div></article>
        <article><span className="stat-icon amber"><ShoppingCart /></span><div><small>Compra estimada por mês</small><strong>{monthlyTotal}</strong><p>Soma dos itens já medidos</p></div></article>
      </div>
      <div className="section-heading planning-title"><div><h2>Duração e previsão por item</h2><p>A média usa os últimos oito ciclos completos e melhora conforme a equipe registra o consumo.</p></div></div>
      {items.length === 0 ? <div className="empty-state"><span><BarChart3 /></span><h3>Ainda não há itens para analisar</h3><p>Cadastre os produtos e registre as aberturas e consumos para gerar as previsões.</p></div> : (
        <div className="planning-grid">
          {items.map((item) => {
            const analytics = item.analytics;
            const measuredItem = analytics.averageDurationDays !== null;
            return <article key={item.id} className="planning-card">
              <div className="planning-card-head"><ItemVisual item={item} /><div><strong>{item.name}</strong><small>{item.category} · {item.unit}</small></div><span className={`measure-badge ${measuredItem ? "ready" : "waiting"}`}>{measuredItem ? "Calculado" : "Em medição"}</span></div>
              <div className="planning-metrics">
                <div><small>Duração média</small><strong>{measuredItem ? `${fmt(analytics.averageDurationDays!)} dias` : analytics.activeDays !== null ? `${fmt(analytics.activeDays)} dias em uso` : "—"}</strong></div>
                <div><small>Sugestão para 30 dias</small><strong>{analytics.monthlyRecommendation ? `${analytics.monthlyRecommendation} ${item.unit}` : "Aguardando dados"}</strong></div>
                <div><small>Cobertura do saldo atual</small><strong>{analytics.estimatedCoverageDays !== null ? `cerca de ${fmt(analytics.estimatedCoverageDays)} dias` : "Aguardando dados"}</strong></div>
                <div><small>Ciclos usados no cálculo</small><strong>{analytics.completedCycles || "Nenhum ainda"}</strong></div>
              </div>
              <p className="planning-note">{measuredItem ? `A última unidade durou ${fmt(analytics.lastDurationDays!)} dias. A recomendação considera o ritmo médio de consumo da equipe.` : analytics.activeDays !== null ? "Este item já está sendo medido. A previsão aparece quando o saldo aberto chegar a zero." : "Abra uma unidade e registre o consumo até zerar para iniciar a medição."}</p>
            </article>;
          })}
        </div>
      )}
    </>
  );
}

export function HistoryView({ movements, loading }: { movements: Movement[]; loading: boolean }) {
  if (loading) return <LoadingRows />;
  return (
    <>
      <div className="section-heading history-title"><div><h2>Atividade recente</h2><p>Compras, aberturas, consumos e ajustes registrados no sistema.</p></div></div>
      {movements.length === 0 ? <div className="empty-state"><span><History /></span><h3>Nenhuma movimentação ainda</h3><p>Quando você registrar uma compra, abertura ou consumo, o evento aparecerá aqui.</p></div> : (
        <div className="history-list">
          {movements.map((movement) => {
            const copy = movementCopy[movement.type];
            const Icon = copy.icon;
            const sign = movement.type === "consume" ? "−" : movement.type === "purchase" ? "+" : "";
            return <article key={movement.id}><span className={`history-icon ${copy.tone}`}><Icon /></span><div><strong>{copy.label} de {movement.itemName}</strong><p>{movement.note || (movement.type === "open" ? "Embalagem colocada em uso" : "Sem observações")} · por {movement.createdByName || "Equipe"}</p></div><div className="history-meta"><strong>{sign}{fmt(Math.abs(movement.quantity))} {movement.unit}</strong><small>{exactDate(movement.createdAt)}</small></div></article>;
          })}
        </div>
      )}
    </>
  );
}
