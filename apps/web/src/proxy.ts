import { NextResponse, type NextRequest } from "next/server";
export function proxy(request: NextRequest) {
  if (process.env.DELIBERATION_RECOVERY_HOLD === "true" && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    return NextResponse.json({ error: "Kurtarma incelemesi salt okunur; veri değişikliği ve API gönderimi kapalı." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.next();
}
export const config = { matcher: "/api/:path*" };
