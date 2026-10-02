import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { chromium } from "playwright";

export const MAX_RETRIEVAL_BYTES = 1_048_576;
export const MAX_CAPTURE_CHARACTERS = 64_000;
export const MAX_REDIRECTS = 3;
export const RETRIEVAL_TIMEOUT_MS = 10_000;
export const MAX_PDF_PAGES = 100;
export const PDF_PARSE_TIMEOUT_MS = 10_000;
export const MAX_BROWSER_REQUESTS = 20;
export const MAX_BROWSER_TOTAL_BYTES = 5 * 1_048_576;
export const BROWSER_RENDER_TIMEOUT_MS = 15_000;

export type RetrievedDocument = {
  requestedUrl: string;
  finalUrl: string;
  title: string;
  content: string;
  contentType: string;
  byteLength: number;
  contentSha256: string;
  redirectCount: number;
};

export type RetrievedResource = {
  requestedUrl: string;
  finalUrl: string;
  body: Buffer;
  contentType: string;
  rawContentType: string;
  redirectCount: number;
};

export class RetrievalError extends Error {
  constructor(
    readonly code:
      | "invalid_url"
      | "blocked_target"
      | "dns_failed"
      | "timeout"
      | "redirect_limit"
      | "http_error"
      | "unsupported_content"
      | "response_too_large"
      | "empty_content",
    message: string,
  ) {
    super(message);
    this.name = "RetrievalError";
  }
}

const blockedAddresses = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blockedAddresses.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 96], ["::1", 128], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64],
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7],
  ["fec0::", 10], ["fe80::", 10], ["ff00::", 8],
] as const) blockedAddresses.addSubnet(address, prefix, "ipv6");

function unwrapIpv4Mapped(address: string): string | undefined {
  const match = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  return match?.[1];
}

export function isPublicAddress(address: string): boolean {
  const mapped = unwrapIpv4Mapped(address);
  if (mapped) return isPublicAddress(mapped);
  const family = isIP(address);
  if (family === 4) return !blockedAddresses.check(address, "ipv4");
  if (family === 6) return !blockedAddresses.check(address, "ipv6");
  return false;
}

function parseAllowedUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new RetrievalError("invalid_url", "Geçerli bir HTTP veya HTTPS adresi girin.");
  }
  if (!(["http:", "https:"] as string[]).includes(url.protocol) || url.username || url.password) {
    throw new RetrievalError("invalid_url", "Yalnızca kimlik bilgisi içermeyen HTTP ve HTTPS adresleri desteklenir.");
  }
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  if (port !== "80" && port !== "443") {
    throw new RetrievalError("blocked_target", "Araştırma getirme yalnızca standart web portlarını kullanır.");
  }
  url.hash = "";
  return url;
}

async function resolvePublicTarget(hostname: string): Promise<{ address: string; family: 4 | 6 }> {
  const literal = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  if (["localhost", "localhost.localdomain"].includes(literal.toLowerCase())) {
    throw new RetrievalError("blocked_target", "Yerel ve özel ağ hedefleri getirilemez.");
  }
  let addresses: Array<{ address: string; family: 4 | 6 }>;
  if (isIP(literal)) {
    addresses = [{ address: literal, family: isIP(literal) as 4 | 6 }];
  } else {
    try {
      const resolved = await dnsLookup(literal, { all: true, verbatim: true });
      addresses = resolved.flatMap((item) =>
        item.family === 4 || item.family === 6
          ? [{ address: item.address, family: item.family }]
          : [],
      );
    } catch {
      throw new RetrievalError("dns_failed", "Kaynak alan adı çözümlenemedi.");
    }
  }
  if (addresses.length === 0) throw new RetrievalError("dns_failed", "Kaynak alan adı adres döndürmedi.");
  if (addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new RetrievalError("blocked_target", "Kaynak alan adı güvenli olmayan bir ağ adresine çözümlendi.");
  }
  return addresses[0]!;
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };
  return value.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi, (match, decimal, hex, name) => {
    if (decimal) return String.fromCodePoint(Number(decimal));
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    return named[String(name).toLowerCase()] ?? match;
  });
}

export function extractReadableText(body: string, contentType: string, fallbackTitle: string): { title: string; content: string } {
  if (!contentType.includes("html") && !contentType.startsWith("text/plain")) {
    throw new RetrievalError("unsupported_content", "Şimdilik yalnızca HTML ve düz metin kaynakları getirilebilir.");
  }
  if (contentType.startsWith("text/plain")) {
    const content = body.replace(/\r\n?/g, "\n").trim().slice(0, MAX_CAPTURE_CHARACTERS);
    if (!content) throw new RetrievalError("empty_content", "Kaynakta kullanılabilir metin bulunamadı.");
    return { title: fallbackTitle, content };
  }
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(body);
  const stripped = body
    .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const content = decodeEntities(stripped)
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_CAPTURE_CHARACTERS);
  if (!content) throw new RetrievalError("empty_content", "Kaynakta kullanılabilir metin bulunamadı.");
  const title = decodeEntities(titleMatch?.[1]?.replace(/<[^>]+>/g, " ") ?? "")
    .replace(/\s+/g, " ").trim().slice(0, 160) || fallbackTitle;
  return { title, content };
}

