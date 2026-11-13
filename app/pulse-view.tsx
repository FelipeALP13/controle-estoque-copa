"use client";

import { useCallback, useEffect, useState } from "react";
import Check from "lucide-react/icons/check";
import Lock from "lucide-react/icons/lock";
import Settings from "lucide-react/icons/settings";
import Smile from "lucide-react/icons/smile";
import Star from "lucide-react/icons/star";
import X from "lucide-react/icons/x";
import { MAX_PULSE_COMMENT, monthLabel, moodOf } from "./people-tools";

type Month = { month: string; count: number; hidden: boolean; averages: { question: string; average: number }[]; overall: number | null; comments: string[] | null };
type Data = { enabled: boolean; questions: string[]; current: { id: number; month: string; questions: string[]; answered: boolean; responses: number; people: number } | null; history: Month[]; minAnswers: number; me: { id: number; isAdmin: boolean } };

async function call(payload: Record<string, unknown>) {
  const response = await fetch("/api/pulse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json() as { error?: string; appliedNow?: boolean };
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir.");
  return data;
}
const SCORE_LABELS = ["", "Muito ruim", "Ruim", "Ok", "Bom", "Ótimo"];
const moodLabels = { good: "Bom", ok: "Atenção", bad: "Preocupante", none: "Sem dados" } as const;
const comma = (value: number) => value.toFixed(1).replace(".", ",");

/** Pesquisa de clima mensal: anônima, poucas perguntas, médias para todos depois que o mês fecha. */
export default function PulseView() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [configuring, setConfiguring] = useState(false);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/pulse", { cache: "no-store" });
      const json = await response.json() as Data & { error?: string };
      if (!response.ok) throw new Error(json.error || "Não foi possível carregar.");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar.");
    }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  if (!data) return error ? <div className="alert error"><span>{error}</span></div> : <div className="loading-list"><span /><span /></div>;
  const shown = data.history.filter((month) => !month.hidden).slice(0, 6).reverse();
  return <div className="reviews-tab">
    {error && <div className="alert error"><span>{error}</span><button onClick={() => setError("")} aria-label="Fechar aviso"><X size={16} /></button></div>}
    {!data.enabled ? <div className="empty-state"><span><Smile /></span><h3>Pesquisa de clima desligada</h3><p>Todo mês, 2 ou 3 perguntas rápidas e anônimas para acompanhar como a equipe está entre uma avaliação e outra.</p>{data.me.isAdmin && <div><button className="primary-button" onClick={() => setConfiguring(true)}><Settings size={15} /> Ligar e configurar</button></div>}</div>
      : data.current && (data.current.answered ? <section className="review-hero">
        <div><h2><Check size={18} /> Você já respondeu a pesquisa de {monthLabel(data.current.month)}. Obrigado!</h2><p><Lock size={12} /> Anônima. O resultado aparece aqui quando o mês fechar (com pelo menos {data.minAnswers} respostas).</p></div>
        <div className="review-progress"><strong>{data.current.responses}/{data.current.people}</strong><span>responderam</span><i className="usage-bar"><b style={{ width: `${data.current.people ? (data.current.responses / data.current.people) * 100 : 0}%` }} /></i></div>
      </section> : <PulseForm current={data.current} onSent={load} />)}

    {data.enabled && <section className="client-section">
      <header><h3>Como a equipe está</h3><span className="sprint-actions">{data.me.isAdmin && <button className="secondary-button" onClick={() => setConfiguring(true)}><Settings size={14} /> Configurar</button>}</span></header>
      {shown.length ? <>
        <div className="pulse-trend" aria-label="Média geral por mês">{shown.map((month) => <div key={month.month} className={`pulse-bar ${moodOf(month.overall)}`} title={`${monthLabel(month.month)}: ${comma(month.overall ?? 0)}`}>
          <i style={{ height: `${((month.overall ?? 0) / 5) * 100}%` }} /><b>{comma(month.overall ?? 0)}</b><small>{monthLabel(month.month).slice(0, 3)}</small>
        </div>)}</div>
        <div className="result-grid">{data.history.slice(0, 6).map((month) => <PulseMonth key={month.month} month={month} minAnswers={data.minAnswers} />)}</div>
      </> : <p className="muted">Os resultados aparecem quando um mês fecha com pelo menos {data.minAnswers} respostas{data.history.length ? "." : ". A primeira pesquisa é a deste mês."}</p>}
      <p className="muted small"><Lock size={11} /> As respostas não guardam quem respondeu. Todos veem as médias; os comentários ficam só com os administradores.</p>
    </section>}
    {configuring && <PulseSettings data={data} onClose={() => setConfiguring(false)} onSaved={async () => { setConfiguring(false); await load(); }} />}
  </div>;
}

