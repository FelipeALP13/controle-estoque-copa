import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./dark-theme.css";
import { APP_DESCRIPTION } from "./brand";
import PwaRegister from "./pwa-register";
import { THEME_BOOT_SCRIPT } from "./theme";
import { loadBrand } from "./brand-store";
import { DEFAULT_BRAND_COLOR, brandCss, brandLogoUrl, brandPalette } from "./brand-theme";
import { BRAND_STYLE_ID, BrandProvider } from "./brand-context";

export const dynamic = "force-dynamic";

// Nome, ícone e cor vêm da marca configurada em Administração → Marca (white label).
export async function generateMetadata(): Promise<Metadata> {
  const brand = await loadBrand();
  const logo = brandLogoUrl(brand);
  return {
    title: brand.name,
    description: APP_DESCRIPTION,
    manifest: "/api/manifest",
    icons: logo ? { icon: logo, shortcut: logo, apple: logo } : { icon: "/favicon.svg", shortcut: "/favicon.svg", apple: "/apple-touch-icon.png" },
    // No iPhone/iPad: "Adicionar à Tela de Início" abre como app.
    appleWebApp: { capable: true, title: brand.shortName, statusBarStyle: "default" },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const brand = await loadBrand();
  return { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: brand.color === DEFAULT_BRAND_COLOR ? "#172a46" : brandPalette(brand.color).light["--brand-deep"] };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const brand = await loadBrand();
  const initial = { name: brand.name, shortName: brand.shortName, tagline: brand.tagline, color: brand.color, logoUrl: brandLogoUrl(brand), updatedAt: brand.updatedAt };
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      {/* Aplica o tema (claro/escuro) antes de desenhar, para não piscar; as cores da marca vêm junto. */}
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <style id={BRAND_STYLE_ID} dangerouslySetInnerHTML={{ __html: brandCss(brand.color) }} />
      </head>
      <body><BrandProvider initial={initial}>{children}</BrandProvider><PwaRegister /></body>
    </html>
  );
}
