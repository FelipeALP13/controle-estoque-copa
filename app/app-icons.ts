// Ícones de instalar (celular e computador) gerados no navegador a partir do logo:
// PNG quadrado com fundo branco e o logo centralizado dentro da área segura (o Android recorta em círculo).

/** Fração do lado ocupada pelo logo: ~72% fica dentro do círculo de 80% do ícone "maskable". */
const LOGO_FRACTION = 0.72;

async function loadImage(file: Blob) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function render(image: HTMLImageElement, size: number) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return Promise.resolve(null);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size, size);
  const box = size * LOGO_FRACTION;
  const scale = Math.min(box / image.naturalWidth, box / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
}

/** Ícones 512 e 192 do logo; null se o navegador não conseguir gerar (o Portal segue com os ícones padrão). */
export async function makeAppIcons(logo: Blob): Promise<{ icon512: Blob; icon192: Blob } | null> {
  try {
    const image = await loadImage(logo);
    const [icon512, icon192] = await Promise.all([render(image, 512), render(image, 192)]);
    return icon512 && icon192 ? { icon512, icon192 } : null;
  } catch {
    return null;
  }
}
