"use client";

import { useState } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";

export default function ResetPasswordScreen() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (password !== confirmation) { setError("As senhas não são iguais."); return; }
    setLoading(true);
    try {
      const token = new URLSearchParams(window.location.search).get("token") || "";
      const response = await fetch("/api/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", token, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível alterar a senha.");
      setSuccess(data.message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível alterar a senha.");
    } finally {
      setLoading(false);
    }
  }

  return <main className="login-page reset-page"><form className="reset-card" onSubmit={submit}>
    <div className="login-brand"><span>☕</span><div><strong>Estoque da Firma</strong><small>Recuperação de acesso</small></div></div>
    <div className="reset-icon"><KeyRound /></div>
    <p className="eyebrow">NOVA SENHA</p>
    <h1>Crie uma nova senha</h1>
    <p>Escolha uma senha com pelo menos 6 caracteres. Ao concluir, os acessos antigos serão encerrados.</p>
    {!success && <>
      <label><span>Nova senha</span><div className="login-input"><KeyRound /><input autoFocus required minLength={6} type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mínimo de 6 caracteres" /><button type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff /> : <Eye />}</button></div></label>
      <label><span>Confirmar nova senha</span><div className="login-input"><KeyRound /><input required minLength={6} type={showPassword ? "text" : "password"} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Digite novamente" /></div></label>
    </>}
    {error && <p className="login-error">{error}</p>}
    {success ? <><p className="login-success">{success}</p><a className="login-submit reset-login-link" href="/">Voltar para o login <span>→</span></a></> : <button className="login-submit" disabled={loading}>{loading ? "Alterando..." : "Alterar senha"}<span>→</span></button>}
  </form></main>;
}
