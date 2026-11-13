import { redirect } from "next/navigation";
import { getDb } from "../../db";
import { getSessionMember } from "../auth-session";
import TvBoard from "../tv-board";

export const dynamic = "force-dynamic";

export const metadata = { title: "Fila na TV · Portal da Equipe" };

/** Tela para deixar numa TV da sala: fila de chamados, plantão e números do dia. Precisa estar logado. */
export default async function Tv() {
  const member = await getSessionMember(getDb());
  if (!member?.active) redirect("/");
  return <TvBoard />;
}
