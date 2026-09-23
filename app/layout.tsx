import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Estação Meteorológica Bauru Sul",
  description: "Condições meteorológicas em tempo real medidas por uma estação Ecowitt em Bauru–SP.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Clima Bauru Sul", statusBarStyle: "black-translucent" },
  icons: { icon: "/app-icon.svg", shortcut: "/app-icon.svg", apple: "/app-icon-192.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
