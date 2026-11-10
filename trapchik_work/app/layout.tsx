import type { Metadata } from "next";
import "./globals.css";
import "../components/CrystalizedBall.css";

export const metadata: Metadata = {
  title: "Трапчик.мп3 — музыка без лишнего",
  description: "Музыкальная платформа Трапчик.мп3"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
