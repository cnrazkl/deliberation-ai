import { describe, expect, test } from "vitest";
import { extractPdfText, extractReadableText, isBrowserResourceAllowed, isPublicAddress, RetrievalError, retrievePublicDocument, retrieveRenderedPublicDocument } from "./index";

function createTextPdf(text: string): Buffer {
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

describe("research retrieval network boundary", () => {
  test.each([
    "127.0.0.1", "10.1.2.3", "169.254.169.254", "172.16.0.1", "192.168.1.1",
    "198.51.100.4", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1",
    "64:ff9b::7f00:1", "2002:7f00:1::",
  ])("blocks non-public address %s", (address) => expect(isPublicAddress(address)).toBe(false));

  test.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])(
    "accepts public address %s",
    (address) => expect(isPublicAddress(address)).toBe(true),
  );

  test.each([
    "file:///etc/passwd",
    "http://user:password@example.com/",
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://example.com:8080/",
  ])("rejects unsafe URL %s before content capture", async (url) => {
    await expect(retrievePublicDocument(url)).rejects.toBeInstanceOf(RetrievalError);
    await expect(retrieveRenderedPublicDocument(url)).rejects.toBeInstanceOf(RetrievalError);
  });

  test("browser boundary permits only read-only textual resources", () => {
    expect(isBrowserResourceAllowed("GET", "document", "text/html")).toBe(true);
    expect(isBrowserResourceAllowed("GET", "script", "application/javascript")).toBe(true);
    expect(isBrowserResourceAllowed("POST", "fetch", "application/json")).toBe(false);
    expect(isBrowserResourceAllowed("GET", "image", "text/plain")).toBe(false);
    expect(isBrowserResourceAllowed("GET", "document", "application/pdf")).toBe(false);
  });

  test("extracts readable text without executable or decorative HTML", () => {
    const result = extractReadableText(
      "<html><head><title>Kaynak &amp; Başlık</title><style>secret</style></head><body><h1>Başlık</h1><p>Birinci paragraf.</p><script>doBadThing()</script><p>İkinci paragraf.</p></body></html>",
      "text/html",
      "fallback.test",
    );
    expect(result.title).toBe("Kaynak & Başlık");
    expect(result.content).toContain("Başlık\nBirinci paragraf.\nİkinci paragraf.");
    expect(result.content).not.toContain("doBadThing");
    expect(result.content).not.toContain("secret");
  });

  test("extracts bounded selectable text from a PDF byte snapshot", async () => {
    const result = await extractPdfText(createTextPdf("DeliberationAI PDF source"), "fallback.test");
    expect(result.title).toBe("fallback.test");
    expect(result.content).toContain("DeliberationAI PDF source");
  });

  test("rejects a PDF without selectable text", async () => {
    await expect(extractPdfText(createTextPdf(""), "fallback.test")).rejects.toMatchObject({
      code: "empty_content",
    });
  });
});
