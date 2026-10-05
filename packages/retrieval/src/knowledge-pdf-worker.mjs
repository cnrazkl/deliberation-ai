// A disposable parser process: no application configuration, filesystem input or
// network URL is accepted. Output is bounded by the parent and contains data only.
import { getDocument, version } from "pdfjs-dist/legacy/build/pdf.mjs";
for (const method of ["log", "warn", "error", "info", "debug"]) console[method] = () => undefined;
const chunks = []; let size = 0;
for await (const chunk of process.stdin) {
  size += chunk.length;
  if (size > 5 * 1_048_576) process.exit(1);
  chunks.push(chunk);
}
const bytes = Buffer.concat(chunks);
const parserVersion = `knowledge-pdf-v1/pdfjs-${version}`;
let loading;
let result = { parserVersion, status: "failed", reason: "invalid_pdf", text: "", pages: [] };
try {
  if (/\/(?:JavaScript|JS|OpenAction|AA|Launch|EmbeddedFile)\b/.test(bytes.toString("latin1"))) {
    result.reason = "active_content";
  } else {
    loading = getDocument({ data: new Uint8Array(bytes), disableFontFace: true, isEvalSupported: false,
      isImageDecoderSupported: false, isOffscreenCanvasSupported: false, maxImageSize: 1_000_000,
      stopAtErrors: true, useSystemFonts: false, useWasm: false, enableXfa: false, verbosity: 0 });
    const document = await loading.promise;
    if (document.numPages > 100) result.reason = "page_limit";
    else if (await document.hasJSActions() || await document.getAttachments()) result.reason = "active_content";
    else {
      const pages = []; let text = "", emptyPages = 0;
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const pageText = content.items.map((item) => "str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : "")
          .join("").replace(/[\t\f\v ]+/g, " ").replace(/ *\n */g, "\n").trim();
        page.cleanup();
        if (pageNumber > 1) text += "\n\n";
        const start = text.length; text += pageText;
        if (text.length > 64_000) { result.reason = "character_limit"; break; }
        pages.push({ page: pageNumber, start, end: text.length });
        if (!pageText) emptyPages++;
      }
      if (pages.length === document.numPages) result = { parserVersion, status: emptyPages ? "extraction_unverified" : "complete",
        reason: emptyPages ? "missing_text_pages" : null, text, pages };
    }
  }
} catch { /* Only a fixed failure code crosses the process boundary. */ }
finally { if (loading) await loading.destroy().catch(() => undefined); }
process.stdout.write(JSON.stringify(result));
