import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./dark-theme.css";
import { APP_DESCRIPTION, APP_NAME } from "./brand";
import PwaRegister from "./pwa-register";
import { THEME_BOOT_SCRIPT } from "./theme";

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_DESCRIPTION,
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/apple-touch-icon.png",
  },
  // No iPhone/iPad: "Adicionar à Tela de Início" abre como app.
  appleWebApp: { capable: true, title: "Portal", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#172a46",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      {/* Aplica o tema (claro/escuro) antes de desenhar, para não piscar. */}
      <head><script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} /></head>
      <body>{children}<PwaRegister /></body>
    </html>
  );
}
