"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  DecisionAssessmentResult,
  DecisionAssessmentStatus,
  EvaluationLabel,
} from "@deliberation-ai/evaluation";

type ClaimOption = { claimId: string; statement: string };
type SourceOption = {
  id: string;
  claimId: string;
  title: string;
  excerpt: string | null;
};

type DecisionConnection = {
  id: string;
  provider: "typesafe";
  label: string;
  defaultModel: string;
  configured: true;
  updatedAt: string;
};

type DecisionAssessment = {
  id: string;
  runId: string;
  claimId: string;
  sourceId: string;
  connectionId: string;
  mode: "shadow" | "advisory";
  status: DecisionAssessmentStatus;
  rubricVersion: "source-support-v1";
  requestedModel: string;
  returnedModel: string | null;
  result: DecisionAssessmentResult | null;
  errorCode: string | null;
  isCurrent: boolean;
  createdAt: string;
};

type DecisionOperation = {
  id: string;
  assessmentId: string;
  attempt: number;
  status: "outcome_unknown";
  errorCode: string | null;
};

const labelNames: Record<EvaluationLabel, string> = {
  supports: "Kaynak destekliyor olabilir",
  contradicts: "Kaynakla çelişiyor olabilir",
  insufficient_evidence: "Kaynak yetersiz",
  not_applicable: "Bu ölçüte uygun değil",
};

const statusNames: Record<DecisionAssessmentStatus, string> = {
  queued: "Sırada",
  running: "İnceleniyor",
  completed: "Gözlem tamamlandı",
  failed: "İnceleme başarısız",
  outcome_unknown: "Sonuç belirsiz",
  cancelled: "İptal edildi",
};

async function responseBody<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T | { error?: string };
  if (!response.ok) {
    throw new Error(
      typeof body === "object" && body && "error" in body && body.error
        ? body.error
        : "İstek tamamlanamadı.",
    );
  }
  return body as T;
}

async function loadDecisionConnections(): Promise<{
  connections: DecisionConnection[];
  evaluatorEnabled: boolean;
}> {
  return responseBody(
    await fetch("/api/decision-connections", { cache: "no-store" }),
  );
}

async function loadAssessmentState(runId: string): Promise<{
  assessments: DecisionAssessment[];
  operations: DecisionOperation[];
}> {
  const [assessmentBody, operationBody] = await Promise.all([
    responseBody<{ assessments: DecisionAssessment[] }>(
      await fetch(`/api/decision-assessments?runId=${encodeURIComponent(runId)}`, {
        cache: "no-store",
      }),
    ),
    responseBody<{ operations: DecisionOperation[] }>(
      await fetch("/api/decision-operations", { cache: "no-store" }),
    ),
  ]);
  return { assessments: assessmentBody.assessments, operations: operationBody.operations };
}

