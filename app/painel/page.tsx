import Dashboard from "../dashboard-client";
import { requireChatGPTUser } from "../chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function Painel() {
  await requireChatGPTUser("/painel");
  return <Dashboard />;
}