function PulseForm({ current, onSent }: { current: NonNullable<Data["current"]>; onSent: () => Promise<void> }) {
  const [scores, setScores] = useState<number[]>(() => current.questions.map(() => 0));
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const complete = scores.every((score) => score > 0);
  return <form className="client-section pulse-form" onSubmit={async (event) => { event.preventDefault(); if (!complete) return; setSaving(true); setError(""); try { await call({ action: "submit", surveyId: current.id, scores, comment }); await onSent(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível enviar."); setSaving(false); } }}>
    <header><div><h3>Pesquisa de clima de {monthLabel(current.month)}</h3></div><span className="muted"><Lock size={12} /> Anônima · {current.responses} de {current.people} já responderam</span></header>
    <div className="review-criteria">{current.questions.map((question, index) => <div key={question} className="review-criterion">
      <span>{question}</span>
      <div role="radiogroup" aria-label={question}>{[1, 2, 3, 4, 5].map((value) => <button type="button" key={value} role="radio" aria-checked={scores[index] === value} className={scores[index] >= value ? "on" : ""} onClick={() => setScores((list) => list.map((score, position) => position === index ? value : score))} title={SCORE_LABELS[value]}><Star size={20} /></button>)}</div>
      <small>{SCORE_LABELS[scores[index]] || "Escolha de 1 a 5"}</small>
    </div>)}</div>
    <label className="full review-comment"><span>Quer contar algo? <em>opcional</em></span><textarea rows={3} maxLength={MAX_PULSE_COMMENT} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="O que ajudou ou atrapalhou este mês. Só os administradores leem, sem saber quem escreveu." /></label>
    {error && <p className="modal-error">{error}</p>}
    <div className="pulse-actions"><button className="primary-button" disabled={saving || !complete}>{saving ? "Enviando..." : "Enviar resposta"}</button></div>
  </form>;
}

function PulseMonth({ month, minAnswers }: { month: Month; minAnswers: number }) {
  const [open, setOpen] = useState(false);
  const mood = moodOf(month.overall);
  return <article className="result-card">
    <header><div><strong>{monthLabel(month.month)}</strong><small>{month.count} resposta{month.count === 1 ? "" : "s"}{month.hidden ? "" : ` · ${moodLabels[mood]}`}</small></div>{month.overall !== null && <b className={`result-overall pulse-${mood}`}>{comma(month.overall)}</b>}</header>
    {month.hidden ? <p className="muted">Precisa de pelo menos {minAnswers} respostas para mostrar.</p> : <>
      <ul className="result-bars">{month.averages.map((item) => <li key={item.question}><span>{item.question}</span><i><b style={{ width: `${(item.average / 5) * 100}%` }} className={item.average < 3 ? "low" : item.average >= 4 ? "high" : ""} /></i><em>{comma(item.average)}</em></li>)}</ul>
      {month.comments && month.comments.length > 0 && <button className="link-button" onClick={() => setOpen((value) => !value)}>{open ? "Esconder comentários" : `Ver comentários (${month.comments.length})`}</button>}
      {open && month.comments && <ul className="result-comments">{month.comments.map((comment, index) => <li key={index}>“{comment}”</li>)}</ul>}
    </>}
  </article>;
}

function PulseSettings({ data, onClose, onSaved }: { data: Data; onClose: () => void; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(data.enabled);
  const [questions, setQuestions] = useState(data.questions.join("\n"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><form className="modal" onSubmit={async (event) => { event.preventDefault(); setSaving(true); setError(""); try { const result = await call({ action: "saveSettings", enabled, questions }); if (enabled && !result.appliedNow && data.current) window.alert("Salvo. Como alguém já respondeu este mês, as perguntas novas valem a partir do próximo mês."); onSaved(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível salvar."); setSaving(false); } }}>
    <div className="modal-head"><div><h2>Configurar</h2><p>A pesquisa abre sozinha todo dia 1º e todos recebem aviso no sino; no dia 20, quem não respondeu recebe lembrete.</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
    <div className="form-grid">
      <label className="checkbox-line full"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> <span>Pesquisa mensal ligada</span></label>
      <label className="full"><span>Perguntas (uma por linha, até 5; resposta de 1 a 5)</span><textarea rows={5} value={questions} onChange={(event) => setQuestions(event.target.value)} /></label>
    </div>
    {error && <p className="modal-error">{error}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={saving}>{saving ? "Salvando..." : "Salvar"}</button></div>
  </form></div>;
}
