import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DeliberationAI",
  description: "İzlenebilir çoklu model değerlendirme çalışma alanı",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="tr" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
