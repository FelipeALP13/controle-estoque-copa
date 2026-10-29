import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Estoque da Firma",
  description: "Controle interno do café, dos lanches, das compras e do consumo da firma.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