export async function extractPdfText(
  body: Buffer,
  fallbackTitle: string,
  options: { complete?: boolean; pageMarkers?: boolean } = {},
): Promise<{ title: string; content: string }> {
  const loadingTask = getDocument({
    data: new Uint8Array(body),
    disableFontFace: true,
    isImageDecoderSupported: false,
    isOffscreenCanvasSupported: false,
    maxImageSize: 1_000_000,
    stopAtErrors: true,
    useSystemFonts: false,
    useWasm: false,
    verbosity: 0,
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      void loadingTask.destroy().catch(() => undefined);
      reject(new RetrievalError("timeout", "PDF metin çıkarma zaman aşımına uğradı."));
    }, PDF_PARSE_TIMEOUT_MS);
  });
  try {
    const document = await Promise.race([loadingTask.promise, deadline]);
    if (document.numPages > MAX_PDF_PAGES) {
      throw new RetrievalError("unsupported_content", `PDF en fazla ${MAX_PDF_PAGES} sayfa olabilir.`);
    }

    const paragraphs: string[] = [];
    let length = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages && (options.complete || length < MAX_CAPTURE_CHARACTERS); pageNumber += 1) {
      const page = await Promise.race([document.getPage(pageNumber), deadline]);
      const text = await Promise.race([page.getTextContent(), deadline]);
      const pageText = text.items
        .map((item) => ("str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : ""))
        .join("")
        .replace(/[\t\f\v ]+/g, " ")
        .replace(/ *\n */g, "\n")
        .trim();
      if (pageText) {
        const paragraph = options.pageMarkers ? `[Sayfa ${pageNumber}]\n${pageText}` : pageText;
        length += paragraph.length + 2;
        page.cleanup();
        if (options.complete && length > MAX_CAPTURE_CHARACTERS) {
          throw new RetrievalError("unsupported_content", "PDF metni 64.000 karakter sınırını aşıyor; eksik belge gönderilmez.");
        }
        paragraphs.push(paragraph);
      } else page.cleanup();
    }
    const content = paragraphs.join("\n\n").slice(0, MAX_CAPTURE_CHARACTERS).trim();
    if (!content) throw new RetrievalError("empty_content", "PDF içinde seçilebilir metin bulunamadı.");

    const metadata = await Promise.race([document.getMetadata().catch(() => undefined), deadline]);
    const rawTitle = metadata?.info && "Title" in metadata.info ? metadata.info.Title : undefined;
    const title = typeof rawTitle === "string" && rawTitle.trim()
      ? rawTitle.replace(/\s+/g, " ").trim().slice(0, 160)
      : fallbackTitle;
    return { title, content };
  } catch (error) {
    if (error instanceof RetrievalError) throw error;
    throw new RetrievalError("unsupported_content", "PDF güvenli biçimde okunamadı.");
  } finally {
    if (timeout) clearTimeout(timeout);
    await loadingTask.destroy().catch(() => undefined);
  }
}

async function requestPinned(url: URL, address: string, family: 4 | 6): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RETRIEVAL_TIMEOUT_MS);
    const options: RequestOptions = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      signal: controller.signal,
      headers: {
        accept: "text/html, application/pdf;q=0.95, text/plain;q=0.9, text/css;q=0.8, application/javascript;q=0.8, application/json;q=0.7",
        "accept-encoding": "identity",
        "user-agent": "DeliberationAI-ResearchCapture/1.0",
      },
      lookup: (_hostname, _options, callback) => callback(null, address, family),
      maxHeaderSize: 16_384,
    };
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(options, (response) => {
      const chunks: Buffer[] = [];
      let length = 0;
      response.on("data", (chunk: Buffer) => {
        length += chunk.length;
        if (length > MAX_RETRIEVAL_BYTES) {
          response.destroy(new RetrievalError("response_too_large", "Kaynak yanıtı 1 MiB sınırını aşıyor."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        clearTimeout(timer);
        resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) });
      });
      response.on("error", (error) => { clearTimeout(timer); reject(error); });
    });
    request.on("error", (error) => {
      clearTimeout(timer);
      if (controller.signal.aborted) reject(new RetrievalError("timeout", "Kaynak getirme zaman aşımına uğradı."));
      else reject(error);
    });
    request.end();
  });
}

export async function retrievePublicResource(input: string): Promise<RetrievedResource> {
  const requested = parseAllowedUrl(input);
  let current = requested;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const target = await resolvePublicTarget(current.hostname);
    let response: Awaited<ReturnType<typeof requestPinned>>;
    try {
      response = await requestPinned(current, target.address, target.family);
    } catch (error) {
      if (error instanceof RetrievalError) throw error;
      throw new RetrievalError("http_error", "Kaynak bağlantısı tamamlanamadı.");
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.location;
      if (redirectCount === MAX_REDIRECTS) throw new RetrievalError("redirect_limit", "Kaynak çok fazla yönlendirme yaptı.");
      if (typeof location !== "string") throw new RetrievalError("http_error", "Kaynak geçersiz bir yönlendirme döndürdü.");
      current = parseAllowedUrl(new URL(location, current).toString());
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      throw new RetrievalError("http_error", `Kaynak HTTP ${response.status} yanıtı döndürdü.`);
    }
    const rawContentType = Array.isArray(response.headers["content-type"])
      ? response.headers["content-type"][0]
      : response.headers["content-type"];
    const contentType = (rawContentType ?? "").split(";", 1)[0]!.trim().toLowerCase();
    return {
      requestedUrl: requested.toString(),
      finalUrl: current.toString(),
      body: response.body,
      contentType,
      rawContentType: rawContentType ?? "application/octet-stream",
      redirectCount,
    };
  }
  throw new RetrievalError("redirect_limit", "Kaynak çok fazla yönlendirme yaptı.");
}

