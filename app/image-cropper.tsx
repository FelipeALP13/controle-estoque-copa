"use client";

// Recorte de imagem antes de enviar (foto de perfil e logo): arraste para posicionar, zoom pela barra,
// pela rodinha do mouse ou pelas teclas + e -. Gera um quadrado (a foto aparece redonda no Portal).
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import X from "lucide-react/icons/x";
import ZoomIn from "lucide-react/icons/zoom-in";
import ZoomOut from "lucide-react/icons/zoom-out";

const VIEW = 280;
const MAX_ZOOM = 4;

type Props = {
  file: File;
  shape?: "circle" | "square";
  /** Lado da imagem final, em pixels. */
  output?: number;
  title?: string;
  /** Mostra "Usar sem recortar" (útil para logos largos). */
  allowOriginal?: boolean;
  onCancel: () => void;
  onDone: (file: File) => void;
};

export function ImageCropper({ file, shape = "circle", output = 512, title = "Ajustar imagem", allowOriginal = false, onCancel, onDone }: Props) {
  const [url] = useState(() => URL.createObjectURL(file));
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  const base = natural ? VIEW / Math.min(natural.w, natural.h) : 1;
  const scale = base * zoom;
  const size = natural ? { w: natural.w * scale, h: natural.h * scale } : { w: VIEW, h: VIEW };

  const clamp = useCallback((x: number, y: number, w: number, h: number) => ({
    x: Math.min(0, Math.max(VIEW - w, x)),
    y: Math.min(0, Math.max(VIEW - h, y)),
  }), []);

  function onLoad() {
    const img = imgRef.current;
    if (!img) return;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const first = VIEW / Math.min(w, h);
    setNatural({ w, h });
    setOffset({ x: (VIEW - w * first) / 2, y: (VIEW - h * first) / 2 });
  }

  /** Zoom mantendo o centro da moldura no mesmo ponto da imagem. */
  const applyZoom = useCallback((next: number) => {
    if (!natural) return;
    const value = Math.min(MAX_ZOOM, Math.max(1, next));
    const oldScale = base * zoom;
    const newScale = base * value;
    const center = VIEW / 2;
    const x = center - (center - offset.x) * (newScale / oldScale);
    const y = center - (center - offset.y) * (newScale / oldScale);
    setZoom(value);
    setOffset(clamp(x, y, natural.w * newScale, natural.h * newScale));
  }, [natural, base, zoom, offset, clamp]);

  // Rodinha do mouse: precisa ser "não passivo" para não rolar a página junto.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const onWheel = (event: WheelEvent) => { event.preventDefault(); applyZoom(zoom * (event.deltaY < 0 ? 1.08 : 1 / 1.08)); };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, [applyZoom, zoom]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onCancel(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function onKeyMove(event: React.KeyboardEvent) {
    if (!natural) return;
    const step = event.shiftKey ? 30 : 8;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[event.key]) { event.preventDefault(); setOffset(clamp(offset.x + moves[event.key][0], offset.y + moves[event.key][1], size.w, size.h)); }
    else if (event.key === "+" || event.key === "=") { event.preventDefault(); applyZoom(zoom + 0.2); }
    else if (event.key === "-") { event.preventDefault(); applyZoom(zoom - 0.2); }
  }

  async function confirm() {
    if (!natural || !imgRef.current) return;
    setBusy(true);
    setError("");
    try {
      const canvas = document.createElement("canvas");
      const side = Math.min(output, Math.round(VIEW / scale));
      canvas.width = Math.max(64, side);
      canvas.height = canvas.width;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Seu navegador não conseguiu recortar a imagem.");
      context.imageSmoothingQuality = "high";
      context.drawImage(imgRef.current, -offset.x / scale, -offset.y / scale, VIEW / scale, VIEW / scale, 0, 0, canvas.width, canvas.height);
      // PNG mantém o fundo transparente (logos); fotos vão em JPEG, bem menores.
      const type = file.type === "image/png" ? "image/png" : "image/jpeg";
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
      if (!blob) throw new Error("Não foi possível gerar a imagem recortada.");
      const name = file.name.replace(/\.[^.]+$/, "") + (type === "image/png" ? ".png" : ".jpg");
      onDone(new File([blob], name, { type }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível recortar a imagem.");
      setBusy(false);
    }
  }

  return createPortal(<div className="modal-layer nested cropper-layer">
    <button type="button" className="backdrop" onClick={onCancel} aria-label="Cancelar" />
    <div className="modal cropper" role="dialog" aria-modal="true" aria-labelledby="cropper-title">
      <div className="modal-head"><div><h2 id="cropper-title">{title}</h2><p>Arraste para posicionar e use o zoom para enquadrar.</p></div><button type="button" onClick={onCancel} aria-label="Fechar"><X /></button></div>
      <div ref={boxRef} className={`cropper-view ${shape}`} style={{ width: VIEW, height: VIEW }} tabIndex={0} role="application" aria-label="Área de recorte: setas movem, + e - mudam o zoom" onKeyDown={onKeyMove}
        onPointerDown={(event) => { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y }; }}
        onPointerMove={(event) => { const start = drag.current; if (!start) return; setOffset(clamp(start.ox + event.clientX - start.x, start.oy + event.clientY - start.y, size.w, size.h)); }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- imagem local (blob) só para o recorte */}
        <img ref={imgRef} src={url} alt="" draggable={false} onLoad={onLoad} style={{ width: size.w, height: size.h, transform: `translate(${offset.x}px, ${offset.y}px)`, visibility: natural ? "visible" : "hidden" }} />
        <span className="cropper-frame" aria-hidden="true" />
      </div>
      <div className="cropper-zoom">
        <button type="button" onClick={() => applyZoom(zoom - 0.2)} aria-label="Diminuir zoom" disabled={zoom <= 1}><ZoomOut size={16} /></button>
        <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom} onChange={(event) => applyZoom(Number(event.target.value))} aria-label="Zoom" />
        <button type="button" onClick={() => applyZoom(zoom + 0.2)} aria-label="Aumentar zoom" disabled={zoom >= MAX_ZOOM}><ZoomIn size={16} /></button>
      </div>
      {error && <p className="cropper-error" role="alert">{error}</p>}
      <div className="modal-actions">
        {allowOriginal && <button type="button" className="link-button" disabled={busy} onClick={() => onDone(file)}>Usar sem recortar</button>}
        <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>Cancelar</button>
        <button type="button" className="primary-button" onClick={() => void confirm()} disabled={busy || !natural}>{busy ? "Recortando…" : "Usar imagem"}</button>
      </div>
    </div>
  </div>, document.body);
}
