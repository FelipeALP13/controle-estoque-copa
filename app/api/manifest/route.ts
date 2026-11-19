// Manifesto do app (instalar na tela inicial) com o nome da marca configurada.
import { APP_DESCRIPTION } from "../../brand";
import { loadBrand } from "../../brand-store";
import { brandIconUrl } from "../../brand-theme";

export async function GET() {
  const brand = await loadBrand();
  const manifest = {
    name: brand.name,
    short_name: brand.shortName,
    description: APP_DESCRIPTION,
    lang: "pt-BR",
    id: "/painel",
    start_url: "/painel",
    scope: "/",
    display: "standalone",
    background_color: "#f4f6fb",
    theme_color: "#172a46",
    // Com logo enviado, os ícones de instalar vêm dele (quadrados, com margem para o recorte redondo do Android).
    icons: [
      { src: brandIconUrl(brand, 192) ?? "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: brandIconUrl(brand, 512) ?? "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: brandIconUrl(brand, 512) ?? "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return Response.json(manifest, { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=300" } });
}
