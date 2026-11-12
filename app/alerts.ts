// Avisos automáticos: montagem das mensagens do Teams e regra do horário diário.
// Regras puras (sem banco e sem rede), usadas pelas rotinas do agendador e pelos testes.

/** Data (AAAA-MM-DD) e hora em Brasília (UTC-3, sem horário de verão). */
export function saoPaulo(now: Date) {
  const local = new Date(now.getTime() - 3 * 3600000);
  return { day: local.toISOString().slice(0, 10), hour: local.getUTCHours() };
}

/** O alerta diário sai uma vez por dia, a partir da hora escolhida. */
export function dailyDue(lastSentDay: string | null, now: Date, targetHour: number) {
  const { day, hour } = saoPaulo(now);
  return lastSentDay !== day && hour >= targetHour;
}

export const formatQty = (value: number) => (Number.isInteger(value) ? String(value) : value.toLocaleString("pt-BR", { maximumFractionDigits: 2 }));

/** Link do Teams aceito: o "Workflow" do Power Automate ou o webhook antigo do Office 365. */
export function isTeamsWebhook(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") return false;
    return /\.logic\.azure\.com$/i.test(url.hostname) || /\.webhook\.office\.com$/i.test(url.hostname) || /(^|\.)powerplatform\.com$/i.test(url.hostname) || /\.environment\.api\.powerplatform\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

type Line = { text: string; detail?: string; alert?: boolean };

/** Mensagem do Teams no formato "Adaptive Card" (aceito pelos Workflows do Teams). */
export function teamsCard(title: string, intro: string, lines: Line[], link?: { label: string; url: string }) {
  const body: unknown[] = [
    { type: "TextBlock", text: title, weight: "Bolder", size: "Medium", wrap: true },
    { type: "TextBlock", text: intro, wrap: true, isSubtle: true, spacing: "Small" },
    ...lines.slice(0, 25).map((line) => ({
      type: "ColumnSet", spacing: "Small",
      columns: [
        { type: "Column", width: "stretch", items: [{ type: "TextBlock", text: line.text, wrap: true, ...(line.alert ? { color: "Attention", weight: "Bolder" } : {}) }] },
        ...(line.detail ? [{ type: "Column", width: "auto", items: [{ type: "TextBlock", text: line.detail, isSubtle: true, wrap: true }] }] : []),
      ],
    })),
  ];
  if (lines.length > 25) body.push({ type: "TextBlock", text: `…e mais ${lines.length - 25}`, isSubtle: true });
  return {
    type: "message",
    attachments: [{
      contentType: "application/vnd.microsoft.card.adaptive",
      content: {
        $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.4", body,
        ...(link ? { actions: [{ type: "Action.OpenUrl", title: link.label, url: link.url }] } : {}),
      },
    }],
  };
}

export type LowItem = { name: string; available: number; minimum: number; unit: string };

export function stockAlertCard(items: readonly LowItem[], portalUrl: string | null, dayLabel: string) {
  if (!items.length) return teamsCard("Copa: estoque em dia", `Situação de ${dayLabel}. Nenhum item no estoque mínimo.`, [], portalUrl ? { label: "Abrir o estoque no Portal", url: portalUrl } : undefined);
  const sorted = [...items].sort((a, b) => a.available - b.available || a.name.localeCompare(b.name, "pt-BR"));
  return teamsCard(
    `Copa: ${items.length} ${items.length === 1 ? "item para repor" : "itens para repor"}`,
    `Situação de ${dayLabel}. Itens no estoque mínimo ou abaixo dele.`,
    sorted.map((item) => ({ text: item.name, detail: `${formatQty(item.available)} de ${formatQty(item.minimum)} ${item.unit}`, alert: item.available <= 0 })),
    portalUrl ? { label: "Abrir o estoque no Portal", url: portalUrl } : undefined,
  );
}

export type LateTicket = { code: string; title: string; client: string; team: string; reason: "resposta" | "solução"; overdueMinutes: number };

export function formatOverdue(minutes: number) {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

export function lateTicketsCard(tickets: readonly LateTicket[], portalUrl: string | null) {
  return teamsCard(
    `${tickets.length} ${tickets.length === 1 ? "chamado passou" : "chamados passaram"} do prazo`,
    "Avisado uma vez por chamado. Confira quem está cuidando de cada um.",
    tickets.map((ticket) => ({ text: `${ticket.code} · ${ticket.title}`, detail: `${ticket.client || ticket.team} · sem ${ticket.reason} há ${formatOverdue(ticket.overdueMinutes)}`, alert: true })),
    portalUrl ? { label: "Abrir os chamados no Portal", url: portalUrl } : undefined,
  );
}
