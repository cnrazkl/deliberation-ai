import { ConversationPendingError, ConversationSizeError } from "@deliberation-ai/persistence";

export function conversationError(error: unknown) {
  const pending = error instanceof ConversationPendingError;
  const large = error instanceof ConversationSizeError;
  return Response.json({ error: pending ? "Eski konuşma kayıtlarının aktarımı tamamlanmayı bekliyor."
    : large ? "Konuşma 200 çalışma veya 32 MiB sınırını aşıyor. Eksik dosya üretilmedi; tekil raporları indirebilirsiniz."
      : "Konuşma kayıtları doğrulanamadı." }, { status: pending ? 503 : large ? 413 : 500, headers: { "Cache-Control": "no-store" } });
}
