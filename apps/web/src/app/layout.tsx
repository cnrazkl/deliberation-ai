import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const manrope = localFont({ src: "./fonts/Manrope-Variable.ttf", variable: "--font-manrope", weight: "200 800", display: "swap" });

export const metadata: Metadata = {
  title: "DeliberationAI",
  description: "İzlenebilir çoklu model değerlendirme çalışma alanı",
  icons: { icon: { url: "/brand/deliberation-mark.svg", type: "image/svg+xml" } },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="tr" className="h-full antialiased" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: 'try{var t=localStorage.getItem("deliberation-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t;}catch{}' }} /></head>
      <body className={`${manrope.variable} min-h-full flex flex-col`}>{children}</body>
    </html>
  );
}
