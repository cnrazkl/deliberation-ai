"use client";

import { useEffect, useRef, useState } from "react";
import { modelCatalogCheckSchema, previewProviderModelsSchema, type ModelCatalogCheck, type PreviewProviderModelsRequest } from "@deliberation-ai/contracts";
import { ownerFetch } from "../../lib/session-fetch";

const messages: Record<ModelCatalogCheck["status"], string> = {
  available: "Model listesi alındı. Listeden seçin veya model kimliğini elle girin.",
  auth_failed: "Sağlayıcı anahtarı kabul etmedi. Anahtarı ve uç noktayı kontrol edin.",
  unsupported: "Bu uç nokta model listelemeyi desteklemiyor. Model kimliğini elle girebilirsiniz.",
  unavailable: "Model listesine ulaşılamadı. Tekrar deneyin veya model kimliğini elle girin.",
};

export function ConnectionModelPreview({ draft, model, onModelChange, disabled }: {
  draft: PreviewProviderModelsRequest; model: string; onModelChange: (model: string) => void; disabled: boolean;
}) {
  const binding = JSON.stringify([draft.provider, draft.endpointPreset, draft.baseUrl, draft.apiKey]);
  const [state, setState] = useState<{ binding: string; result: ModelCatalogCheck | null; pending: boolean; failed: boolean }>({ binding, result: null, pending: false, failed: false });
  if (state.binding !== binding) setState({ binding, result: null, pending: false, failed: false });
  const { result, pending, failed } = state;
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { sequence.current += 1; controller.current?.abort(); }, [binding]);

  async function load() {
    const parsed = previewProviderModelsSchema.safeParse(draft);
    if (!parsed.success || pending || disabled) return;
    const attempt = ++sequence.current;
    const abort = new AbortController();
    controller.current = abort;
    setState({ binding, result: null, pending: true, failed: false });
    try {
      const response = await ownerFetch("/api/provider-connections/model-preview", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(parsed.data), signal: abort.signal,
      });
      const catalog = modelCatalogCheckSchema.safeParse(await response.json());
      if (attempt !== sequence.current) return;
      setState(current => current.binding === binding && attempt === sequence.current
        ? { binding, result: response.ok && catalog.success ? catalog.data : null, failed: !response.ok || !catalog.success, pending: false }
        : current);
    } catch {
      if (attempt === sequence.current && !abort.signal.aborted) setState(current => current.binding === binding && attempt === sequence.current
        ? { binding, result: null, failed: true, pending: false } : current);
    }
  }

  const valid = previewProviderModelsSchema.safeParse(draft).success;
  return <section className="connection-model-preview" aria-label="Yeni bağlantının model listesi" aria-busy={pending}>
    <div className="model-preview-heading">
      <div><strong>Kullanılabilir modeller</strong><p className="hint">Anahtar yalnız seçtiğiniz sağlayıcının model listesine gönderilir. Bağlantı henüz kaydedilmez; yanıt üretilmez.</p></div>
      <button type="button" className="secondary-button" onClick={load} disabled={disabled || pending || !valid}>{pending ? "Modeller alınıyor…" : "Modelleri getir"}</button>
    </div>
    {!valid ? <p className="hint">Önce API anahtarını ve gerekiyorsa temel URL’yi girin. Yerel uç noktalarda anahtar isteğe bağlıdır.</p> : null}
    <div role="status" aria-live="polite">
      {failed ? <p>Model listesi alınamadı. Tekrar deneyin veya model kimliğini elle girin.</p> : result ? <p>{messages[result.status]} {result.status === "available" ? `${result.models.length} model listelendi.` : ""}</p> : null}
    </div>
    {result?.status === "available" && result.models.length > 0 ? <label>Listeden başlangıç modeli seç
      <select value={result.models.includes(model) ? model : ""} disabled={disabled || pending} onChange={(event) => { if (event.target.value) onModelChange(event.target.value); }}>
        <option value="">Bir model seçin</option>
        {result.models.map((id) => {
          const displayName = result.details?.find((entry) => entry.id === id)?.displayName;
          return <option key={id} value={id}>{displayName ? `${displayName} · ${id}` : id}</option>;
        })}
      </select>
    </label> : null}
    {result?.truncated ? <p className="hint">Sağlayıcı listesinin yalnız ilk bölümü gösteriliyor; eksik model kimlikleri elle girilebilir.</p> : null}
    {result ? <p className="hint">{result.verification === "authenticated_catalog" ? "Anahtar, sağlayıcının kimlik doğrulamalı kataloğunda kabul edildi." : "Bu liste API anahtarının doğrulandığını göstermez."} Katalog kaydı; yanıt üretimi, ücret veya düşünme seviyesi desteğini doğrulamaz.</p> : null}
  </section>;
}