export function DecisionAssessmentPanel({
  runId,
  claims,
  sources,
}: {
  runId: string;
  claims: ClaimOption[];
  sources: SourceOption[];
}) {
  const [connections, setConnections] = useState<DecisionConnection[]>([]);
  const [evaluatorEnabled, setEvaluatorEnabled] = useState(false);
  const [assessments, setAssessments] = useState<DecisionAssessment[]>([]);
  const [operations, setOperations] = useState<DecisionOperation[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState("");
  const [connectionLabel, setConnectionLabel] = useState("TypeSafe Jev");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("jev-1.13.0");
  const [shareConfirmed, setShareConfirmed] = useState(false);
  const [busyId, setBusyId] = useState<string>();
  const [savingConnection, setSavingConnection] = useState(false);
  const [error, setError] = useState<string>();

  const claimById = useMemo(
    () => new Map(claims.map((claim) => [claim.claimId, claim])),
    [claims],
  );

  async function refreshAssessments(): Promise<void> {
    const state = await loadAssessmentState(runId);
    setAssessments(state.assessments);
    setOperations(state.operations);
  }

  useEffect(() => {
    void loadDecisionConnections()
      .then((body) => {
        setConnections(body.connections);
        setEvaluatorEnabled(body.evaluatorEnabled);
        setSelectedConnectionId(body.connections[0]?.id ?? "");
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void loadAssessmentState(runId)
      .then((state) => {
        setAssessments(state.assessments);
        setOperations(state.operations);
      })
      .catch(() => undefined);
  }, [runId]);

  useEffect(() => {
    if (!assessments.some((assessment) => ["queued", "running"].includes(assessment.status))) return;
    const timer = window.setTimeout(() => {
      void loadAssessmentState(runId)
        .then((state) => {
          setAssessments(state.assessments);
          setOperations(state.operations);
        })
        .catch(() => undefined);
    }, 1_200);
    return () => window.clearTimeout(timer);
  }, [assessments, runId]);

  async function saveConnection(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSavingConnection(true);
    setError(undefined);
    try {
      const saved = await responseBody<DecisionConnection>(
        await fetch("/api/decision-connections", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            label: connectionLabel,
            apiKey,
            defaultModel: model,
          }),
        }),
      );
      setConnections((current) => [
        ...current.filter((connection) => connection.id !== saved.id),
        saved,
      ]);
      setSelectedConnectionId(saved.id);
      setApiKey("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "TypeSafe bağlantısı kaydedilemedi.");
    } finally {
      setSavingConnection(false);
    }
  }

  async function startAssessment(source: SourceOption): Promise<void> {
    const connection = connections.find((item) => item.id === selectedConnectionId);
    if (!connection || !source.excerpt || !shareConfirmed) return;
    setBusyId(source.id);
    setError(undefined);
    try {
      const created = await responseBody<DecisionAssessment>(
        await fetch("/api/decision-assessments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            runId,
            claimId: source.claimId,
            sourceId: source.id,
            connectionId: connection.id,
            model: connection.defaultModel,
            mode: "shadow",
            confirmExternalShare: true,
          }),
        }),
      );
      setAssessments((current) => [...current, created]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Jev gözlem incelemesi başlatılamadı.");
    } finally {
      setBusyId(undefined);
    }
  }

  async function removeConnection(connectionId: string): Promise<void> {
    setBusyId(connectionId);
    setError(undefined);
    try {
      await responseBody<{ deleted: boolean }>(
        await fetch(`/api/decision-connections?id=${encodeURIComponent(connectionId)}`, {
          method: "DELETE",
        }),
      );
      const remaining = connections.filter((connection) => connection.id !== connectionId);
      setConnections(remaining);
      setSelectedConnectionId(remaining[0]?.id ?? "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "TypeSafe bağlantısı kaldırılamadı.");
    } finally {
      setBusyId(undefined);
    }
  }

  async function cancelAssessment(assessmentId: string): Promise<void> {
    setBusyId(assessmentId);
    try {
      await responseBody<{ cancelled: boolean }>(
        await fetch(`/api/decision-assessments/${assessmentId}/cancel`, { method: "POST" }),
      );
      await refreshAssessments();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "İnceleme iptal edilemedi.");
    } finally {
      setBusyId(undefined);
    }
  }

  async function resolveOperation(
    operationId: string,
    action: "discard" | "authorize_retry",
  ): Promise<void> {
    setBusyId(operationId);
    try {
      await responseBody<{ requeued: boolean }>(
        await fetch(`/api/decision-operations/${operationId}/resolve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        }),
      );
      await refreshAssessments();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Karar operasyonu çözümlenemedi.");
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <section className="decision-assessment-section" aria-label="Jev kaynak incelemesi">
      <div className="synthesis-heading">
        <div>
          <span>JEV KAYNAK İNCELEMESİ · GÖZLEM MODU</span>
          <strong>{assessments.length} inceleme</strong>
        </div>
        <small>
          Bu sonuç bir doğrulama veya hakem kararı değildir. Kanıt durumunu, sentezi ve konsey
          sonucunu değiştiremez. Canlı kalite kapısı geçilene kadar yalnız gözlem olarak saklanır.
        </small>
      </div>

      {connections.length === 0 ? (
        <form className="decision-connection-form" onSubmit={saveConnection}>
          <label>
            Bağlantı adı
            <input value={connectionLabel} onChange={(event) => setConnectionLabel(event.target.value)} required />
          </label>
          <label>
            TypeSafe API anahtarı
            <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} required />
          </label>
          <label>
            Sabit Jev sürümü
            <input value={model} pattern="jev-\d+\.\d+\.\d+" onChange={(event) => setModel(event.target.value)} required />
          </label>
          <button type="submit" disabled={savingConnection}>
            {savingConnection ? "Kaydediliyor…" : "TypeSafe bağlantısını kaydet"}
          </button>
          <p>
            Bağlantıyı kaydetmek istek göndermez. Anahtar şifrelenir; çağrı yalnız aşağıda açıkça
            seçtiğiniz kaynak için yapılır.
          </p>
        </form>
      ) : (
        <div className="decision-connection-row">
          <label className="decision-connection-picker">
            Karar bağlantısı
            <select
              value={selectedConnectionId}
              onChange={(event) => setSelectedConnectionId(event.target.value)}
            >
              {connections.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.label} · {connection.defaultModel}
                </option>
              ))}
            </select>
          </label>
          <button
            className="secondary-button danger-button"
            type="button"
            disabled={!selectedConnectionId || busyId === selectedConnectionId}
            onClick={() => void removeConnection(selectedConnectionId)}
          >
            TypeSafe bağlantısını kaldır
          </button>
        </div>
      )}

      <label className="decision-share-confirmation">
        <input
          type="checkbox"
          checked={shareConfirmed}
          onChange={(event) => setShareConfirmed(event.target.checked)}
        />
        Seçtiğim iddia ve mühürlü kaynak alıntısının TypeSafe hizmetine gönderileceğini anlıyorum.
        Başka kaynaklar ve konsey geçmişi gönderilmeyecek.
      </label>

      {error ? <p className="form-error">{error}</p> : null}

      <div className="decision-source-list">
        {sources.map((source) => {
          const claim = claimById.get(source.claimId);
          return (
            <article key={source.id}>
              <div>
                <strong>{source.title}</strong>
                <small>{claim?.statement ?? source.claimId}</small>
              </div>
              <button
                type="button"
                disabled={
                  !source.excerpt ||
                  !evaluatorEnabled ||
                  !selectedConnectionId ||
                  !shareConfirmed ||
                  busyId === source.id
                }
                onClick={() => void startAssessment(source)}
              >
                {busyId === source.id ? "Başlatılıyor…" : "Jev ile gözlem incelemesi"}
              </button>
            </article>
          );
        })}
        {sources.length === 0 ? (
          <p className="empty">Önce bir iddiaya mühürlü kaynak alıntısı ekleyin.</p>
        ) : null}
        {!evaluatorEnabled ? (
          <p className="empty">
            Karar çağrıları şu anda kapalı. Canlı bağlantı testinde ENABLE_DECISION_EVALUATOR=true
            ayarı açıldığında bu düğmeler etkinleşecek.
          </p>
        ) : null}
      </div>

      <div className="decision-result-list">
        {assessments.map((assessment) => {
          const source = sources.find((item) => item.id === assessment.sourceId);
          const operation = operations.find((item) => item.assessmentId === assessment.id);
          return (
            <article key={assessment.id} className={`decision-result ${assessment.status}`}>
              <div className="decision-result-heading">
                <div>
                  <strong>{source?.title ?? assessment.sourceId}</strong>
                  <small>
                    {statusNames[assessment.status]} · {assessment.returnedModel ?? assessment.requestedModel}
                  </small>
                </div>
                {!assessment.isCurrent ? <span>Girdi sürümü eski</span> : <span>Gözlem</span>}
              </div>
              {assessment.result ? (
                <>
                  <p className="decision-label">{labelNames[assessment.result.label]}</p>
                  <div className="decision-probabilities">
                    {Object.entries(assessment.result.probabilities).map(([label, probability]) => (
                      <span key={label}>
                        {labelNames[label as EvaluationLabel]}: %{(probability * 100).toFixed(1)}
                      </span>
                    ))}
                  </div>
                  <small>
                    Dağılım yoğunluğu: {assessment.result.providerConfidence === null
                      ? "yok"
                      : assessment.result.providerConfidence.toFixed(2)}. Bu değer doğruluk olasılığı değildir.
                  </small>
                </>
              ) : assessment.errorCode ? (
                <p>Hata kodu: {assessment.errorCode}</p>
              ) : null}
              {["queued", "running"].includes(assessment.status) ? (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={busyId === assessment.id}
                  onClick={() => void cancelAssessment(assessment.id)}
                >
                  İncelemeyi iptal et
                </button>
              ) : null}
              {operation ? (
                <div className="decision-operator-actions">
                  <p>Uzak çağrının sonucu bilinmiyor. Otomatik tekrar durduruldu.</p>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={busyId === operation.id}
                    onClick={() => void resolveOperation(operation.id, "discard")}
                  >
                    Başarısız say
                  </button>
                  <button
                    type="button"
                    disabled={busyId === operation.id}
                    onClick={() => void resolveOperation(operation.id, "authorize_retry")}
                  >
                    Bir tekrar yetkilendir
                  </button>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
