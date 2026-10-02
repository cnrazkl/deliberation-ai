import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { extractUploadedPdf, validateRunAttachments } from "./run-attachments";

function textPdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

describe("run PDF attachment boundary", () => {
  it("extracts page-labeled text and verifies the frozen snapshot", async () => {
    const bytes = textPdf("Fesih kosulu belgede yazili");
    const payload = {
      name: "karar.pdf",
      mimeType: "application/pdf" as const,
      dataBase64: bytes.toString("base64"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    const extractedText = await extractUploadedPdf(payload);
    expect(extractedText).toContain("[Sayfa 1]");
    expect(extractedText).toContain("Fesih kosulu");
    await expect(validateRunAttachments([{ ...payload, extractedText }])).resolves.toBeUndefined();
    await expect(validateRunAttachments([{ ...payload, extractedText: "başka metin" }]))
      .rejects.toThrow("PDF metni dosyayla eşleşmiyor");
  });

  it("rejects a PDF with a forged extension or no selectable text", async () => {
    const bytes = Buffer.from("not a PDF");
    await expect(extractUploadedPdf({
      name: "sahte.pdf", mimeType: "application/pdf", dataBase64: bytes.toString("base64"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    })).rejects.toThrow("dosya biçimi içerikle eşleşmiyor");

    const scanned = textPdf("");
    await expect(extractUploadedPdf({
      name: "tarama.pdf", mimeType: "application/pdf", dataBase64: scanned.toString("base64"),
      sha256: createHash("sha256").update(scanned).digest("hex"),
    })).rejects.toThrow("seçilebilir metin bulunamadı");
  });
});
