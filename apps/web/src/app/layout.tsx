import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DeliberationAI",
  description: "İzlenebilir çoklu model değerlendirme çalışma alanı",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="tr" className="h-full antialiased" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: 'try{var t=localStorage.getItem("deliberation-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t;}catch{}' }} /></head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
