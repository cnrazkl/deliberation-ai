import { CONNECTION_TEST_FILE_BYTES, connectionTestAttachmentsSchema, type ConnectionTestAttachment } from "@deliberation-ai/contracts";
import { NormalizedProviderError } from "./index";

/** Bytes are ephemeral: validate signatures before any request; never log or persist them. */
export function validateConnectionTestAttachments(input: ConnectionTestAttachment[]): ConnectionTestAttachment[] {
  const files = connectionTestAttachmentsSchema.parse(input);
  for (const file of files) {
    const bytes = Buffer.from(file.data, "base64");
    const prefix = bytes.subarray(0, 12);
    const valid = file.mimeType === "image/png" ? prefix.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : file.mimeType === "image/jpeg" ? prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255
      : file.mimeType === "image/webp" ? prefix.toString("ascii", 0, 4) === "RIFF" && prefix.toString("ascii", 8, 12) === "WEBP"
      : file.mimeType === "application/pdf" ? prefix.toString("ascii", 0, 5) === "%PDF-"
      : file.mimeType === "audio/wav" ? prefix.toString("ascii", 0, 4) === "RIFF" && prefix.toString("ascii", 8, 12) === "WAVE"
      : prefix.toString("ascii", 0, 3) === "ID3" || prefix[0] === 255 && (prefix[1]! & 224) === 224;
    if (!valid || bytes.length > CONNECTION_TEST_FILE_BYTES || bytes.toString("base64") !== file.data) {
      throw new NormalizedProviderError("Dosyanın türü veya boyutu doğrulanamadı. Her dosya en fazla 1 MiB olabilir.", "test_file_invalid", "known", false);
    }
  }
  return files;
}

export function connectionTestParts(provider: string, text: string, files: ConnectionTestAttachment[]): unknown[] {
  if ((provider === "anthropic" || provider === "openai") && files.some(file => file.mimeType.startsWith("audio/"))) {
    throw new NormalizedProviderError("Bu bağlantının API türü ses girdisini desteklemiyor. Ses destekli bir Gemini veya OpenAI uyumlu bağlantı kullanın.", "test_media_unsupported", "known", false);
  }
  return [provider === "openai" ? { type: "input_text", text } : provider === "google" ? { text } : { type: "text", text },
    ...files.map(file => {
      if (provider === "google") return { inlineData: { mimeType: file.mimeType, data: file.data } };
      if (provider === "anthropic") return { type: file.mimeType === "application/pdf" ? "document" : "image",
        source: { type: "base64", media_type: file.mimeType, data: file.data } };
      const url = `data:${file.mimeType};base64,${file.data}`;
      if (provider === "openai") return file.mimeType === "application/pdf" ? { type: "input_file", filename: file.name, file_data: url }
        : { type: "input_image", image_url: url, detail: "auto" };
      if (file.mimeType.startsWith("image/")) return { type: "image_url", image_url: { url } };
      if (file.mimeType.startsWith("audio/")) return { type: "input_audio", input_audio: { data: file.data, format: file.mimeType === "audio/wav" ? "wav" : "mp3" } };
      return { type: "file", file: { filename: file.name, file_data: url } };
    })];
}

/** Only known diagnostics cross the adapter boundary; raw errors may echo secrets/input. */
export function connectionTestProviderError(value: unknown, httpStatus?: number): NormalizedProviderError | undefined {
  if (!value || typeof value !== "object") return undefined;
  const root = value as { error?: unknown; choices?: Array<{ error?: unknown }> };
  const raw = root.error ?? root.choices?.find(choice => choice.error)?.error;
  if (!raw && httpStatus === undefined) return undefined;
  const record = raw && typeof raw === "object" ? raw as { code?: unknown; message?: unknown; type?: unknown; metadata?: { error_type?: unknown } } : {};
  const known = ["invalid_request", "invalid_request_error", "authentication", "authentication_error", "permission_denied", "permission_error", "payment_required", "rate_limit_exceeded", "rate_limit_error", "insufficient_credits", "provider_unavailable", "provider_overloaded", "model_not_found", "not_found", "unsupported_modality", "content_policy_violation", "refusal", "context_length_exceeded", "max_tokens_exceeded", "token_limit_exceeded", "invalid_image", "image_too_large", "image_too_small", "unsupported_image_format", "image_not_found", "server", "timeout", "unmapped"];
  const reported = record.metadata?.error_type ?? record.type ?? record.code;
  const providerCode = typeof reported === "number" && Number.isInteger(reported) && reported >= 400 && reported <= 599 ? String(reported)
    : typeof reported === "string" && known.includes(reported) ? reported : "unclassified";
  const text = typeof record.message === "string" ? record.message.slice(0, 4096).toLowerCase() : "";
  const detail = /image|vision|visual/iu.test(text) ? "Sağlayıcı görsel girdisini reddetti. Seçilen modelin görsel desteğini ve dosya biçimini kontrol edin."
    : /audio|sound/iu.test(text) ? "Sağlayıcı ses girdisini reddetti. Seçilen modelin ses desteğini ve dosya biçimini kontrol edin."
    : /pdf|document|file/iu.test(text) ? "Sağlayıcı dosya/PDF girdisini reddetti. Seçilen modelin dosya desteğini kontrol edin."
    : /context|token.*limit/iu.test(text) ? "Sağlayıcı bağlam veya token sınırı bildirdi. Daha küçük bir test girdisi kullanın."
    : httpStatus === 401 || httpStatus === 403 ? "Sağlayıcı kimlik veya erişim yetkisini kabul etmedi."
    : httpStatus === 402 ? "Sağlayıcı kredi veya ödeme nedeniyle isteği reddetti."
    : httpStatus === 429 ? "Sağlayıcı kullanım veya istek sınırı bildirdi."
    : "Sağlayıcı isteği tamamlayamadı. Bildirilen hata kodunu, modeli ve bağlantı ayarlarını kontrol edin.";
  return new NormalizedProviderError(detail, httpStatus ? `provider_http_${httpStatus}` : "provider_response_invalid", "known", false, undefined, undefined, { detail, providerCode });
}
