import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "VelaDesk",
  description: "Build your browser home, your way.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // Default UI language is Chinese (product decision); the client
    // UiLocaleProvider updates `lang` after hydration when the stored
    // locale is en-US. Browser extensions (e.g. the one injecting
    // data-redeviation-bs-uid) mutate <html> before hydration; suppress
    // the resulting one-level attribute-mismatch warning. Documented
    // Next.js pattern — it silences only the warning, never real
    // hydration behavior.
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}
