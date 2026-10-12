"use client";
import { useState } from "react";
import type { GenerationObservation } from "@deliberation-ai/contracts";

export type ConnectionDebugRecord = {
  version: "connection-debug-v1"; startedAt: string; model: string; message: string;
  files: { name: string; mimeType: string; encodedBytes: number }[];
  browser: { userAgent: string; online: boolean; timezone: string };
  steps: { action: string; status: number | null; code: string | null; detail?: string }[];
  result?: GenerationObservation;
};
function pretty(value: unknown) { return JSON.stringify(value, null, 2); }
export function ConnectionDebugTrace({ record }: { record: ConnectionDebugRecord | null }) {
  const [tab, setTab] = useState("Özet");
  const trace = record?.result?.trace;
  function download() {
    if (!record) return;
    // The redacted wire trace already contains the exact text. Avoid duplicating
    // unredacted user/visible reply strings in the exported diagnostic envelope.
    const { message: _message, ...metadata } = record;
    const { message: _resultMessage, reply: _reply, errorDetail: _detail, ...resultMetadata } = record.result ?? {};
    void _message; void _resultMessage; void _reply; void _detail;
    const exported = trace ? { ...metadata, result: resultMetadata } : record;
    const url = URL.createObjectURL(new Blob([pretty(exported)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `baglanti-testi-${record.startedAt.replace(/[:.]/g, "-")}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const tabs = ["Özet", "İstek", "Yanıt", "Aktarım"];
  const diagnostic = record?.result?.errorCode ?? record?.steps.findLast(step => step.code)?.code;
  const diagnosis = diagnostic?.includes("401") || diagnostic?.includes("403") ? "API anahtarı veya erişim yetkisi reddedildi."
    : diagnostic?.includes("402") ? "Sağlayıcı ödeme/kredi hatası bildirdi."
    : diagnostic?.includes("429") ? "Sağlayıcı kullanım veya hız sınırı bildirdi."
    : diagnostic?.includes("404") ? "Model, API sürümü veya uç nokta için erişim bulunamadı. Katalogda görünmesi çağrı erişimini garanti etmez."
    : diagnostic?.includes("timeout") || diagnostic?.includes("network") || diagnostic?.includes("dns") || diagnostic?.includes("connection") || diagnostic?.includes("tls") ? "Aktarım tamamlanamadı. Uzak sonuç ve ücret bilinmeyebilir."
    : record?.result?.status === "succeeded" ? "Sağlayıcı yanıtı alındı ve uygulama tarafından okunabildi."
    : diagnostic ? "İstek veya yanıt işlenirken hata oluştu. İlgili aşama ve alınan cevap aşağıdadır." : "Henüz tamamlanmış bir sonuç yok.";
  return <section className="connection-debug-trace" aria-label="Mevcut testin teknik ayrıntıları">
    <div className="connection-catalog-heading"><div><h3>Mevcut Testin Teknik Ayrıntıları</h3><p className="hint">Yalnız bu test oturumu gösterilir. Anahtarlar gizlenir; dosya içeriği yerine boyut ve SHA-256 bulunur. İndirdiğiniz dosya mesaj ve yanıtı içerir.</p></div><button type="button" className="secondary-button" disabled={!record} title="Mevcut testin isteğini, yanıtını ve teknik ayrıntılarını JSON olarak indirir." onClick={download}>JSON İndir</button></div>
    {!record ? <p className="hint">Bir mesaj gönderdiğinizde istek, yanıt ve aktarım bilgileri burada görünecek.</p> : <>
      <div className="workspace-tabs" role="tablist" aria-label="Test ayrıntıları">{tabs.map((label, index) => <button type="button" role="tab" key={label} id={`debug-tab-${index}`} aria-selected={tab === label} aria-controls={`debug-panel-${index}`} tabIndex={tab === label ? 0 : -1} onClick={() => setTab(label)} onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length; setTab(tabs[next]!); document.getElementById(`debug-tab-${next}`)?.focus(); } }}>{label}</button>)}</div>
      <div role="tabpanel" id={`debug-panel-${tabs.indexOf(tab)}`} aria-labelledby={`debug-tab-${tabs.indexOf(tab)}`}>
        {tab === "Özet" ? <><p>{diagnosis}</p><dl className="debug-summary"><dt>Uygulama aşamaları</dt><dd>{record.steps.map((step, i) => <div key={i}>{step.action} · {step.status === null ? "HTTP yanıtı yok" : `HTTP ${step.status}`} {step.code ? `· ${step.code}` : ""}{step.detail ? <p>{step.detail}</p> : null}</div>)}</dd><dt>Sağlayıcı sonucu</dt><dd>{record.result?.status ?? "Henüz alınmadı"} · HTTP {trace?.response.status ?? "bilinmiyor"}</dd><dt>İşlem kimliği</dt><dd>{record.result?.id ?? "Henüz oluşturulmadı"}</dd></dl><p className="hint">HTTP başlıkları, süre ve hata kodları ölçülür. DNS/TLS paketleri veya sağlayıcının iç sunucu kayıtları bu uygulamaya açık değildir.</p></> : null}
        {tab === "İstek" ? <><p className="hint">Ek sistem talimatı ve önceki sohbet gönderilmez. Aşağıdaki gövde, dosya verisi ve kimlik bilgileri gizlenmiş gerçek API isteğidir.</p><pre>{trace ? pretty({ ...trace.request, body: parseBody(trace.request.body) }) : pretty({ model: record.model, message: record.message, files: record.files, note: "Sağlayıcı aktarımına henüz ulaşılamadı veya aktarım kaydı alınamadı." })}</pre></> : null}
        {tab === "Yanıt" ? <><pre>{trace ? pretty({ ...trace.response, body: parseBody(trace.response.body) }) : pretty({ status: record.result?.status ?? null, code: diagnostic ?? null, steps: record.steps })}</pre>{trace?.response.truncated ? <p className="inline-warning">Yanıt görüntüleme sınırında kesildi; tamamı alınmış olduğu varsayılmaz.</p> : null}</> : null}
        {tab === "Aktarım" ? <pre>{pretty({ browser: record.browser, server: trace?.runtime ?? null, startedAt: trace?.startedAt ?? record.startedAt, finishedAt: trace?.finishedAt ?? null, elapsedMs: trace?.elapsedMs ?? null, normalization: trace?.result ?? null, usage: record.result ? { inputTokens: record.result.inputTokens, outputTokens: record.result.outputTokens, returnedModel: record.result.returnedModel, remoteResponseId: record.result.remoteResponseId } : null })}</pre> : null}
      </div>
    </>}
  </section>;
}
function parseBody(value: string | null) { if (value === null) return null; try { return JSON.parse(value) as unknown; } catch { return value; } }
