import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pantalla MEGAGYM",
  description: "Reproductor de videos",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}