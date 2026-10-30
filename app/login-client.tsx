"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff, LockKeyhole, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";

export default function LoginScreen() {
  const router = useRouter();
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [forgotPassword, setForgotPassword] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [message, setMessage] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/auth", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Não foi possível verificar o acesso.");
        if (data.authenticated) router.replace("/painel");
        else setSetupRequired(Boolean(data.setupRequired));
      })
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : "Não foi possível verificar o acesso.");
        setSetupRequired(false);
      });
  }, [router]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: setupRequired ? "setup" : "login", name, email, username, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível entrar.");
      router.push("/painel");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível entrar.");
      setLoading(false);
    }
  }

  async function submitRecovery(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    setPreviewUrl("");
    try {
      const response = await fetch("/api/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request", email: recoveryEmail }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível enviar o link.");
      setMessage(data.message);
      setPreviewUrl(data.previewUrl || "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível enviar o link.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-layout">
        <div className="login-welcome">
          <div className="login-brand"><span>☕</span><div><strong>Estoque da Firma</strong><small>Café e lanches da galera</small></div></div>
          <div className="login-visual"><span>🍪</span><span>☕</span><span>🥛</span></div>
          <p className="eyebrow">ACESSO DA EQUIPE</p>
          <h1>{setupRequired ? "Vamos criar o primeiro acesso" : "Entre para cuidar do estoque"}</h1>
          <p>{setupRequired ? "Cadastre o administrador. Depois você poderá criar os usuários da equipe e definir cada permissão." : "Cada abertura, compra e consumo fica registrado com o nome da pessoa responsável."}</p>
          <div className="login-benefits" aria-label="Recursos do acesso individual">
            <span><b>01</b> Usuário individual para cada pessoa</span>
            <span><b>02</b> Histórico com o responsável</span>
            <span><b>03</b> Permissões controladas pelo administrador</span>
          </div>
        </div>

        <form className="login-form" onSubmit={forgotPassword ? submitRecovery : submit}>
          <div className="login-form-icon"><LockKeyhole /></div>
          <div><p className="eyebrow">{forgotPassword ? "RECUPERAR ACESSO" : setupRequired ? "PRIMEIRO ACESSO" : "ÁREA RESTRITA"}</p><h2>{forgotPassword ? "Esqueceu a senha?" : setupRequired ? "Criar administrador" : "Acessar o sistema"}</h2><p>{forgotPassword ? "Informe o e-mail cadastrado. Enviaremos um link temporário para você criar uma nova senha." : setupRequired ? "Estes dados serão usados para administrar a equipe." : "Use o usuário e a senha cadastrados pelo administrador."}</p></div>
          {forgotPassword ? <>
            <label><span>E-mail cadastrado</span><input autoFocus required type="email" autoComplete="email" value={recoveryEmail} onChange={(event) => setRecoveryEmail(event.target.value)} placeholder="voce@empresa.com" /></label>
            {message && <p className="login-success">{message}</p>}
            {previewUrl && <a className="recovery-preview" href={previewUrl}>Abrir link de teste local →</a>}
          </> : <>{setupRequired && <>
            <label><span>Nome completo</span><input autoFocus required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Felipe Almeida" /></label>
            <label><span>E-mail</span><input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@empresa.com" /></label>
          </>}
          <label><span>Usuário</span><div className="login-input"><UserRound /><input autoFocus={!setupRequired} required autoCapitalize="none" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Ex.: felipe" /></div></label>
          <label><span>Senha</span><div className="login-input"><LockKeyhole /><input required minLength={setupRequired ? 8 : 1} type={showPassword ? "text" : "password"} autoComplete={setupRequired ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={setupRequired ? "8+ caracteres, letras e números" : "Digite sua senha"} /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}>{showPassword ? <EyeOff /> : <Eye />}</button></div></label>
          {!setupRequired && <button className="forgot-password" type="button" onClick={() => { setForgotPassword(true); setError(""); }}>Esqueceu a senha?</button>}</>}
          {error && <p className="login-error">{error}</p>}
          <button className="login-submit" disabled={loading || setupRequired === null}>{loading ? "Aguarde..." : setupRequired === null ? "Verificando..." : forgotPassword ? "Enviar link por e-mail" : setupRequired ? "Criar acesso e entrar" : "Entrar"}<span>→</span></button>
          {forgotPassword && <button className="back-to-login" type="button" onClick={() => { setForgotPassword(false); setError(""); setMessage(""); }}>← Voltar para o login</button>}
          <small className="login-note">As senhas são protegidas e nunca aparecem para outros usuários.</small>
        </form>
      </section>
    </main>
  );
}
