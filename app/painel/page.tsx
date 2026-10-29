import Dashboard from "../dashboard-client";
import { redirect } from "next/navigation";
import { getDb } from "../../db";
import { getSessionMember } from "../auth-session";

export const dynamic = "force-dynamic";

export default async function Painel() {
  const member = await getSessionMember(getDb());
  if (!member?.active) redirect("/");
  return <Dashboard />;
}
