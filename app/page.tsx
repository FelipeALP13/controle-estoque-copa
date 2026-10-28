import { headers } from "next/headers";
import Dashboard from "./dashboard-client";
import { chatGPTSignInPath, getChatGPTUser } from "./chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ showLogin?: string }> }) {
  const user = await getChatGPTUser();
  const host = (await headers()).get("host") ?? "";
  const localPreview = host.startsWith("127.0.0.1") || host.startsWith("localhost");
  const params = await searchParams;
  if (user || (localPreview && params.showLogin !== "1")) return <Dashboard />;

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand"><span>☕</span><div><strong>Estoque da Copa</strong><small>Controle interno da equipe</small></div></div>
        <div className="login-visual"><span>🍪</span><span>☕</span><span>🥛</span></div>
        <p className="eyebrow">ACESSO SEGURO</p>
        <h1>Entre para cuidar do estoque da equipe</h1>
        <p>Use sua conta autorizada. Suas compras, aberturas e consumos ficarão registrados no seu nome.</p>
        <a className="login-button" href={chatGPTSignInPath("/")} target="_top">Entrar com minha conta <span>→</span></a>
        <small className="login-note">Acesso exclusivo para membros autorizados.</small>
      </section>
    </main>
  );
}
