"use client";

import { useState } from "react";
import Star from "lucide-react/icons/star";
import { MAX_RATING_COMMENT, RATING_LABELS } from "./ticket-rating";

type Rated = { rating: number | null; ratingComment: string; requesterName: string };

/** Avaliação do atendimento: quem abriu dá a nota; depois, todos veem o resultado. */
export default function TicketRatingCard({ ticket, canRateNow, onRate }: { ticket: Rated; canRateNow: boolean; onRate: (rating: number, comment: string) => Promise<void> }) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (ticket.rating !== null) {
    return <div className="rating-card done">
      <span className="rating-stars" aria-label={`Nota ${ticket.rating} de 5`}>{[1, 2, 3, 4, 5].map((value) => <Star key={value} size={16} className={value <= ticket.rating! ? "on" : ""} />)}</span>
      <div><strong>{RATING_LABELS[ticket.rating]} · avaliação de {ticket.requesterName}</strong>{ticket.ratingComment && <p>“{ticket.ratingComment}”</p>}</div>
    </div>;
  }
  if (!canRateNow) return null;

  const shown = hover || rating;
  return <div className="rating-card">
    <strong>Como foi o atendimento?</strong>
    <div className="rating-pick" role="radiogroup" aria-label="Nota de 1 a 5" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" role="radio" aria-checked={rating === value} aria-label={`${value} — ${RATING_LABELS[value]}`} className={value <= shown ? "on" : ""} onMouseEnter={() => setHover(value)} onFocus={() => setHover(value)} onBlur={() => setHover(0)} onClick={() => setRating(value)}><Star size={22} /></button>)}
      <span>{shown ? RATING_LABELS[shown] : "Escolha de 1 a 5 estrelas"}</span>
    </div>
    {rating > 0 && <>
      <textarea rows={2} maxLength={MAX_RATING_COMMENT} value={comment} onChange={(event) => setComment(event.target.value)} placeholder={rating <= 3 ? "O que poderia ter sido melhor? (opcional)" : "Quer deixar um elogio? (opcional)"} />
      <button type="button" className="primary-button" disabled={busy} onClick={async () => {
        setBusy(true); setError("");
        try { await onRate(rating, comment); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível enviar."); setBusy(false); }
      }}>{busy ? "Enviando..." : "Enviar avaliação"}</button>
    </>}
    {error && <p className="modal-error">{error}</p>}
  </div>;
}
