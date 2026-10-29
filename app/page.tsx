import { chatGPTSignInPath, getChatGPTUser } from "./chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  const accessPath = user ? "/painel" : chatGPTSignInPath("/painel");
  const displayName = user?.fullName?.split(" ")[0] ?? user?.email;

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand"><span>☕</span><div><strong>Estoque da Firma</strong><small>Café e lanches da galera</small></div></div>
        <div className="login-visual"><span>🍪</span><span>☕</span><span>🥛</span></div>
        <p className="eyebrow">ACESSO SEGURO</p>
        <h1>Identifique-se antes de acessar o estoque</h1>
        <p>Cada compra, abertura e consumo fica salvo no histórico com o nome do membro responsável.</p>

        <div className="login-benefits" aria-label="Recursos do acesso individual">
          <span><b>01</b> Acesso individual por membro</span>
          <span><b>02</b> Registro automático do responsável</span>
          <span><b>03</b> Permissões definidas pelo administrador</span>
        </div>

        {user && (
          <div className="login-account">
            <span>{(displayName || "U").slice(0, 1).toUpperCase()}</span>
            <div><small>Conta identificada</small><strong>{displayName}</strong></div>
          </div>
        )}

        <a className="login-button" href={accessPath} target="_top">
          {user ? `Continuar como ${displayName}` : "Entrar com usuário e senha"}<span>→</span>
        </a>
        <small className="login-note">O administrador cadastra cada membro pelo mesmo e-mail usado no acesso.</small>
      </section>
    </main>
  );
}
