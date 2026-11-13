// Som dos avisos do sino (gerado na hora pelo navegador, sem arquivo de áudio).
// O navegador só deixa tocar som depois que a pessoa interage com a página: o "unlock" cuida disso.

const MUTE_KEY = "portal.sound.muted";
/** Outras partes da tela pedem para o sino recarregar (ex.: um lembrete da agenda acabou de sair). */
export const NOTIFY_REFRESH_EVENT = "portal:notifications-refresh";
let context: AudioContext | null = null;

function audio() {
  if (typeof window === "undefined") return null;
  if (!context) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try { context = new Ctor(); } catch { return null; }
  }
  return context;
}

export function isMuted() {
  try { return window.localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
}

export function setMuted(value: boolean) {
  try { window.localStorage.setItem(MUTE_KEY, value ? "1" : "0"); } catch { /* sem armazenamento: vale só nesta aba */ }
}

/** Libera o áudio no primeiro clique/tecla da pessoa (regra dos navegadores). */
export function unlockSoundOnInteraction() {
  const unlock = () => {
    const ctx = audio();
    if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
  return () => { window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); };
}

/** Toque curto de duas notas. `strong` (lembrete na hora) toca duas vezes. */
export function playChime(strong = false, force = false) {
  if (!force && isMuted()) return;
  const ctx = audio();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  const notes = strong ? [880, 1175, 880, 1175] : [880, 1175];
  const start = ctx.currentTime + 0.02;
  notes.forEach((frequency, index) => {
    const at = start + index * 0.16 + (strong && index >= 2 ? 0.25 : 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.22, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.38);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.4);
  });
}

/** Aviso do sistema (fora do navegador), só se a pessoa permitiu e a aba não está à vista. */
export function desktopNotify(title: string, body: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted" || document.visibilityState === "visible") return;
  const options = { body, tag: `portal-${title}-${body}`.slice(0, 120), icon: "/icon-192.png", badge: "/icon-192.png" };
  // No celular (e no app instalado) o aviso precisa sair pelo service worker.
  const viaWorker = "serviceWorker" in navigator ? navigator.serviceWorker.getRegistration().then((registration) => (registration ? registration.showNotification(title, options).then(() => true) : false)).catch(() => false) : Promise.resolve(false);
  void viaWorker.then((shown) => {
    if (shown) return;
    try {
      const note = new Notification(title, options);
      note.onclick = () => { window.focus(); note.close(); };
    } catch { /* navegador sem suporte a avisos fora da página */ }
  });
}

export const canAskDesktop = () => typeof Notification !== "undefined" && Notification.permission === "default";
