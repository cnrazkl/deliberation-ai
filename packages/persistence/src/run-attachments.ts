import { createHash } from "node:crypto";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_PDF_ATTACHMENT_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
  type RunAttachment,
} from "@deliberation-ai/contracts";
import { extractPdfText, RetrievalError } from "@deliberation-ai/retrieval";

export class AttachmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentValidationError";
  }
}

function verifiedBytes(attachment: Pick<RunAttachment, "name" | "mimeType" | "dataBase64" | "sha256">): Buffer {
  const bytes = Buffer.from(attachment.dataBase64, "base64");
  const limit = attachment.mimeType === "application/pdf"
    ? MAX_PDF_ATTACHMENT_BYTES
    : MAX_ATTACHMENT_BYTES;
  if (bytes.length === 0 || bytes.length > limit) {
    throw new AttachmentValidationError(`${attachment.name}: dosya boyutu sınırı aşıldı.`);
  }
  const validSignature = attachment.mimeType === "application/pdf"
    ? bytes.subarray(0, 5).toString("ascii") === "%PDF-"
    : attachment.mimeType === "image/png"
      ? bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
      : attachment.mimeType === "image/jpeg"
        ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        : attachment.mimeType === "image/gif"
          ? ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))
          : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (!validSignature) throw new AttachmentValidationError(`${attachment.name}: dosya biçimi içerikle eşleşmiyor.`);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== attachment.sha256) throw new AttachmentValidationError(`${attachment.name}: dosya özeti eşleşmiyor.`);
  return bytes;
}

export async function extractUploadedPdf(
  attachment: Pick<RunAttachment, "name" | "mimeType" | "dataBase64" | "sha256">,
): Promise<string> {
  if (attachment.mimeType !== "application/pdf") {
    throw new AttachmentValidationError("PDF dosyası gerekli.");
  }
  const bytes = verifiedBytes(attachment);
  try {
    const result = await extractPdfText(bytes, attachment.name, { complete: true, pageMarkers: true });
    return result.content;
  } catch (error) {
    if (error instanceof RetrievalError) throw new AttachmentValidationError(`${attachment.name}: ${error.message}`);
    throw error;
  }
}

export async function validateRunAttachments(attachments: RunAttachment[]): Promise<void> {
  let totalBytes = 0;
  for (const attachment of attachments) {
    const bytes = verifiedBytes(attachment);
    totalBytes += bytes.length;
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new AttachmentValidationError("Eklerin toplam boyutu en fazla 12 MiB olabilir.");
    }
    if (attachment.mimeType === "application/pdf") {
      const extractedText = await extractUploadedPdf(attachment);
      if (extractedText !== attachment.extractedText) {
        throw new AttachmentValidationError(`${attachment.name}: PDF metni dosyayla eşleşmiyor.`);
      }
    }
  }
}
