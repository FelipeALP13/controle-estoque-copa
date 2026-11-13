"use client";

import { useState } from "react";
import Copy from "lucide-react/icons/copy";
import X from "lucide-react/icons/x";

async function post<T>(payload: Record<string, unknown>) {
  const response = await fetch("/api/agenda", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir.");
  return data;
}

/** Assinar a agenda do Portal no Outlook/Teams (só leitura, atualiza sozinho). */
export default function CalendarLinkModal({ hasLink, onClose, onChanged }: { hasLink: boolean; onClose: () => void; onChanged: (hasLink: boolean) => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível concluir."); } finally { setBusy(false); }
  }

  return <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><section className="modal calendar-link" role="dialog" aria-label="Ver a agenda no Outlook">
    <div className="modal-head"><div><h2>Ver no Outlook e no Teams</h2><p>Seus compromissos do Portal aparecem no calendário do Outlook/Teams e se atualizam sozinhos (pode levar algumas horas, quem controla é o Outlook).</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
    <div className="calendar-link-body">
      <ol>
        <li>Clique em <b>{hasLink ? "Gerar link novo" : "Gerar meu link"}</b> e copie.</li>
        <li>No Outlook (web ou aplicativo): <b>Calendário → Adicionar calendário → Assinar da Web</b> (ou “Da Internet”), cole o link e dê um nome, por exemplo “Portal”.</li>
        <li>Pronto: o calendário aparece também no Teams. Para mudar algo, edite no Portal (lá ele é só leitura).</li>
      </ol>
      {url ? <div className="calendar-link-url">
        <b>Copie agora: o link não aparece de novo.</b> Ele é pessoal: quem tiver o link vê seus compromissos.
        <span><code>{url}</code><button type="button" onClick={async () => { try { await navigator.clipboard.writeText(url); setNotice("Link copiado."); } catch { setNotice("Selecione e copie o link manualmente."); } }} aria-label="Copiar link"><Copy size={14} /></button></span>
      </div> : hasLink && <p className="form-hint">Você já tem um link ativo. Gerar um novo desliga o anterior (troque também no Outlook).</p>}
      {notice && <p className="jira-notice">{notice}</p>}
      {error && <p className="modal-error">{error}</p>}
    </div>
    <div className="modal-actions">
      {hasLink && <button type="button" className="secondary-button modal-delete" disabled={busy} onClick={() => run(async () => {
        if (!window.confirm("Desligar o link? O calendário no Outlook para de atualizar.")) return;
        await post({ action: "removeCalendarLink" }); setUrl(""); onChanged(false); setNotice("Link desligado.");
      })}>Desligar link</button>}
      <button type="button" className="secondary-button" onClick={onClose}>Fechar</button>
      <button type="button" className="primary-button" disabled={busy} onClick={() => run(async () => {
        if (hasLink && !window.confirm("Gerar um link novo? O link atual para de funcionar.")) return;
        const result = await post<{ url: string }>({ action: "calendarLink" }); setUrl(result.url); onChanged(true);
      })}>{busy ? "Gerando..." : hasLink ? "Gerar link novo" : "Gerar meu link"}</button>
    </div>
  </section></div>;
}
