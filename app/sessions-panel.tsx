"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Laptop from "lucide-react/icons/laptop";
import Smartphone from "lucide-react/icons/smartphone";
import { parseStamp } from "./session-policy";

type Session = { id: number; device: string; createdAt: string; lastSeenAt: string; current: boolean };

async function post<T>(payload: Record<string, unknown>) {
  const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir.");
  return data;
}

/** Encerra as sessões de outra pessoa (administrador). Devolve quantas foram encerradas. */
export async function endMemberSessions(memberId: number) {
  return (await post<{ ended: number }>({ action: "endMemberSessions", memberId })).ended;
}

function when(value: string) {
  const time = parseStamp(value);
  if (!Number.isFinite(time)) return "";
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 20) return "em uso agora";
  if (minutes < 60) return `usado há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `usado há ${hours} h`;
  return `usado há ${Math.round(hours / 24)} ${Math.round(hours / 24) === 1 ? "dia" : "dias"}`;
}

const isPhone = (device: string) => /iPhone|Android|iPad/.test(device);

/** Meu perfil: aparelhos onde estou logado, com "encerrar os outros" e "sair de todos". */
export default function SessionsPanel() {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      setSessions((await post<{ sessions: Session[] }>({ action: "listSessions" })).sessions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar.");
    }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  async function end(all: boolean) {
    if (all && !window.confirm("Sair de todos os aparelhos, inclusive deste? Você vai precisar entrar de novo com a senha.")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await post<{ ended: number; loggedOut: boolean }>({ action: all ? "endAllSessions" : "endOtherSessions" });
      if (result.loggedOut) { router.replace("/"); router.refresh(); return; }
      setNotice(result.ended ? `${result.ended} ${result.ended === 1 ? "sessão encerrada" : "sessões encerradas"}.` : "Não havia outros aparelhos conectados.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível encerrar.");
    } finally {
      setBusy(false);
    }
  }

  const others = sessions?.filter((session) => !session.current).length ?? 0;
  return <div className="sessions-panel full">
    <div><strong>Aparelhos conectados</strong><small>Você sai sozinho depois de 7 dias sem usar o Portal num aparelho. Esqueceu logado em outro computador? Encerre aqui.</small></div>
    {sessions === null ? (error ? null : <div className="loading-list"><span /></div>) : <ul>
      {sessions.map((session) => <li key={session.id} className={session.current ? "current" : ""}>
        <span className="sessions-icon">{isPhone(session.device) ? <Smartphone size={15} /> : <Laptop size={15} />}</span>
        <span><b>{session.device}</b><small>{session.current ? "Este aparelho" : when(session.lastSeenAt)}</small></span>
      </li>)}
    </ul>}
    {error && <p className="modal-error">{error}</p>}
    {notice && !error && <p className="sessions-notice">{notice}</p>}
    <div className="sessions-actions">
      <button type="button" className="secondary-button" disabled={busy || others === 0} onClick={() => end(false)}>Encerrar os outros aparelhos{others > 0 ? ` (${others})` : ""}</button>
      <button type="button" className="link-button danger" disabled={busy} onClick={() => end(true)}>Sair de todos</button>
    </div>
  </div>;
}
