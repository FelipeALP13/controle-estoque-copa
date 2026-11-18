"use client";

import { useEffect, useState } from "react";
import Star from "lucide-react/icons/star";
import CheckCircle from "lucide-react/icons/circle-check";
import { MAX_RATING_COMMENT, RATING_LABELS } from "./ticket-rating";
import { useBrand } from "./brand-context";

type Info = { code: string; title: string; state: "open" | "pending" | "done"; rating: number | null };

/** Tela do cliente: escolhe de 1 a 5 estrelas, deixa um comentário (opcional) e envia. */
export default function SurveyClient({ token }: { token: string }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState("");
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const { brand } = useBrand();

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch(`/api/survey?token=${encodeURIComponent(token)}`, { cache: "no-store" });
        const data = await response.json() as Info & { error?: string };
        if (!response.ok) throw new Error(data.error || "Link de avaliação inválido.");
        setInfo(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Não foi possível abrir a avaliação.");
      }
    })();
  }, [token]);

  async function send() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/survey", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, rating, comment }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Não foi possível enviar.");
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível enviar.");
    } finally {
      setBusy(false);
    }
  }

  const shown = hover || rating;
  let content: React.ReactNode;
  if (sent || info?.state === "done") {
    content = <div className="survey-done"><CheckCircle size={40} /><h1>Obrigado pela avaliação!</h1><p>Sua opinião ajuda a equipe a atender cada vez melhor.</p></div>;
  } else if (!info) {
    content = error ? <div className="survey-done"><h1>Não foi possível abrir</h1><p>{error}</p></div> : <p className="survey-loading">Carregando…</p>;
  } else if (info.state === "pending") {
    content = <div className="survey-done"><h1>Atendimento em andamento</h1><p>O chamado {info.code} ainda não foi concluído. Assim que for, este mesmo link abre a avaliação.</p></div>;
  } else {
    content = <>
      <small className="survey-code">{info.code}</small>
      <h1>Como foi o nosso atendimento?</h1>
      <p className="survey-title">{info.title}</p>
      <div className="survey-stars" role="radiogroup" aria-label="Nota de 1 a 5" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" role="radio" aria-checked={rating === value} aria-label={`${value} — ${RATING_LABELS[value]}`} className={value <= shown ? "on" : ""} onMouseEnter={() => setHover(value)} onFocus={() => setHover(value)} onBlur={() => setHover(0)} onClick={() => setRating(value)}><Star size={34} /></button>)}
      </div>
      <p className="survey-label">{shown ? RATING_LABELS[shown] : "Toque nas estrelas para dar a nota"}</p>
      {rating > 0 && <>
        <textarea rows={3} maxLength={MAX_RATING_COMMENT} value={comment} onChange={(event) => setComment(event.target.value)} placeholder={rating <= 3 ? "O que poderia ter sido melhor? (opcional)" : "Quer deixar um comentário? (opcional)"} />
        <button type="button" className="survey-send" disabled={busy} onClick={send}>{busy ? "Enviando…" : "Enviar avaliação"}</button>
      </>}
      {error && <p className="survey-error" role="alert">{error}</p>}
    </>;
  }

  return <main className="survey-page">
    <section className="survey-card">{content}</section>
    <footer>{brand.name}</footer>
  </main>;
}
