import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Estoque da Copa",
  description: "Controle interno de alimentos, compras, aberturas e consumo.",
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
