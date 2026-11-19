"use client";

// Administração → Marca: nome, frase, logo e cor do Portal (white label). Vale para todos na hora.
import { useRef, useState } from "react";
import Palette from "lucide-react/icons/palette";
import Upload from "lucide-react/icons/upload";
import { ImageCropper } from "./image-cropper";
import { makeAppIcons } from "./app-icons";
import RotateCcw from "lucide-react/icons/rotate-ccw";
import Users from "lucide-react/icons/users";
import { BRAND_LIMITS, BRAND_PRESETS, DEFAULT_BRAND, brandPalette, contrast, isHexColor } from "./brand-theme";
import { BrandLogo, useBrand, type PublicBrand } from "./brand-context";

async function post(body: BodyInit, json: boolean) {
  const response = await fetch("/api/brand", { method: "POST", headers: json ? { "Content-Type": "application/json" } : undefined, body });
  const data = await response.json() as { brand?: PublicBrand; error?: string };
  if (!response.ok || !data.brand) throw new Error(data.error || "Não foi possível salvar a marca.");
  return data.brand;
}

export function BrandPanel() {
  const { brand, setBrand } = useBrand();
  const [form, setForm] = useState({ name: brand.name, shortName: brand.shortName, tagline: brand.tagline, color: brand.color });
  const [hex, setHex] = useState(brand.color);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const color = isHexColor(form.color) ? form.color : brand.color;
  const palette = brandPalette(color).light;
  const lightColor = contrast("#ffffff", color) < 3;
  const changed = form.name !== brand.name || form.shortName !== brand.shortName || form.tagline !== brand.tagline || form.color !== brand.color;

  function pickColor(value: string) {
    setHex(value);
    if (isHexColor(value)) setForm((current) => ({ ...current, color: value.toLowerCase() }));
  }

  /** keepForm: trocar o logo não descarta o que foi digitado e ainda não foi salvo. */
  async function run(action: () => Promise<PublicBrand>, done: string, keepForm = false) {
    setBusy(true); setError(""); setNotice("");
    try {
      const saved = await action();
      setBrand(saved);
      if (!keepForm) {
        setForm({ name: saved.name, shortName: saved.shortName, tagline: saved.tagline, color: saved.color });
        setHex(saved.color);
      }
      setNotice(done);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar a marca.");
    } finally {
      setBusy(false);
    }
  }

  // Logo escolhido esperando o recorte (dá para usar sem recortar: logos largos).
  const [cropping, setCropping] = useState<File | null>(null);
  function uploadLogo(file: File | undefined) {
    if (!file) return;
    const data = new FormData();
    data.set("file", file);
    // Os ícones de instalar no celular/computador são gerados aqui mesmo, a partir do logo.
    void run(async () => {
      const icons = await makeAppIcons(file);
      if (icons) { data.set("icon512", icons.icon512, "icon-512.png"); data.set("icon192", icons.icon192, "icon-192.png"); }
      return post(data, false);
    }, "Logo atualizado para todos (também nos ícones de instalar o Portal).", true);
    if (fileRef.current) fileRef.current.value = "";
  }

  // Pré-visualização: só esta caixa usa a cor nova até salvar.
  const previewStyle = Object.fromEntries(Object.entries(palette)) as React.CSSProperties;

  return <section className="report-card brand-settings">
    <div className="report-card-head"><div><h3><Palette size={16} /> Marca do Portal</h3><p>Nome, logo e cor da empresa. Muda o login, o menu, a aba do navegador, os botões e os avisos no celular, para toda a equipe.</p></div></div>
    <div className="brand-settings-grid">
      <div className="brand-settings-form">
        <label><span>Nome do sistema</span><input maxLength={BRAND_LIMITS.name} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder={DEFAULT_BRAND.name} /></label>
        <label><span>Nome curto <em>(ícone na tela inicial do celular)</em></span><input maxLength={BRAND_LIMITS.shortName} value={form.shortName} onChange={(event) => setForm({ ...form, shortName: event.target.value })} placeholder="Portal" /></label>
        <label><span>Frase embaixo do nome <em>(opcional)</em></span><input maxLength={BRAND_LIMITS.tagline} value={form.tagline} onChange={(event) => setForm({ ...form, tagline: event.target.value })} placeholder="Sistema interno" /></label>
        <div className="brand-color-field">
          <span>Cor principal</span>
          <div className="brand-swatches" role="radiogroup" aria-label="Cores sugeridas">
            {BRAND_PRESETS.map((preset) => <button key={preset} type="button" role="radio" aria-checked={form.color === preset} aria-label={preset} className={form.color === preset ? "brand-swatch active" : "brand-swatch"} style={{ background: preset }} onClick={() => pickColor(preset)} />)}
            <label className="brand-swatch custom" title="Outra cor"><input type="color" value={color} onChange={(event) => pickColor(event.target.value)} aria-label="Escolher outra cor" /></label>
            <input className="brand-hex" value={hex} maxLength={7} spellCheck={false} onChange={(event) => pickColor(event.target.value.trim())} aria-label="Código da cor" />
          </div>
          {lightColor && <small className="brand-hint">Cor clara: o texto dos botões fica escuro para continuar legível.</small>}
        </div>
        <div className="brand-logo-field">
          <span>Logo <em>(PNG, JPG ou WebP, até 1 MB; de preferência quadrado)</em></span>
          <div className="brand-logo-row">
            <span className="brand-logo-preview"><BrandLogo fallback={<Users size={22} />} /></span>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => { const picked = event.target.files?.[0]; if (fileRef.current) fileRef.current.value = ""; if (picked) setCropping(picked); }} />
            {cropping && <ImageCropper file={cropping} shape="square" title="Ajustar o logo" allowOriginal onCancel={() => setCropping(null)} onDone={(cropped) => { setCropping(null); uploadLogo(cropped); }} />}
            <button type="button" className="secondary-button" disabled={busy} onClick={() => fileRef.current?.click()}><Upload size={14} /> {brand.logoUrl ? "Trocar logo" : "Enviar logo"}</button>
            {brand.logoUrl && <button type="button" className="link-button danger" disabled={busy} onClick={() => { if (window.confirm("Remover o logo? Volta o ícone padrão.")) void run(() => post(JSON.stringify({ action: "removeLogo" }), true), "Logo removido.", true); }}>Remover</button>}
          </div>
        </div>
      </div>

      <div className="brand-preview" style={previewStyle} aria-label="Pré-visualização">
        <span className="brand-preview-label">Pré-visualização</span>
        <div className="brand-preview-side">
          <span className={brand.logoUrl ? "brand-mark has-logo" : "brand-mark"}><BrandLogo fallback={<Users size={19} />} /></span>
          <div><strong>{form.name || DEFAULT_BRAND.name}</strong>{form.tagline && <small>{form.tagline}</small>}</div>
        </div>
        <div className="brand-preview-body">
          <span className="brand-preview-chip">Em andamento</span>
          <p>Chamado <a href="#" onClick={(event) => event.preventDefault()}>#1042</a> atualizado.</p>
          <button type="button" className="primary-button" tabIndex={-1}>Botão principal</button>
        </div>
      </div>
    </div>
    <div className="brand-settings-actions">
      <button className="primary-button" disabled={busy || !changed || form.name.trim().length < 2} onClick={() => void run(() => post(JSON.stringify({ action: "save", ...form }), true), "Marca salva. Já vale para toda a equipe.")}>{busy ? "Salvando..." : "Salvar marca"}</button>
      {changed && <button className="secondary-button" disabled={busy} onClick={() => { setForm({ name: brand.name, shortName: brand.shortName, tagline: brand.tagline, color: brand.color }); setHex(brand.color); }}>Desfazer</button>}
      <button className="link-button" disabled={busy} onClick={() => { if (window.confirm("Voltar ao nome, cor e ícone padrão do Portal?")) void run(() => post(JSON.stringify({ action: "reset" }), true), "Marca padrão restaurada."); }}><RotateCcw size={13} /> Restaurar padrão</button>
    </div>
    {notice && <p className="sessions-notice">{notice}</p>}
    {error && <p className="modal-error">{error}</p>}
  </section>;
}