export async function retrievePublicDocument(input: string): Promise<RetrievedDocument> {
  const resource = await retrievePublicResource(input);
  const finalUrl = new URL(resource.finalUrl);
  let extracted: { title: string; content: string };
  if (resource.contentType === "application/pdf") {
    extracted = await extractPdfText(resource.body, finalUrl.hostname);
  } else {
    const charset = /charset=([^;\s]+)/i.exec(resource.rawContentType)?.[1]?.replace(/["']/g, "") ?? "utf-8";
    let body: string;
    try { body = new TextDecoder(charset).decode(resource.body); }
    catch { body = new TextDecoder("utf-8").decode(resource.body); }
    extracted = extractReadableText(body, resource.contentType, finalUrl.hostname);
  }
  return {
    requestedUrl: resource.requestedUrl,
    finalUrl: resource.finalUrl,
    title: extracted.title,
    content: extracted.content,
    contentType: resource.contentType,
    byteLength: resource.body.length,
    contentSha256: createHash("sha256").update(resource.body).digest("hex"),
    redirectCount: resource.redirectCount,
  };
}

const browserContentTypes = new Set([
  "application/javascript",
  "application/json",
  "application/ld+json",
  "application/xml",
  "text/css",
  "text/html",
  "text/javascript",
  "text/plain",
  "text/xml",
]);

export function isBrowserResourceAllowed(method: string, resourceType: string, contentType: string): boolean {
  if (method !== "GET") return false;
  if (["eventsource", "font", "image", "media", "manifest", "websocket"].includes(resourceType)) return false;
  return browserContentTypes.has(contentType);
}

export async function retrieveRenderedPublicDocument(input: string): Promise<RetrievedDocument> {
  const requested = parseAllowedUrl(input);
  await resolvePublicTarget(requested.hostname);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    acceptDownloads: false,
    javaScriptEnabled: true,
    locale: "tr-TR",
    permissions: [],
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  let requestCount = 0;
  let downloadedBytes = 0;
  let initialResource: RetrievedResource | undefined;

  page.on("dialog", (dialog) => void dialog.dismiss());
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (!request.url().startsWith("http://") && !request.url().startsWith("https://")) {
      await route.abort("blockedbyclient");
      return;
    }
    if (request.method() !== "GET" || requestCount >= MAX_BROWSER_REQUESTS) {
      await route.abort("blockedbyclient");
      return;
    }
    requestCount += 1;
    try {
      const resource = await retrievePublicResource(request.url());
      if (!isBrowserResourceAllowed(request.method(), request.resourceType(), resource.contentType)) {
        await route.abort("blockedbyclient");
        return;
      }
      downloadedBytes += resource.body.length;
      if (downloadedBytes > MAX_BROWSER_TOTAL_BYTES) {
        await route.abort("blockedbyclient");
        return;
      }
      if (request.isNavigationRequest() && !initialResource) initialResource = resource;
      await route.fulfill({
        status: 200,
        body: resource.body,
        headers: {
          "content-type": resource.rawContentType,
          "cache-control": "no-store",
        },
      });
    } catch {
      await route.abort("blockedbyclient");
    }
  });

  try {
    await page.goto(requested.toString(), {
      timeout: BROWSER_RENDER_TIMEOUT_MS,
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(750);
    const content = (await page.locator("body").innerText({ timeout: 2_000 }))
      .replace(/\r\n?/g, "\n")
      .replace(/[\t\f\v ]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, MAX_CAPTURE_CHARACTERS);
    if (!content) throw new RetrievalError("empty_content", "Tarayıcı görünümünde kullanılabilir metin bulunamadı.");
    const title = (await page.title()).replace(/\s+/g, " ").trim().slice(0, 160) || requested.hostname;
    return {
      requestedUrl: requested.toString(),
      finalUrl: initialResource?.finalUrl ?? requested.toString(),
      title,
      content,
      contentType: "text/html; rendered",
      byteLength: downloadedBytes,
      contentSha256: createHash("sha256").update(content).digest("hex"),
      redirectCount: initialResource?.redirectCount ?? 0,
    };
  } catch (error) {
    if (error instanceof RetrievalError) throw error;
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new RetrievalError("timeout", "Tarayıcıyla kaynak getirme zaman aşımına uğradı.");
    }
    throw new RetrievalError("http_error", "Tarayıcıyla kaynak getirme tamamlanamadı.");
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}
