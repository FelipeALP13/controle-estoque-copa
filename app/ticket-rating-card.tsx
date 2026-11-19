"use client";

import { useState } from "react";
import Star from "lucide-react/icons/star";
import Check from "lucide-react/icons/check";
import Copy from "lucide-react/icons/copy";
import LinkIcon from "lucide-react/icons/link";
import { MAX_RATING_COMMENT, RATING_LABELS } from "./ticket-rating";

type Rated = { rating: number | null; ratingComment: string; requesterName: string; ratedBy?: string | null };

/** Link para o cliente avaliar: quem atende gera e copia para mandar por e-mail ou WhatsApp. */
function SurveyLink({ onGetLink }: { onGetLink: () => Promise<string> }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  async function copy() {
    setBusy(true); setError("");
    try {
      const link = url || await onGetLink();
      setUrl(link);
      try { await navigator.clipboard.writeText(link); setCopied(true); window.setTimeout(() => setCopied(false), 2500); } catch { /* sem permissão: o link fica visível para copiar */ }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível gerar o link.");
    } finally {
      setBusy(false);
    }
  }
  return <div className="survey-link-card">
    <div><strong><LinkIcon size={14} /> Avaliação do cliente</strong><p>Mande este link ao cliente para ele dar a nota do atendimento (sem login). A nota entra na média do time e de quem atendeu.</p></div>
    {url && <input readOnly value={url} onFocus={(event) => event.target.select()} aria-label="Link de avaliação" />}
    <button type="button" className="secondary-button" disabled={busy} onClick={copy}>{copied ? <><Check size={15} /> Copiado</> : <><Copy size={15} /> {url ? "Copiar de novo" : "Copiar link de avaliação"}</>}</button>
    {error && <p className="modal-error">{error}</p>}
  </div>;
}

/** Avaliação do atendimento: quem abriu (ou o cliente, pelo link) dá a nota; depois, todos veem o resultado. */
export default function TicketRatingCard({ ticket, canRateNow, onRate, onGetLink }: { ticket: Rated; canRateNow: boolean; onRate: (rating: number, comment: string) => Promise<void>; onGetLink?: () => Promise<string> }) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (ticket.rating !== null) {
    return <div className="rating-card done">
      <span className="rating-stars" aria-label={`Nota ${ticket.rating} de 5`}>{[1, 2, 3, 4, 5].map((value) => <Star key={value} size={16} className={value <= ticket.rating! ? "on" : ""} />)}</span>
      <div><strong>{RATING_LABELS[ticket.rating]} · {ticket.ratedBy === "client" ? "avaliação do cliente" : `avaliação de ${ticket.requesterName}`}</strong>{ticket.ratingComment && <p>“{ticket.ratingComment}”</p>}</div>
    </div>;
  }
  if (!canRateNow) return onGetLink ? <SurveyLink onGetLink={onGetLink} /> : null;

  const shown = hover || rating;
  return <div className="rating-card">
    <strong>Como foi o atendimento?</strong>
    <div className="rating-pick" role="radiogroup" aria-label="Nota de 1 a 5" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" role="radio" aria-checked={rating === value} aria-label={`${value} — ${RATING_LABELS[value]}`} className={value <= shown ? "on" : ""} onMouseEnter={() => setHover(value)} onFocus={() => setHover(value)} onBlur={() => setHover(0)} onClick={() => setRating(value)}><Star size={22} /></button>)}
      <span>{shown ? RATING_LABELS[shown] : "Escolha de 1 a 5 estrelas"}</span>
    </div>
    {rating > 0 && <>
      <textarea aria-label="Comentário da avaliação (opcional)" rows={2} maxLength={MAX_RATING_COMMENT} value={comment} onChange={(event) => setComment(event.target.value)} placeholder={rating <= 3 ? "O que poderia ter sido melhor? (opcional)" : "Quer deixar um elogio? (opcional)"} />
      <button type="button" className="primary-button" disabled={busy} onClick={async () => {
        setBusy(true); setError("");
        try { await onRate(rating, comment); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível enviar."); setBusy(false); }
      }}>{busy ? "Enviando..." : "Enviar avaliação"}</button>
    </>}
    {error && <p className="modal-error">{error}</p>}
  </div>;
}
