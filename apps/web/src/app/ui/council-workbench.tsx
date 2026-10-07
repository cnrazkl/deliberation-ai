"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { WorkspaceShell, ThemeSelect, type WorkspaceView } from "./workspace-shell";
import { LocalDiagnosticsPanel } from "./local-diagnostics-panel";
import { PrivateOutputDefaultPanel } from "./private-output-default-panel";
import { CouncilTemplateDeletionPanel } from "./council-template-deletion-panel";
import type { RunRecord } from "@deliberation-ai/application";
import { auditPromptRevision, findCriticalMissingContext, PROMPT_REVISION_VERSION, suggestStructuredQuestion } from "@deliberation-ai/domain";
import { MAX_ATTACHMENT_BYTES, MAX_PDF_ATTACHMENT_BYTES, MAX_RUN_ATTACHMENTS, MAX_TOTAL_ATTACHMENT_BYTES } from "@deliberation-ai/contracts";
import type {
  CouncilMemberConfig,
  FrozenContinuation,
  ContinuationCompactionPacket,
  CreateRunRequest,
  CatalogModelDetail,
  CouncilRole,
  EvidenceFreshnessStatus,
  EvidenceState,
  EvidenceRelation,
  EvidenceReviewStatus,
  ExecutionLimits,
  MemorySourceType,
  ModelCatalogCheck,
  ReasoningLevel,
  ReviewRoundCount,
  RiskProfile,
  RemoteProvider,
  RunAttachment,
  SaveProviderConnectionRequest,
  SynthesisCoverage,
  UpdateEvidenceSourceRequest,
  WebSearchMode,
} from "@deliberation-ai/contracts";
import { DecisionAssessmentPanel } from "./decision-assessment-panel";
import { ConnectionGenerationPanel } from "./connection-generation-panel";
import { ClaimContextPanel } from "./claim-context-panel";
import { ResearchCapturePanel } from "./research-capture-panel";
import { EvidenceCandidatePanel } from "./evidence-candidate-panel";
import { LocalToolsPanel } from "./local-tools-panel";
import { KnowledgePanel } from "./knowledge-panel";
import { LocalSchedulesPanel } from "./local-schedules-panel";
import { PromptRevisionEditor } from "./prompt-revision-editor";
import { PreflightDraftsPanel } from "./preflight-drafts-panel";
import { RunHistoryPanel } from "./run-history-panel";
import { RunBranchesPanel } from "./run-branches-panel";
import { ConversationPanel } from "./conversation-panel";
import { PrivateBranchSeedButton } from "./private-branches-panel";
import { ConversationDeletionPanel } from "./conversation-deletion-panel";
import { PrivateBranchesPanel } from "./private-branches-panel";
import { ConversationLibraryPanel } from "./conversation-library-panel";
import { RunUsagePanel } from "./run-usage-panel";
import { ContinuationArchiveDetails, ContinuationCompactionEditor } from "./continuation-compaction-editor";
import { RiskAssessmentSummary } from "./risk-assessment-summary";
import { defaultExecutionLimits, executionLimitError, ExecutionLimitsEditor } from "./execution-limits-editor";
import type { TokenPreview } from "../../lib/token-preview";
import { SubmissionAttempts } from "../../lib/submission-attempts";

type PreviewImage = { sha256: string; mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; width: number; height: number };

const starterQuestion =
  "Karmaşık bir karar verirken hangi varsayımları doğrulamalı ve riskleri nasıl görünür tutmalıyım?";

const redTeamRole =
  "Varsayımları, karşı örnekleri, başarısızlık koşullarını ve geri dönüşü olmayan riskleri sınayan red-team üyesi";

const kindLabels = {
  shared: "ortak",
  recommendation: "öneri",
  objection: "itiraz",
  risk: "risk",
} as const;

const reviewStanceLabels = {
  support: "destekliyor",
  qualify: "koşula bağlıyor",
  challenge: "itiraz ediyor",
} as const;

const councilRoleLabels: Record<CouncilRole, string> = {
  analyst: "Analist",
  "red-team": "Red-team",
};

const evidenceStateLabels: Record<EvidenceState, string> = {
  unsupported: "Desteklenmiyor",
  "model-supported": "Yalnız model desteği",
  "externally-verified": "Dışarıdan doğrulandı",
  contradicted: "Çelişiyor",
  stale: "Güncelliğini yitirdi",
};

const synthesisCoverageLabels: Record<SynthesisCoverage, string> = {
  included: "Senteze dahil",
  unresolved: "Çözümsüz",
  omitted: "Sentez dışında",
};

const evidenceRelationLabels: Record<EvidenceRelation, string> = {
  supports: "Destekliyor",
  contradicts: "Çelişiyor",
  context: "Bağlam sağlıyor",
};

const evidenceReviewStatusLabels: Record<EvidenceReviewStatus, string> = {
  unreviewed: "İncelenmedi",
  verified: "Doğrulandı",
  rejected: "Reddedildi",
};

const evidenceFreshnessStatusLabels: Record<EvidenceFreshnessStatus, string> = {
  unreviewed: "Güncellik incelenmedi",
  current: "Güncel kabul edildi",
  "needs-review": "Yeniden incelenmeli",
  changed: "Kaynak değişmiş",
  inaccessible: "Kaynağa erişilemiyor",
  stale: "Güncelliğini yitirdi",
};

type ReportClaim = NonNullable<RunRecord["report"]>["sharedClaims"][number];

const terminalStatuses = new Set(["completed", "partially_completed", "failed", "cancelled"]);

const memberCatalog: CouncilMemberConfig[] = [
  { id: "member-a", label: "Analist A", role: "Süreç ve izlenebilirlik analisti", provider: "openai", model: "", reasoningLevel: "default", webSearchMode: "off", councilRole: "analyst", receiveAttachments: true },
  { id: "member-b", label: "Analist B", role: "Risk analisti", provider: "openai", model: "", reasoningLevel: "default", webSearchMode: "off", councilRole: "analyst", receiveAttachments: true },
  { id: "member-c", label: "Analist C", role: "Kanıt analisti", provider: "openai", model: "", reasoningLevel: "default", webSearchMode: "off", councilRole: "analyst", receiveAttachments: true },
  { id: "member-d", label: "Analist D", role: "Uygulama analisti", provider: "openai", model: "", reasoningLevel: "default", webSearchMode: "off", councilRole: "analyst", receiveAttachments: true },
  { id: "member-e", label: "Analist E", role: "Alternatifler analisti", provider: "openai", model: "", reasoningLevel: "default", webSearchMode: "off", councilRole: "analyst", receiveAttachments: true },
  { id: "member-f", label: "Analist F", role: "Varsayım analisti", provider: "openai", model: "", reasoningLevel: "default", webSearchMode: "off", councilRole: "analyst", receiveAttachments: true },
];

async function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      const dimensions = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return dimensions;
    } catch {
      // The browser image element can decode formats that createImageBitmap rejects.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  } catch {
    throw new Error(`${file.name} geçerli bir görsel değil.`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function assignConnectionToUnconfiguredMembers(
  current: CouncilMemberConfig[],
  available: ProviderConnection[],
): CouncilMemberConfig[] {
  const fallback = available[0];
  if (!fallback) return current;
  return current.map((member) => available.some((connection) => connection.id === member.connectionId)
    ? member
    : {
        ...member,
        provider: fallback.provider,
        connectionId: fallback.id,
        model: fallback.defaultModel,
        receiveAttachments: member.receiveAttachments ?? true,
      });
}

const providerLabels: Record<RemoteProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic Claude",
  google: "Google Gemini",
  "openai-compatible": "OpenAI uyumlu",
};

const reasoningLabels: Record<ReasoningLevel, string> = {
  default: "Model varsayılanı",
  none: "Kapalı",
  minimal: "En az",
  low: "Düşük",
  medium: "Orta",
  high: "Yüksek",
  xhigh: "Çok yüksek",
  max: "Maksimum (destekleyen modeller)",
};

const webSearchModeLabels: Record<WebSearchMode, string> = {
  off: "Kapalı",
  auto: "Gerektiğinde model karar versin",
};

type EndpointPreset = SaveProviderConnectionRequest["endpointPreset"];
type ReasoningProtocol = SaveProviderConnectionRequest["reasoningProtocol"];
type StructuredOutputMode = SaveProviderConnectionRequest["structuredOutputMode"];

const endpointPresets: Record<
  EndpointPreset,
  { label: string; baseUrl: string; reasoningProtocol: ReasoningProtocol; structuredOutputMode: StructuredOutputMode; guide: string; modelExample: string }
> = {
  custom: { label: "Özel uç nokta", baseUrl: "", reasoningProtocol: "none", structuredOutputMode: "json-object", guide: "Sunucunuzun OpenAI uyumlu /chat/completions adresini ve model kimliğini girin.", modelExample: "sunucudaki-model-kimliği" },
  kimi: { label: "Kimi", baseUrl: "https://api.moonshot.ai/v1", reasoningProtocol: "openai", structuredOutputMode: "json-object", guide: "Moonshot API anahtarını ve hesabınızda açık Kimi model kimliğini kullanın.", modelExample: "kimi-k2.5" },
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com", reasoningProtocol: "openai", structuredOutputMode: "json-object", guide: "DeepSeek API, OpenAI uyumlu Chat Completions kullanır. Güncel düşük maliyetli model kimliği deepseek-flash'tir.", modelExample: "deepseek-flash" },
  qwen: { label: "Qwen / Model Studio", baseUrl: "", reasoningProtocol: "none", structuredOutputMode: "json-object", guide: "Model Studio bölgenize ait OpenAI uyumlu temel URL’yi ve deployment/model adını girin.", modelExample: "qwen-plus" },
  vllm: { label: "vLLM (yerel)", baseUrl: "http://127.0.0.1:8000/v1", reasoningProtocol: "none", structuredOutputMode: "json-object", guide: "vLLM sunucusunu OpenAI uyumlu modda başlatın; model alanı served-model-name ile eşleşmeli.", modelExample: "yerel-model" },
  ollama: { label: "Ollama (yerel)", baseUrl: "http://127.0.0.1:11434/v1", reasoningProtocol: "none", structuredOutputMode: "json-object", guide: "Ollama çalışıyor olmalı; model alanına ollama list çıktısındaki adı yazın.", modelExample: "qwen3" },
  litellm: { label: "LiteLLM (yerel)", baseUrl: "http://127.0.0.1:4000/v1", reasoningProtocol: "openai", structuredOutputMode: "json-object", guide: "LiteLLM Proxy’yi çalıştırın; model alanına config.yaml içindeki model_name takma adını yazın.", modelExample: "konsey-modeli" },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", reasoningProtocol: "openai", structuredOutputMode: "json-object", guide: "OpenRouter anahtarını ve sağlayıcı/model biçimindeki model slug’ını girin. Web arama bu bağlantıda görev bazında açılabilir.", modelExample: "openai/gpt-5.6-sol" },
  nvidia: { label: "NVIDIA hosted", baseUrl: "https://integrate.api.nvidia.com/v1", reasoningProtocol: "none", structuredOutputMode: "prompt-only", guide: "NVIDIA hosted API anahtarınızı ve tam model kimliğini girin. Katalog isteğe bağlıdır; model erişimi, düşünme, görsel ve şema desteği doğrulanmış sayılmaz. Bu sürüm metin kullanır; yönetilen web arama kapalıdır. Kendi NIM sunucunuz için Özel uç nokta seçin.", modelExample: "meta/llama-3.1-70b-instruct" },
};

const nativeProviderGuides: Record<Exclude<RemoteProvider, "openai-compatible">, { guide: string; modelExample: string }> = {
  openai: {
    guide: "OpenAI API anahtarınızı girin. Modeli bu bağlantının varsayılanı olarak kaydedersiniz; her görevde başka bir OpenAI model kimliği seçebilirsiniz.",
    modelExample: "gpt-5.6-sol",
  },
  anthropic: {
    guide: "Anthropic API anahtarınızı girin. Claude model kimliğini Anthropic hesabınızda etkin olan adla yazın.",
    modelExample: "claude-opus-4-1",
  },
  google: {
    guide: "Google AI Studio / Gemini API anahtarınızı girin. Model kimliğini Gemini API’de görünen adla yazın.",
    modelExample: "gemini-2.5-pro",
  },
};

type RunEventReplay = {
  run: RunRecord;
  events: Array<{ sequence: number }>;
};

type ProviderConnection = {
  id: string;
  provider: RemoteProvider;
  label: string;
  defaultModel: string;
  configured: true;
  baseUrl?: string;
  endpointPreset: EndpointPreset;
  reasoningProtocol: ReasoningProtocol;
  structuredOutputMode: StructuredOutputMode;
  catalogCheck?: ModelCatalogCheck;
  revision?: number;
};

function catalogMetadataText(detail: CatalogModelDetail): string {
  const items: string[] = [];
  if (detail.displayName) items.push(detail.displayName);
  if (detail.inputTokenLimit) items.push(`Giriş sınırı ${detail.inputTokenLimit.toLocaleString("tr-TR")} token`);
  if (detail.outputTokenLimit) items.push(`Çıkış sınırı ${detail.outputTokenLimit.toLocaleString("tr-TR")} token`);
  if (detail.contextWindowTokens) items.push(`Bağlam penceresi ${detail.contextWindowTokens.toLocaleString("tr-TR")} token`);
  if (detail.reasoningLevels?.length) items.push(`Katalogda bildirilen düşünme düzeyleri: ${detail.reasoningLevels.map((level) => reasoningLabels[level]).join(", ")}`);
  if (detail.thinking !== undefined) items.push(`Katalog thinking alanı: ${detail.thinking ? "evet" : "hayır"}; düzeyler belirtilmiyor`);
  if (detail.reasoningParameterListed) items.push("Düşünme parametresi listeleniyor; düzeyler belirtilmiyor");
  return items.join(" · ");
}

function supportsManagedWebSearch(connection: ProviderConnection | undefined): boolean {
  if (!connection) return false;
  return connection.provider !== "openai-compatible" || connection.endpointPreset === "openrouter";
}

type CouncilTemplate = {
  id: string;
  name: string;
  description: string;
  members: CouncilMemberConfig[];
  memberCount: number;
};

type SharedMemoryEntry = {
  id: string;
  content: string;
  evidenceState: EvidenceState;
  sourceType: MemorySourceType;
  sourceRunId: string;
  sourceClaimId: string;
  createdAt: string;
};

type EvidenceSource = {
  id: string;
  runId: string;
  claimId: string;
  title: string;
  url: string;
  excerpt: string | null;
  candidateProvenance?: unknown | null;
  relation: EvidenceRelation;
  reviewStatus: EvidenceReviewStatus;
  freshnessStatus: EvidenceFreshnessStatus;
  note: string;
  publishedAt: string | null;
  capturedAt: string;
  freshnessReviewedAt: string | null;
};

type OperatorProviderOperation = {
  id: string;
  runId: string;
  memberId: string;
  round: ReviewRoundCount;
  attempt: number;
  provider: string;
  model: string;
  status: "outcome_unknown";
  errorCode: string | null;
  startedAt: string;
  runStatus: string;
};

async function readJson(response: Response): Promise<RunRecord> {
  const body = (await response.json()) as RunRecord | { error?: string };
  if (!response.ok) {
    throw new Error("error" in body && body.error ? body.error : "İstek tamamlanamadı.");
  }
  return body as RunRecord;
}

async function readReplay(response: Response): Promise<RunEventReplay> {
  const body = (await response.json()) as RunEventReplay | { error?: string };
  if (!response.ok) {
    throw new Error("error" in body && body.error ? body.error : "İlerleme alınamadı.");
  }
  return body as RunEventReplay;
}

export function CouncilWorkbench() {
  const configRef = useRef<HTMLDetailsElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [libraryDeletionId, setLibraryDeletionId] = useState<string>();
  const [privateConversationId, setPrivateConversationId] = useState<string>();
  const [view, setView] = useState<WorkspaceView>("chat");
  const [question, setQuestion] = useState(starterQuestion);
  const [continuationContext, setContinuationContext] = useState<FrozenContinuation>();
  const [compactionDraft, setCompactionDraft] = useState<{ packet: ContinuationCompactionPacket; summary: string }>();
  const [continuationReviewed, setContinuationReviewed] = useState(false);
  const [loadingContinuation, setLoadingContinuation] = useState(false);
  const [promptCandidate, setPromptCandidate] = useState(() => suggestStructuredQuestion(starterQuestion));
  const [promptChoice, setPromptChoice] = useState<"original" | "candidate">("original");
  const [reviewRounds, setReviewRounds] = useState<ReviewRoundCount>(1);
  const [selfRevisionEnabled, setSelfRevisionEnabled] = useState(false);
  const [executionLimitsEnabled, setExecutionLimitsEnabled] = useState(false);
  const [configuredExecutionLimits, setConfiguredExecutionLimits] = useState<ExecutionLimits>(defaultExecutionLimits);
  const [rerunningMemberId, setRerunningMemberId] = useState<string>();
  const [selectedRiskProfile, setSelectedRiskProfile] = useState<RiskProfile>("standard");
  const [members, setMembers] = useState<CouncilMemberConfig[]>(() => memberCatalog.slice(0, 2));
  const [templates, setTemplates] = useState<CouncilTemplate[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const templateIntent = useRef<{ body: string; requestId: string } | undefined>(undefined);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string>();
  const [deletingTemplateBusy, setDeletingTemplateBusy] = useState(false);
  const [connections, setConnections] = useState<ProviderConnection[]>([]);
  const [catalogChecks, setCatalogChecks] = useState<Record<string, ModelCatalogCheck>>({});
  const [checkingConnectionId, setCheckingConnectionId] = useState<string>();
  const [connectionLabel, setConnectionLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [connectionProvider, setConnectionProvider] = useState<RemoteProvider>("openai");
  const [endpointPreset, setEndpointPreset] = useState<EndpointPreset>("custom");
  const [baseUrl, setBaseUrl] = useState("");
  const [reasoningProtocol, setReasoningProtocol] = useState<ReasoningProtocol>("openai");
  const [structuredOutputMode, setStructuredOutputMode] =
    useState<StructuredOutputMode>("json-schema");
  const [editingConnectionId, setEditingConnectionId] = useState<string>();
  const [savingConnection, setSavingConnection] = useState(false);
  const [operatorOperations, setOperatorOperations] = useState<OperatorProviderOperation[]>([]);
  const [memoryEntries, setMemoryEntries] = useState<SharedMemoryEntry[]>([]);
  const [selectedMemoryEntryIds, setSelectedMemoryEntryIds] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<RunAttachment[]>([]);
  const [knowledgePacket, setKnowledgePacket] = useState<CreateRunRequest["knowledgePacket"] | null>(null);
  const [knowledgeBlocked, setKnowledgeBlocked] = useState(false);
  const [knowledgePanelGeneration, setKnowledgePanelGeneration] = useState(0);
  const [attachmentDimensions, setAttachmentDimensions] = useState<PreviewImage[]>([]);
  const [preparingAttachments, setPreparingAttachments] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string>();
  const [tokenPreview, setTokenPreview] = useState<{ key: string; value: TokenPreview }>();
  const [previewRefresh, setPreviewRefresh] = useState(0);
  const [tokenPreviewError, setTokenPreviewError] = useState<{ key: string; message: string }>();
  const [selectedToolResultIds, setSelectedToolResultIds] = useState<string[]>([]);
  const [retrieveToolContext, setRetrieveToolContext] = useState(false);
  const [savingMemoryClaimId, setSavingMemoryClaimId] = useState<string>();
  const [evidenceSources, setEvidenceSources] = useState<EvidenceSource[]>([]);
  const [selectedEvidenceClaimId, setSelectedEvidenceClaimId] = useState<string>();
  const [evidenceTitle, setEvidenceTitle] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [evidenceExcerpt, setEvidenceExcerpt] = useState("");
  const [evidencePublishedAt, setEvidencePublishedAt] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [evidenceRelation, setEvidenceRelation] = useState<EvidenceRelation>("supports");
  const [savingEvidenceSource, setSavingEvidenceSource] = useState(false);
  const [resolvingOperationId, setResolvingOperationId] = useState<string>();
  const [updatingClaimId, setUpdatingClaimId] = useState<string>();
  const [run, setRun] = useState<RunRecord>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [exportingRun, setExportingRun] = useState(false);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [draftRefreshKey, setDraftRefreshKey] = useState(0);
  const [focusDraftId, setFocusDraftId] = useState<string>();
  const activeRunIdRef = useRef<string | undefined>(undefined);
  const cancelActiveWatchRef = useRef<(() => void) | undefined>(undefined);
  const submissionAttemptsRef = useRef(new SubmissionAttempts());
  const submittingRef = useRef(false);
  const rerunningRef = useRef(false);

  useEffect(() => () => cancelActiveWatchRef.current?.(), []);
  const evidenceRunId = run?.report ? run.runId : undefined;
  const originalQuestion = question.trim();
  const needsContext = findCriticalMissingContext(originalQuestion).length > 0;
  const promptRevision = { version: PROMPT_REVISION_VERSION as typeof PROMPT_REVISION_VERSION, originalQuestion,
    candidateQuestion: promptCandidate.trim(), choice: promptChoice };
  const revisionAudit = auditPromptRevision(promptRevision);
  const selectedQuestion = needsContext ? originalQuestion : revisionAudit.selectedQuestion;
  const executionLimits = executionLimitsEnabled ? configuredExecutionLimits : undefined;
  const plannedProviderCalls = members.length * (1 + reviewRounds);
  const limitsError = executionLimitError(executionLimits, plannedProviderCalls);
  const continuationSource: CreateRunRequest["continuationSource"] = compactionDraft ? {
    runId: compactionDraft.packet.sourceRunId, expectedSha256: compactionDraft.packet.sourceSha256,
    compaction: { version: "manual-continuation-compaction-v1", summary: compactionDraft.summary.trim(), reviewed: true },
  } : continuationContext ? { runId: continuationContext.sourceRunId, expectedSha256: continuationContext.sha256 } : undefined;
  const previewRequestKey = JSON.stringify({
    ...(knowledgePacket ? { knowledgePacket } : {}),
    ...(continuationSource ? { continuationSource } : {}),
    question: selectedQuestion, members, providerMode: "remote",
    riskProfile: selectedRiskProfile, reviewRounds,
    memoryEntryIds: selectedMemoryEntryIds, toolResultIds: selectedToolResultIds,
    retrieveToolContext, images: attachmentDimensions,
    documents: attachments.filter((attachment) => attachment.mimeType === "application/pdf").map((attachment) => ({ name: attachment.name, sha256: attachment.sha256, content: attachment.extractedText })),
  });
  const currentPreviewError = tokenPreviewError?.key === previewRequestKey ? tokenPreviewError.message : undefined;

  useEffect(() => {
    if (compactionDraft && (!continuationReviewed || compactionDraft.summary.trim().length < 10)) return;
    if (!selectedQuestion && attachments.length === 0) return;
    if (members.some((member) => !member.connectionId || !member.model.trim())) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetch("/api/runs/token-preview", {
        method: "POST", headers: { "content-type": "application/json" },
        body: previewRequestKey, signal: controller.signal,
      }).then(async (response) => {
        const body = await response.json() as TokenPreview & { error?: string };
        if (!response.ok) throw new Error(body.error ?? "Token önizlemesi hesaplanamadı.");
        setTokenPreview({ key: previewRequestKey, value: body });
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setTokenPreviewError({ key: previewRequestKey, message: reason instanceof Error ? reason.message : "Token önizlemesi hesaplanamadı." });
      });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [previewRequestKey, selectedQuestion, attachments.length, members, previewRefresh, compactionDraft, continuationReviewed]);

  async function refreshEvidenceSources(runId: string): Promise<void> {
    const response = await fetch(`/api/evidence-sources?runId=${encodeURIComponent(runId)}`, { cache: "no-store" });
    if (!response.ok) return;
    const body = (await response.json()) as { sources: EvidenceSource[] };
    setEvidenceSources(body.sources);
  }

  useEffect(() => {
    void fetch("/api/provider-connections", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as { connections: ProviderConnection[] };
        setConnections(body.connections);
        setCatalogChecks(Object.fromEntries(body.connections.flatMap((connection) => connection.catalogCheck ? [[connection.id, connection.catalogCheck]] : [])));
        setMembers((current) => assignConnectionToUnconfiguredMembers(current, body.connections));
      })
      .catch(() => undefined);
    void fetch("/api/council-templates", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as { templates: CouncilTemplate[] };
        setTemplates(body.templates);
      })
      .catch(() => undefined);
    void refreshOperatorOperations();
    void fetch("/api/memory-entries", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as { entries: SharedMemoryEntry[] };
        setMemoryEntries(body.entries);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!evidenceRunId) return;
    void fetch(`/api/evidence-sources?runId=${encodeURIComponent(evidenceRunId)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as { sources: EvidenceSource[] };
        setEvidenceSources(body.sources);
      })
      .catch(() => undefined);
  }, [evidenceRunId]);

  async function refreshOperatorOperations(): Promise<void> {
    try {
      const response = await fetch("/api/provider-operations", { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as { operations: OperatorProviderOperation[] };
      setOperatorOperations(body.operations);
    } catch {
      // The council remains usable if the local operator projection is temporarily unavailable.
    }
  }

  function selectMemberCount(count: number): void {
    setMembers((current) => {
      if (count <= current.length) return current.slice(0, count);
      const next = [...current];
      for (let index = current.length; index < count; index += 1) {
        const fixture = memberCatalog[index];
        if (!fixture) continue;
        const connection = connections[0];
        next.push(
          connection
            ? {
                ...fixture,
                provider: connection.provider,
                model: connection.defaultModel,
                connectionId: connection.id,
              }
            : { ...fixture },
        );
      }
      return next;
    });
  }

  function setRedTeamComparison(enabled: boolean): void {
    setMembers((current) => {
      if (enabled) {
        if (current.some((member) => member.councilRole === "red-team")) return current;

        if (current.length < 6) {
          const fixture = memberCatalog[current.length] ?? memberCatalog.at(-1)!;
          const source = current.at(-1)!;
          return [
            ...current,
            {
              ...source,
              id: fixture.id,
              label: "Red-team",
              role: redTeamRole,
              councilRole: "red-team" as const,
            },
          ];
        }

        return current.map((member, index) =>
          index === current.length - 1
            ? { ...member, role: redTeamRole, councilRole: "red-team" as const }
            : member,
        );
      }

      return current.map((member, index) => {
        if (member.councilRole !== "red-team") return member;
        const fixture = memberCatalog[index] ?? memberCatalog[0]!;
        return {
          ...member,
          label: member.label === "Red-team" ? fixture.label : member.label,
          role: member.role === redTeamRole ? fixture.role : member.role,
          councilRole: "analyst" as const,
        };
      });
    });
  }

  function selectRiskProfile(profile: RiskProfile): void {
    setSelectedRiskProfile(profile);
    if (profile === "high") {
      setReviewRounds((current) => current === 0 ? 1 : current);
      setRedTeamComparison(true);
    }
  }

  async function selectAttachments(files: File[]): Promise<void> {
    if (files.length === 0) return;
    setAttachmentError(undefined);
    setPreparingAttachments(true);
    try {
      if (attachments.length + files.length > MAX_RUN_ATTACHMENTS) {
        throw new Error("Bir görevde en fazla 6 dosya olabilir.");
      }
      const next = [...attachments];
      const dimensions = [...attachmentDimensions];
      let totalBytes = attachments.reduce((sum, attachment) => {
        const padding = attachment.dataBase64.endsWith("==") ? 2 : attachment.dataBase64.endsWith("=") ? 1 : 0;
        return sum + Math.floor(attachment.dataBase64.length * 3 / 4) - padding;
      }, 0);
      for (const file of files) {
        if (file.name.length > 120) throw new Error("Dosya adı en fazla 120 karakter olabilir.");
        const extension = file.name.toLowerCase().split(".").at(-1);
        const mimeType = extension === "pdf" ? "application/pdf"
          : file.type || ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" } as Record<string, string>)[extension ?? ""];
        if (!mimeType || !["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"].includes(mimeType)) {
          throw new Error(`${file.name}: yalnızca PDF, JPEG, PNG, WebP ve GIF desteklenir.`);
        }
        const limit = mimeType === "application/pdf" ? MAX_PDF_ATTACHMENT_BYTES : MAX_ATTACHMENT_BYTES;
        if (file.size === 0 || file.size > limit) {
          throw new Error(`${file.name}: ${mimeType === "application/pdf" ? "PDF en fazla 5 MiB" : "görsel en fazla 2 MiB"} olabilir.`);
        }
        const bytes = await file.arrayBuffer();
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
          .map((value) => value.toString(16).padStart(2, "0"))
          .join("");
        if (next.some((attachment) => attachment.sha256 === digest)) continue;
        totalBytes += file.size;
        if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) throw new Error("Eklerin toplam boyutu en fazla 12 MiB olabilir.");
        const dataBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(new Error(`${file.name} okunamadı.`));
          reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
          reader.readAsDataURL(file);
        });
        if (mimeType === "application/pdf") {
          const response = await fetch("/api/runs/prepare-pdf", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: file.name, mimeType, dataBase64, sha256: digest }),
          });
          const body = await response.json() as { extractedText?: string; error?: string };
          if (!response.ok || !body.extractedText) {
            throw new Error(body.error ?? `${file.name}: PDF metni okunamadı.`);
          }
          next.push({ name: file.name, mimeType, dataBase64, sha256: digest, extractedText: body.extractedText });
        } else {
          const image = await readImageDimensions(file);
          dimensions.push({ sha256: digest, mimeType: mimeType as PreviewImage["mimeType"], width: image.width, height: image.height });
          next.push({ name: file.name, mimeType: mimeType as PreviewImage["mimeType"], dataBase64, sha256: digest });
        }
      }
      setAttachments(next);
      setAttachmentDimensions(dimensions);
    } catch (reason) {
      setAttachmentError(reason instanceof Error ? reason.message : "Ekler hazırlanamadı.");
    } finally {
      setPreparingAttachments(false);
    }
  }

  function updateMember(index: number, patch: Partial<CouncilMemberConfig>): void {
    setMembers((current) =>
      current.map((member, memberIndex) =>
        memberIndex === index ? { ...member, ...patch } : member,
      ),
    );
  }

  async function saveTemplate(): Promise<void> {
    if (!templateName.trim() || savingTemplate || deletingTemplateBusy) return;
    const draft = { name: templateName.trim(), description: `${members.length} üyeli kayıtlı sağlayıcı konseyi`, members };
    const bodyKey = JSON.stringify(draft);
    if (!templateIntent.current || templateIntent.current.body !== bodyKey) templateIntent.current = { body: bodyKey, requestId: crypto.randomUUID() };
    setSavingTemplate(true);
    setError(undefined);
    try {
      const response = await fetch("/api/council-templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...draft, requestId: templateIntent.current.requestId }),
      });
      const body = (await response.json()) as CouncilTemplate | { error?: string };
      if (!response.ok) {
        throw new Error("error" in body && body.error ? body.error : "Şablon kaydedilemedi.");
      }
      const saved = body as CouncilTemplate;
      setTemplates((current) => [...current.filter((item) => item.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name, "tr")));
      setTemplateName("");
      templateIntent.current = undefined;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Şablon kaydedilemedi.");
    } finally {
      setSavingTemplate(false);
    }
  }

  const onTemplateDeleted = useCallback(() => {
    setTemplates((current) => current.filter((item) => item.id !== deletingTemplateId));
    setDeletingTemplateId(undefined);
  }, [deletingTemplateId]);

  async function saveConnection(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSavingConnection(true);
    setError(undefined);
    try {
      const response = await fetch("/api/provider-connections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(editingConnectionId ? { id: editingConnectionId } : {}),
          provider: connectionProvider,
          label: connectionLabel,
          apiKey,
          defaultModel: model,
          ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
          endpointPreset,
          reasoningProtocol,
          structuredOutputMode,
        }),
      });
      const body = (await response.json()) as ProviderConnection | { error?: string };
      if (!response.ok) throw new Error("error" in body && body.error ? body.error : "Bağlantı kaydedilemedi.");
      const saved = body as ProviderConnection;
      setCatalogChecks((current) => {
        const next = { ...current };
        delete next[saved.id];
        return next;
      });
      setConnections((current) =>
        [...current.filter((item) => item.id !== saved.id), saved].sort((a, b) =>
          a.label.localeCompare(b.label, "tr"),
        ),
      );
      setMembers((current) => assignConnectionToUnconfiguredMembers(current, [...connections, saved]));
      setConnectionLabel("");
      setApiKey("");
      setModel("");
      setEditingConnectionId(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Bağlantı kaydedilemedi.");
    } finally {
      setSavingConnection(false);
    }
  }

  function editConnection(connection: ProviderConnection): void {
    setEditingConnectionId(connection.id);
    setConnectionProvider(connection.provider);
    setConnectionLabel(connection.label);
    setApiKey("");
    setModel(connection.defaultModel);
    setEndpointPreset(connection.endpointPreset);
    setBaseUrl(connection.baseUrl ?? "");
    setReasoningProtocol(connection.reasoningProtocol);
    setStructuredOutputMode(connection.structuredOutputMode);
  }

  function cancelConnectionEdit(): void {
    setEditingConnectionId(undefined);
    setConnectionLabel("");
    setApiKey("");
    setModel("");
  }

  async function removeConnection(connectionId: string): Promise<void> {
    const response = await fetch(`/api/provider-connections?id=${encodeURIComponent(connectionId)}`, { method: "DELETE" });
    if (!response.ok) {
      setError("Bağlantı kaldırılamadı.");
      return;
    }
    const remaining = connections.filter((item) => item.id !== connectionId);
    if (editingConnectionId === connectionId) cancelConnectionEdit();
    setConnections(remaining);
    setCatalogChecks((current) => {
      const next = { ...current };
      delete next[connectionId];
      return next;
    });
    setMembers((current) => assignConnectionToUnconfiguredMembers(current, remaining));
  }

  async function checkConnectionModels(connectionId: string): Promise<void> {
    setCheckingConnectionId(connectionId);
    try {
      const response = await fetch(`/api/provider-connections/${encodeURIComponent(connectionId)}/models`, { method: "POST" });
      if (response.status === 409) {
        setCatalogChecks((current) => {
          const next = { ...current };
          delete next[connectionId];
          return next;
        });
        setError("Bağlantı kontrol sırasında değişti; güncel bağlantıyı yeniden kontrol edin.");
        return;
      }
      if (!response.ok) throw new Error("Model kataloğu sorgulanamadı.");
      const result = (await response.json()) as ModelCatalogCheck;
      setCatalogChecks((current) => ({ ...current, [connectionId]: result }));
    } catch {
      setError("Model katalog sorgusu uygulama düzeyinde tamamlanamadı. Son kayıt korunuyor.");
    } finally {
      setCheckingConnectionId(undefined);
    }
  }

  async function pollRunFallback(runId: string): Promise<void> {
    let after = 0;
    let consecutiveFailures = 0;
    const controller = new AbortController();
    const connectionWarning = "İlerleme bağlantısı kesildi; yeniden bağlanılıyor.";
    const cancelPolling = (): void => controller.abort();
    cancelActiveWatchRef.current = cancelPolling;

    try {
      while (!controller.signal.aborted && activeRunIdRef.current === runId) {
        try {
          const response = await fetch(`/api/runs/${runId}/events?after=${after}`, {
            cache: "no-store",
            signal: controller.signal,
          });
          if (response.status === 404) throw new Error("Çalışma bulunamadı.");
          const replay = await readReplay(response);
          if (controller.signal.aborted || activeRunIdRef.current !== runId) return;

          const current = replay.run;
          const lastEvent = replay.events.at(-1);
          if (lastEvent) after = lastEvent.sequence;
          setRun(current);
          consecutiveFailures = 0;
          setError((previous) => previous === connectionWarning ? undefined : previous);
          if (terminalStatuses.has(current.status)) {
            await refreshOperatorOperations();
            if (controller.signal.aborted || activeRunIdRef.current !== runId) return;
            setHistoryRefreshKey((value) => value + 1);
            return;
          }
        } catch (reason) {
          if (controller.signal.aborted || activeRunIdRef.current !== runId) return;
          if (reason instanceof Error && reason.message === "Çalışma bulunamadı.") throw reason;
          consecutiveFailures += 1;
          if (consecutiveFailures === 3) setError(connectionWarning);
        }

        const delay = consecutiveFailures === 0
          ? 1_000
          : Math.min(5_000, 1_000 * 2 ** Math.min(consecutiveFailures - 1, 3));
        await new Promise<void>((resolve) => {
          if (controller.signal.aborted) return resolve();
          const timer = window.setTimeout(() => {
            controller.signal.removeEventListener("abort", onAbort);
            resolve();
          }, delay);
          function onAbort(): void {
            window.clearTimeout(timer);
            resolve();
          }
          controller.signal.addEventListener("abort", onAbort, { once: true });
        });
      }
    } finally {
      controller.abort();
      if (cancelActiveWatchRef.current === cancelPolling) cancelActiveWatchRef.current = undefined;
    }
  }

  async function watchRun(runId: string): Promise<void> {
    if (typeof EventSource === "undefined") {
      await pollRunFallback(runId);
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const source = new EventSource(`/api/runs/${runId}/stream?after=0`);
      let settled = false;

      const cancelWatch = (): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(startupTimer);
        source.close();
        if (cancelActiveWatchRef.current === cancelWatch) cancelActiveWatchRef.current = undefined;
        resolve();
      };
      cancelActiveWatchRef.current = cancelWatch;

      const finishWithFallback = (): void => {
        if (settled) return;
        settled = true;
        source.close();
        if (cancelActiveWatchRef.current === cancelWatch) cancelActiveWatchRef.current = undefined;
        void pollRunFallback(runId).then(resolve, reject);
      };

      const startupTimer = window.setTimeout(finishWithFallback, 4_000);

      source.addEventListener("run", (event) => {
        try {
          if (activeRunIdRef.current !== runId) {
            cancelWatch();
            return;
          }
          const replay = JSON.parse((event as MessageEvent<string>).data) as RunEventReplay;
          window.clearTimeout(startupTimer);
          setRun(replay.run);
          if (terminalStatuses.has(replay.run.status)) {
            settled = true;
            source.close();
            if (cancelActiveWatchRef.current === cancelWatch) cancelActiveWatchRef.current = undefined;
            setHistoryRefreshKey((value) => value + 1);
            void refreshOperatorOperations().finally(resolve);
          }
        } catch {
          finishWithFallback();
        }
      });

      source.onerror = () => {
        finishWithFallback();
      };
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (knowledgeBlocked || submittingRef.current || preparingAttachments || loadingContinuation || (continuationSource && !continuationReviewed) || limitsError || tokenPreview?.key !== previewRequestKey || !tokenPreview.value.riskPreflight || currentPreviewError) return;
    submittingRef.current = true;
    setPending(true);
    setError(undefined);
    cancelActiveWatchRef.current?.();
    activeRunIdRef.current = undefined;
    setRun(undefined);
    try {
      const attempt = submissionAttemptsRef.current.prepare("council", {
        ...(knowledgePacket ? { knowledgePacket } : {}),
        ...(continuationSource ? { continuationSource } : {}),
        question: selectedQuestion,
        ...(!needsContext ? { promptRevision } : {}),
        scenario: "success", providerMode: "remote", riskProfile: selectedRiskProfile,
        reviewRounds, selfRevisionEnabled: selfRevisionEnabled && reviewRounds > 0,
        ...(executionLimits ? { executionLimits } : {}),
        memoryEntryIds: selectedMemoryEntryIds, attachments, previewImages: attachmentDimensions,
        toolResultIds: selectedToolResultIds, retrieveToolContext,
        expectedPreflightFingerprint: tokenPreview.value.promptPlan?.fingerprint,
        expectedRiskFingerprint: tokenPreview.value.riskPreflight?.fingerprint, members,
      });
      const response = await fetch("/api/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: attempt.body,
        });
      if (response.status === 202) {
        const body = await response.json() as { preflightDraft: { id: string } };
        submissionAttemptsRef.current.complete("council", attempt.idempotencyKey);
        setFocusDraftId(body.preflightDraft.id);
        setDraftRefreshKey((value) => value + 1);
        return;
      }
      const created = await readJson(response);
      submissionAttemptsRef.current.complete("council", attempt.idempotencyKey);
      // A run opened while the POST was in flight retains the user's focus.
      if (activeRunIdRef.current !== undefined) {
        setHistoryRefreshKey((value) => value + 1);
        return;
      }
      activeRunIdRef.current = created.runId;
      setRun(created);
      setHistoryRefreshKey((value) => value + 1);
      if (!terminalStatuses.has(created.status)) await watchRun(created.runId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Beklenmeyen bir hata oluştu.");
      if (reason instanceof Error && reason.message.includes("Önizleme değişti")) {
        setTokenPreview(undefined);
        setPreviewRefresh((current) => current + 1);
      }
    } finally {
      submittingRef.current = false;
      setPending(false);
    }
  }

  async function openSavedRun(runId: string): Promise<void> {
    setView("chat");
    cancelActiveWatchRef.current?.();
    activeRunIdRef.current = runId;
    setError(undefined);
    setRun(undefined);
    let loaded: RunRecord;
    try { loaded = await readJson(await fetch(`/api/runs/${runId}`, { cache: "no-store" })); }
    catch (reason) {
      if (activeRunIdRef.current === runId) setError("Kayıtlı çalışma açılamadı. İçerik kaldırılmış veya artık erişilemiyor olabilir.");
      throw reason;
    }
    if (activeRunIdRef.current !== runId) return;
    setRun(loaded);
    window.requestAnimationFrame(() => document.getElementById("council-result")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }));
    if (!terminalStatuses.has(loaded.status)) {
      void watchRun(runId).catch((reason: unknown) => {
        if (activeRunIdRef.current === runId) {
          setError(reason instanceof Error ? reason.message : "Çalışma durumu izlenemedi.");
        }
      });
    }
  }

  async function selectContinuation(mode: "full" | "compaction" = "full"): Promise<void> {
    if (!run || loadingContinuation || pending) return;
    setLoadingContinuation(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/runs/${run.runId}/continuation${mode === "compaction" ? "?mode=compaction" : ""}`, { cache: "no-store" });
      const body = await response.json() as (FrozenContinuation | ContinuationCompactionPacket) & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Devam bağlamı okunamadı.");
      if (body.version === "continuation-compaction-source-v1") {
        setCompactionDraft({ packet: body, summary: "" });
        setContinuationContext(undefined);
      } else {
        setContinuationContext(body);
        setCompactionDraft(undefined);
      }
      setContinuationReviewed(false);
      setKnowledgePacket(null); setKnowledgeBlocked(false); setKnowledgePanelGeneration((value) => value + 1);
      setQuestion("");
      setPromptCandidate("");
      setPromptChoice("original");
      window.requestAnimationFrame(() => document.getElementById("question")?.focus());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Devam bağlamı okunamadı.");
    } finally {
      setLoadingContinuation(false);
    }
  }

  async function rerunSelectedMember(memberId: string): Promise<void> {
    if (!run || run.status !== "completed" || run.providerMode !== "remote" || rerunningRef.current) return;
    rerunningRef.current = true;
    const sourceRunId = run.runId;
    setRerunningMemberId(memberId);
    setError(undefined);
    try {
      const attempt = submissionAttemptsRef.current.prepare("member-rerun", { memberId, sourceRunId });
      const created = await readJson(await fetch(`/api/runs/${sourceRunId}/member-rerun`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memberId, idempotencyKey: attempt.idempotencyKey }),
      }));
      submissionAttemptsRef.current.complete("member-rerun", attempt.idempotencyKey);
      setHistoryRefreshKey((value) => value + 1);
      if (activeRunIdRef.current !== sourceRunId) return;
      cancelActiveWatchRef.current?.();
      activeRunIdRef.current = created.runId;
      setRun(created);
      setHistoryRefreshKey((value) => value + 1);
      if (!terminalStatuses.has(created.status)) await watchRun(created.runId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Üye tekrar çalıştırması başlatılamadı.");
    } finally {
      rerunningRef.current = false;
      setRerunningMemberId(undefined);
    }
  }

  async function cancel(): Promise<void> {
    if (!run || terminalStatuses.has(run.status)) return;
    try {
      const cancelled = await readJson(
        await fetch(`/api/runs/${run.runId}/cancel`, { method: "POST" }),
      );
      setRun(cancelled);
      setHistoryRefreshKey((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "İptal tamamlanamadı.");
    }
  }

  async function exportRun(format: "json" | "md" = "json"): Promise<void> {
    if (!run?.report || exportingRun) return;
    setExportingRun(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/runs/${run.runId}/export?format=${format}`, { method: "POST", cache: "no-store" });
      if (!response.ok) {
        const body = await response.json() as { error?: string };
        throw new Error(body.error ?? "Rapor indirilemedi.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `deliberationai-${format === "md" ? "synthesis" : "report"}-${run.runId}.${format}`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Rapor indirilemedi.");
    } finally {
      setExportingRun(false);
    }
  }

  async function updateEvidenceState(
    claimId: string,
    evidenceState: EvidenceState,
  ): Promise<void> {
    if (!run) return;
    setUpdatingClaimId(claimId);
    setError(undefined);
    try {
      const updated = await readJson(
        await fetch(
          `/api/runs/${run.runId}/claims/${encodeURIComponent(claimId)}/evidence-state`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ evidenceState }),
          },
        ),
      );
      setRun(updated);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Kanıt durumu güncellenemedi.");
    } finally {
      setUpdatingClaimId(undefined);
    }
  }

  async function updateSynthesisCoverage(
    claimId: string,
    synthesisCoverage: SynthesisCoverage,
  ): Promise<void> {
    if (!run) return;
    setUpdatingClaimId(claimId);
    setError(undefined);
    try {
      const updated = await readJson(
        await fetch(
          `/api/runs/${run.runId}/claims/${encodeURIComponent(claimId)}/synthesis-coverage`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ synthesisCoverage }),
          },
        ),
      );
      setRun(updated);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sentez kapsamı güncellenemedi.");
    } finally {
      setUpdatingClaimId(undefined);
    }
  }

  async function saveClaimToMemory(claimId: string): Promise<void> {
    if (!run) return;
    setSavingMemoryClaimId(claimId);
    setError(undefined);
    try {
      const response = await fetch("/api/memory-entries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: run.runId, claimId }),
      });
      const body = (await response.json()) as SharedMemoryEntry | { error?: string };
      if (!response.ok) {
        throw new Error("error" in body && body.error ? body.error : "İddia belleğe alınamadı.");
      }
      const entry = body as SharedMemoryEntry;
      setMemoryEntries((current) => [
        ...current.filter((item) => item.id !== entry.id),
        entry,
      ]);
      setSelectedMemoryEntryIds((current) =>
        current.includes(entry.id) || current.length >= 5 ? current : [...current, entry.id],
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "İddia belleğe alınamadı.");
    } finally {
      setSavingMemoryClaimId(undefined);
    }
  }

  async function removeMemoryEntry(memoryEntryId: string): Promise<void> {
    const response = await fetch(`/api/memory-entries?id=${encodeURIComponent(memoryEntryId)}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      setError("Bellek kaydı kaldırılamadı.");
      return;
    }
    setMemoryEntries((current) => current.filter((entry) => entry.id !== memoryEntryId));
    setSelectedMemoryEntryIds((current) => current.filter((id) => id !== memoryEntryId));
  }

  function toggleMemoryEntry(memoryEntryId: string, selected: boolean): void {
    setSelectedMemoryEntryIds((current) => {
      if (!selected) return current.filter((id) => id !== memoryEntryId);
      if (current.includes(memoryEntryId)) return current;
      if (current.length >= 5) {
        setError("Bir çalışmaya en fazla 5 bellek kaydı eklenebilir.");
        return current;
      }
      return [...current, memoryEntryId];
    });
  }

  async function saveEvidenceSource(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const reportClaimIds = run?.report
      ? [
          ...run.report.sharedClaims,
          ...run.report.distinctClaims,
          ...(run.report.redTeamChallenges ?? []),
        ].map((claim) => claim.claimId)
      : [];
    const targetClaimId =
      selectedEvidenceClaimId && reportClaimIds.includes(selectedEvidenceClaimId)
        ? selectedEvidenceClaimId
        : reportClaimIds[0];
    if (!run || !targetClaimId) return;
    setSavingEvidenceSource(true);
    setError(undefined);
    try {
      const response = await fetch("/api/evidence-sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runId: run.runId,
          claimId: targetClaimId,
          title: evidenceTitle,
          url: evidenceUrl,
          relation: evidenceRelation,
          excerpt: evidenceExcerpt,
          publishedAt: evidencePublishedAt || undefined,
          note: evidenceNote,
        }),
      });
      const body = (await response.json()) as EvidenceSource | { error?: string };
      if (!response.ok) {
        throw new Error("error" in body && body.error ? body.error : "Kanıt kaydı eklenemedi.");
      }
      const source = body as EvidenceSource;
      setEvidenceSources((current) => [...current, source]);
      setEvidenceTitle("");
      setEvidenceUrl("");
      setEvidenceExcerpt("");
      setEvidencePublishedAt("");
      setEvidenceNote("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Kanıt kaydı eklenemedi.");
    } finally {
      setSavingEvidenceSource(false);
    }
  }

  async function updateEvidenceSourceReview(
    sourceId: string,
    update: UpdateEvidenceSourceRequest,
  ): Promise<void> {
    const response = await fetch(`/api/evidence-sources/${sourceId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(update),
    });
    const body = (await response.json()) as EvidenceSource | { error?: string };
    if (!response.ok) {
      setError("error" in body && body.error ? body.error : "Kaynak durumu güncellenemedi.");
      return;
    }
    const updated = body as EvidenceSource;
    setEvidenceSources((current) =>
      current.map((source) => source.id === updated.id ? updated : source),
    );
  }

  async function removeEvidenceSource(sourceId: string): Promise<void> {
    const response = await fetch(`/api/evidence-sources?id=${encodeURIComponent(sourceId)}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Kanıt kaydı silinemedi.");
      return;
    }
    setEvidenceSources((current) => current.filter((source) => source.id !== sourceId));
  }

  function evidenceControl(claim: ReportClaim) {
    const evidenceState = claim.evidenceState ?? "unsupported";
    return (
      <label className={`evidence-control evidence-${evidenceState}`}>
        <span>Kanıt durumu</span>
        <select
          aria-label={`${claim.statement} kanıt durumu`}
          value={evidenceState}
          disabled={updatingClaimId === claim.claimId}
          onChange={(event) =>
            void updateEvidenceState(claim.claimId, event.target.value as EvidenceState)
          }
        >
          {Object.entries(evidenceStateLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
    );
  }

  function memoryButton(claim: ReportClaim) {
    const existing = memoryEntries.find(
      (entry) => entry.sourceRunId === run?.runId && entry.sourceClaimId === claim.claimId,
    );
    return (
      <button
        className="secondary-button memory-button"
        type="button"
        disabled={Boolean(existing) || savingMemoryClaimId === claim.claimId}
        onClick={() => void saveClaimToMemory(claim.claimId)}
      >
        {existing
          ? "Bellekte"
          : savingMemoryClaimId === claim.claimId
            ? "Belleğe alınıyor…"
            : "Belleğe ekle"}
      </button>
    );
  }

  async function resolveOperation(
    operation: OperatorProviderOperation,
    action: "discard" | "authorize_retry",
  ): Promise<void> {
    setResolvingOperationId(operation.id);
    setError(undefined);
    try {
      const response = await fetch(`/api/provider-operations/${operation.id}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = (await response.json()) as { requeued?: boolean; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Operatör eylemi tamamlanamadı.");
      setOperatorOperations((current) => current.filter((item) => item.id !== operation.id));
      if (body.requeued) {
        const requeued = await readJson(
          await fetch(`/api/runs/${operation.runId}`, { cache: "no-store" }),
        );
        cancelActiveWatchRef.current?.();
        activeRunIdRef.current = operation.runId;
        setRun(requeued);
        setHistoryRefreshKey((value) => value + 1);
        if (!terminalStatuses.has(requeued.status)) await watchRun(operation.runId);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Operatör eylemi tamamlanamadı.");
      await refreshOperatorOperations();
    } finally {
      setResolvingOperationId(undefined);
    }
  }

  const report = run?.report;
  const agreementSourceByMember = new Map(
    report?.memberResults.map((member) => [
      member.memberId,
      member.agreementSource ?? `member:${member.memberId}`,
    ]) ?? [],
  );
  const redTeamChallenges = report?.redTeamChallenges ?? [];
  const reviews = report?.reviews ?? [];
  const reviewFailures = report?.reviewFailures ?? [];
  const reviewPromptPlans = report?.reviewPromptPlans ?? [];
  const analystClaims = report ? [...report.sharedClaims, ...report.distinctClaims] : [];
  const redTeamReviewChallenges = reviews.flatMap((review) =>
    review.reviewerCouncilRole === "red-team"
      ? review.parsed.claims.filter((claim) => claim.reviewStance === "challenge")
      : [],
  );
  const synthesisClaims: Array<{ claim: ReportClaim; source: string }> = report
    ? [
        ...report.sharedClaims.map((claim) => ({ claim, source: "Ortak zemin" })),
        ...report.distinctClaims.map((claim) => ({ claim, source: "Farklı görüş" })),
        ...redTeamChallenges.map((claim) => ({ claim, source: "Red-team" })),
      ]
    : [];
  const selectedEvidenceClaim = synthesisClaims.find(
    ({ claim }) =>
      claim.claimId ===
      (selectedEvidenceClaimId && synthesisClaims.some((item) => item.claim.claimId === selectedEvidenceClaimId)
        ? selectedEvidenceClaimId
        : synthesisClaims[0]?.claim.claimId),
  )?.claim;
  const effectiveSelectedEvidenceClaimId = selectedEvidenceClaim?.claimId;
  const selectedClaimSources = evidenceSources.filter(
    (source) => source.claimId === effectiveSelectedEvidenceClaimId && !source.candidateProvenance,
  );
  const statusLabel =
    run?.status === "queued"
      ? "Sıraya alındı"
      : run?.status === "running"
        ? "Konsey çalışıyor"
        : run?.status === "completed"
          ? "Konsey tamamlandı"
          : run?.status === "cancelled"
            ? "Çalışma iptal edildi"
            : run?.status === "failed"
              ? "Çalışma başarısız"
              : "Kısmi sonuç";
  const connectionIds = new Set(connections.map((item) => item.id));
  const hasAnalyst = members.some((member) => member.councilRole === "analyst");
  const hasRedTeam = members.some((member) => member.councilRole === "red-team");
  const currentRisk = tokenPreview?.key === previewRequestKey ? tokenPreview.value.riskPreflight : undefined;
  const effectiveRiskProfile = currentRisk?.assessment.effectiveProfile ?? selectedRiskProfile;
  const highRiskReady = effectiveRiskProfile !== "high" || (hasRedTeam && reviewRounds >= 1);
  const connectionGuide =
    connectionProvider === "openai-compatible"
      ? endpointPresets[endpointPreset]
      : nativeProviderGuides[connectionProvider];
  const memberConfigurationValid = hasAnalyst && members.every(
    (member) => {
      const connection = connections.find((item) => item.id === member.connectionId);
      return (
      member.provider !== "fake" &&
      member.label.trim().length > 0 &&
      member.role.trim().length > 0 &&
      member.model.trim().length > 0 &&
      Boolean(
        member.connectionId &&
          connectionIds.has(member.connectionId) &&
          connection?.provider === member.provider &&
          (member.webSearchMode !== "auto" || supportsManagedWebSearch(connection)),
      )
      );
    },
  );

  const connectionForm = (
    <form className="connection-form" onSubmit={saveConnection}>
      <label>
        Sağlayıcı ailesi
        <select
          aria-label="Sağlayıcı ailesi"
          value={connectionProvider}
          disabled={Boolean(editingConnectionId)}
          onChange={(event) => {
            const provider = event.target.value as RemoteProvider;
            setConnectionProvider(provider);
            setEndpointPreset("custom");
            setBaseUrl("");
            setReasoningProtocol(
              provider === "openai"
                ? "openai"
                : provider === "anthropic"
                  ? "anthropic"
                  : provider === "google"
                    ? "gemini-level"
                    : "none",
            );
            setStructuredOutputMode(
              provider === "anthropic" ? "prompt-only" : provider === "openai-compatible" ? "json-object" : "json-schema",
            );
          }}
        >
          {Object.entries(providerLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      {connectionProvider === "openai-compatible" ? (
        <label>
          Uç nokta türü
          <select
            aria-label="Uç nokta türü"
            value={endpointPreset}
            onChange={(event) => {
              const preset = event.target.value as EndpointPreset;
              const settings = endpointPresets[preset];
              if (preset !== endpointPreset && (preset === "nvidia" || endpointPreset === "nvidia")) setApiKey("");
              setEndpointPreset(preset);
              setBaseUrl(settings.baseUrl);
              setReasoningProtocol(settings.reasoningProtocol);
              setStructuredOutputMode(settings.structuredOutputMode);
            }}
          >
            {Object.entries(endpointPresets).map(([value, settings]) => (
              <option key={value} value={value}>{settings.label}</option>
            ))}
          </select>
        </label>
      ) : null}
      <p className="connection-form-guide">
        {connectionGuide.guide} Model örneği: <code>{connectionGuide.modelExample}</code>
      </p>
      <label>
        Bağlantı adı
        <input
          type="text"
          value={connectionLabel}
          maxLength={80}
          placeholder="Örn. Kişisel OpenAI"
          onChange={(event) => setConnectionLabel(event.target.value)}
          required
        />
      </label>
      <label>
        API anahtarı
        <input
          type="password"
          value={apiKey}
          autoComplete="off"
          onChange={(event) => setApiKey(event.target.value)}
          required={
            !editingConnectionId &&
            !(
              connectionProvider === "openai-compatible" &&
              ["ollama", "vllm", "litellm"].includes(endpointPreset)
            )
          }
          placeholder={
            editingConnectionId
              ? "Değiştirmeyecekseniz boş bırakın"
              : connectionProvider === "openai-compatible" &&
                  ["ollama", "vllm", "litellm"].includes(endpointPreset)
                ? "Yerel uç noktada isteğe bağlı"
                : "Sağlayıcının API anahtarı"
          }
        />
      </label>
      <label>
        Başlangıç modeli (görev sırasında değiştirilebilir)
        <input
          type="text"
          value={model}
          placeholder={connectionGuide.modelExample}
          onChange={(event) => setModel(event.target.value)}
          required
        />
      </label>
      {(connectionProvider === "openai-compatible" || baseUrl) ? (
        <label>
          Temel URL
          <input
            type="url"
            aria-label="Temel URL"
            readOnly={connectionProvider === "openai-compatible" && endpointPreset === "nvidia"}
            value={baseUrl}
            placeholder={endpointPreset === "qwen" ? "Bölgenize ait Model Studio uyumlu URL" : "https://…/v1"}
            onChange={(event) => setBaseUrl(event.target.value)}
            required={connectionProvider === "openai-compatible"}
          />
        </label>
      ) : null}
      <label>
        Düşünme parametresi
        <select
          aria-label="Düşünme parametresi"
          value={reasoningProtocol}
          disabled={connectionProvider === "openai-compatible" && endpointPreset === "nvidia"}
          onChange={(event) => setReasoningProtocol(event.target.value as ReasoningProtocol)}
        >
          <option value="none">Gönderme</option>
          {connectionProvider === "openai" || connectionProvider === "openai-compatible" ? (
            <option value="openai">reasoning_effort</option>
          ) : null}
          {connectionProvider === "anthropic" ? (
            <option value="anthropic">Anthropic effort</option>
          ) : null}
          {connectionProvider === "google" ? (
            <>
              <option value="gemini-level">Gemini thinkingLevel</option>
              <option value="gemini-budget">Gemini thinkingBudget</option>
            </>
          ) : null}
        </select>
      </label>
      <label>
        Yapılandırılmış çıktı
        <select
          aria-label="Yapılandırılmış çıktı"
          disabled={connectionProvider === "openai-compatible" && endpointPreset === "nvidia"}
          value={structuredOutputMode}
          onChange={(event) => setStructuredOutputMode(event.target.value as StructuredOutputMode)}
        >
          <option value="json-schema">JSON Schema</option>
          <option value="json-object">JSON nesnesi</option>
          <option value="prompt-only">Yalnız istem sözleşmesi</option>
        </select>
      </label>
      <div className="connection-form-actions">
        <button disabled={savingConnection || Boolean(checkingConnectionId)} type="submit">
          {savingConnection
            ? "Kaydediliyor…"
            : editingConnectionId
              ? "Bağlantıyı güncelle"
              : "Yeni bağlantıyı şifrele"}
        </button>
        {editingConnectionId ? (
          <button className="secondary-button" type="button" disabled={savingConnection} onClick={cancelConnectionEdit}>
            Düzenlemeyi iptal et
          </button>
        ) : null}
      </div>
    </form>
  );

  function newChat() {
    cancelActiveWatchRef.current?.(); activeRunIdRef.current = undefined;
    setLibraryDeletionId(undefined); setPrivateConversationId(undefined);
    setRun(undefined); setError(undefined); setQuestion(""); setPromptCandidate(""); setPromptChoice("original");
    setContinuationContext(undefined); setCompactionDraft(undefined); setContinuationReviewed(false);
    setAttachments([]); setAttachmentDimensions([]); setAttachmentError(undefined);
    setSelectedMemoryEntryIds([]); setSelectedToolResultIds([]); setView("chat");
    setKnowledgePacket(null); setKnowledgeBlocked(false); setKnowledgePanelGeneration((value) => value + 1);
    window.requestAnimationFrame(() => document.getElementById("question")?.focus());
  }

  return (
    <WorkspaceShell view={view} onViewChange={setView} onNewChat={newChat} newChatDisabled={pending || loadingContinuation} attentionCount={operatorOperations.length} sidebar={<>
      <ConversationLibraryPanel refreshKey={historyRefreshKey} activeRunId={run?.runId} onOpenRun={openSavedRun}
        onReviewDeletion={(id) => { setLibraryDeletionId(id); setView("chat"); }}
        onOpenPrivate={(id) => { setPrivateConversationId(id); setView("chat"); }} />
      <RunHistoryPanel activeRunId={run?.runId} refreshKey={historyRefreshKey} onOpenRun={openSavedRun} onDeletedRun={(id) => {
        if (activeRunIdRef.current === id) { cancelActiveWatchRef.current?.(); activeRunIdRef.current = undefined; setRun(undefined); }
        setHistoryRefreshKey((value) => value + 1);
      }} />

    </>}>
      <section className="workspace workspace-view" hidden={view !== "settings"} aria-label="Ayarlar alanı">
        <PrivateOutputDefaultPanel />
        <p className="view-intro">Bağlantılarınızı, yerel araçlarınızı ve çalışma ortamınızı yönetin.</p>
        <section className="settings-card appearance-card" aria-label="Görünüm ayarları"><h2>Görünüm</h2><ThemeSelect /></section>
      <details className="settings-card">
        <summary>Yerel sağlayıcı bağlantıları ({connections.length})</summary>
        <div className="connection-guide" aria-label="Bağlantı kullanım adımları">
          <div><strong>1</strong><span>Sağlayıcıyı veya OpenRouter, LiteLLM, Ollama gibi uç noktayı bir kez kaydedin.</span></div>
          <div><strong>2</strong><span>Konsey üyesinde bu bağlantıyı seçin; görev modelini ve düşünme seviyesini istediğiniz zaman değiştirin.</span></div>
          <div><strong>3</strong><span>Kullanmadığınız bağlantılar hazırda bekler ve siz bir üyeye seçmedikçe istek göndermez.</span></div>
        </div>
        {connections.length > 0 ? (
          <div className="connection-list" aria-label="Kayıtlı sağlayıcı bağlantıları">
            {connections.map((connection) => {
              const useCount = members.filter(
                (member) => member.connectionId === connection.id,
              ).length;
              const catalog = catalogChecks[connection.id];
              return (
                <article className="connection-card" key={connection.id} aria-label={`${connection.label} sağlayıcı bağlantısı`}>
                  <div className="connection-status">
                    <div>
                      <span className={`connection-usage ${useCount > 0 ? "active" : "idle"}`}>
                        {useCount > 0 ? `Bu görevde ${useCount} üye` : "Hazırda · bu görevde kullanılmıyor"}
                      </span>
                      <strong>{connection.label}</strong>
                      <small>
                        {providerLabels[connection.provider]} · varsayılan {connection.defaultModel} · {endpointPresets[connection.endpointPreset].label}
                      </small>
                      <small>
                        {connection.baseUrl ? `${connection.baseUrl} · ` : ""}
                        düşünme protokolü: {connection.reasoningProtocol === "none" ? "kapalı" : connection.reasoningProtocol}
                      </small>
                      {catalog ? (
                        <small role="status">
                          {catalog.status === "available"
                            ? `${catalog.models.length} model kimliği listelendi${catalog.truncated ? " (liste kısmi)" : ""}. ${catalog.verification === "authenticated_catalog" ? "Kimlik doğrulamalı katalog yanıtı alındı." : "Katalog yanıtı alındı; API anahtarı doğrulanmış sayılmaz."} ${catalog.models.includes(connection.defaultModel) ? "Başlangıç modeli listede." : catalog.truncated ? "Başlangıç modeli görünen bölümde yok." : "Başlangıç modeli listede yok."}`
                            : catalog.status === "auth_failed"
                              ? "Katalog isteği kimlik/yetki hatasıyla reddedildi."
                              : catalog.status === "unsupported"
                                ? "Bu uç noktada model listeleme desteklenmiyor veya yanıt biçimi bilinmiyor."
                                : "Model listesine erişilemedi. Uç nokta, ağ ve sunucu durumunu kontrol edin."}
                        </small>
                      ) : null}
                      {catalog?.checkedAt ? (
                        <small>Katalog sorgusu: {new Date(catalog.checkedAt).toLocaleString("tr-TR")}. Bilgiler canlı üretim testi değildir.</small>
                      ) : null}
                      {catalog?.status === "available" && catalog.models.length > 0 ? (
                        <>
                          <datalist id={`connection-models-${connection.id}`}>
                            {catalog.models.map((modelId) => <option key={modelId} value={modelId} />)}
                          </datalist>
                          <label className="connection-model-picker">
                            Kontrol edilen modeller
                            <select
                              aria-label={`${connection.label} katalog modeli`}
                              disabled={savingConnection || Boolean(checkingConnectionId)}
                              value={catalog.models.includes(editingConnectionId === connection.id ? model : connection.defaultModel) ? (editingConnectionId === connection.id ? model : connection.defaultModel) : ""}
                              onChange={(event) => {
                                if (!event.target.value) return;
                                if (editingConnectionId !== connection.id) editConnection(connection);
                                setModel(event.target.value);
                              }}
                            >
                              <option value="" disabled>Başlangıç modeli seçin</option>
                              {catalog.models.map((modelId) => <option key={modelId} value={modelId}>{modelId}</option>)}
                            </select>
                          </label>
                          <small>Seçimi “Bağlantıyı güncelle” ile kaydedin. Mevcut üyelerin modelleri değişmez; listedeki kimlikler üye model alanlarında da önerilir.</small>
                        </>
                      ) : null}
                    </div>
                    <div className="connection-actions">
                      <button className="secondary-button" type="button" disabled={savingConnection || Boolean(checkingConnectionId)} onClick={() => void checkConnectionModels(connection.id)}>
                        {checkingConnectionId === connection.id ? "Kontrol ediliyor…" : "Model listesini kontrol et"}
                      </button>
                      <button className="secondary-button" type="button" disabled={savingConnection} aria-expanded={editingConnectionId === connection.id} aria-controls={`connection-editor-${connection.id}`} onClick={() => { if (editingConnectionId !== connection.id) editConnection(connection); }}>
                        Düzenle
                      </button>
                      <button
                        className="secondary-button danger-button"
                        type="button"
                        disabled={savingConnection || Boolean(checkingConnectionId)}
                        onClick={() => void removeConnection(connection.id)}
                      >
                        Bağlantıyı kaldır
                      </button>
                    </div>
                  </div>
                  {editingConnectionId === connection.id ? (
                    <section className="connection-editor" id={`connection-editor-${connection.id}`} aria-label={`${connection.label} bağlantısını düzenle`}>
                      <h3>Bağlantıyı düzenle · {connection.label}</h3>
                      {connectionForm}
                    </section>
                  ) : null}
                  <ConnectionGenerationPanel key={`${connection.id}:${connection.revision ?? 0}`} connection={connection} />
                </article>
              );
            })}
          </div>
        ) : <p className="hint">Görev çalıştırmak için önce bir sağlayıcı bağlantısı ekleyin.</p>}
        {!editingConnectionId ? connectionForm : null}
        <p className="hint">OpenAI, Claude ve Gemini yerel adaptörleri; Kimi, Qwen, vLLM, Ollama, LiteLLM, OpenRouter ve özel uç noktalar OpenAI uyumlu adaptörü kullanır. Model listesi yalnızca düğmeye basınca sorgulanır; üretim, ücretlendirme ve düşünme seviyesi desteğini doğrulamaz.</p>
      </details>

      <LocalToolsPanel
        selectedResultIds={selectedToolResultIds}
        onSelectionChange={setSelectedToolResultIds}
        retrieveRelevant={retrieveToolContext}
        onRetrieveRelevantChange={setRetrieveToolContext}
      />

      {operatorOperations.length > 0 ? (
        <section className="operator-card" aria-label="Operatör kararı bekleyen işlemler">
          <div className="operator-heading">
            <div>
              <span>OPERATÖR KARARI</span>
              <strong>{operatorOperations.length} belirsiz sağlayıcı işlemi</strong>
            </div>
            <button className="secondary-button" type="button" onClick={() => void refreshOperatorOperations()}>
              Yenile
            </button>
          </div>
          <p>
            Sağlayıcının isteği tamamlayıp tamamlamadığı bilinmiyor. Yeni deneme aynı isteğin
            ikinci kez ücretlenmesine veya yinelenmesine yol açabilir; sistem otomatik karar vermez.
          </p>
          <div className="operator-list">
            {operatorOperations.map((operation) => (
              <article key={operation.id}>
                <div>
                  <strong>{operation.memberId}</strong>
                  <small>{operation.provider} · {operation.model} · tur {operation.round} · deneme {operation.attempt}</small>
                  <small>Çalışma {operation.runId.slice(0, 8)} · {operation.errorCode ?? "sonuç bilinmiyor"}</small>
                </div>
                <div className="operator-actions">
                  <button
                    className="secondary-button danger-button"
                    type="button"
                    disabled={resolvingOperationId === operation.id}
                    onClick={() => void resolveOperation(operation, "discard")}
                  >
                    Başarısız say ve kapat
                  </button>
                  <button
                    type="button"
                    disabled={resolvingOperationId === operation.id}
                    onClick={() => void resolveOperation(operation, "authorize_retry")}
                  >
                    Yeni denemeye izin ver
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

        <LocalDiagnosticsPanel />
      </section>
      <section className="workspace workspace-view" hidden={view !== "schedules"} aria-label="Zamanlayıcı alanı">
        <p className="view-intro">Sohbette hazırladığınız soru ve konsey ile tekrar eden çalışmalar oluşturun.</p>
        <div className="schedule-draft-summary"><strong>Zamanlanacak soru</strong><p>{question || "Önce Sohbet bölümünde bir soru yazın."}</p><button type="button" className="secondary-button" onClick={() => setView("chat")}>Soruyu ve konseyi düzenle</button></div>
      <LocalSchedulesPanel onOpenRun={openSavedRun}
        creationBlockedReason={knowledgePacket || knowledgeBlocked ? "Kaynak paketli çalışmalar henüz zamanlanamaz. Kaynak paketini açıkça kaldırın." : continuationSource ? "Geçmiş rapor içeren devam çalışmaları henüz zamanlanamaz. Önce geçmiş bağlamı kaldırın." : undefined}
        question={question}
        members={members}
        reviewRounds={reviewRounds}
        selfRevisionEnabled={selfRevisionEnabled && reviewRounds > 0}
        riskProfile={effectiveRiskProfile}
        {...(executionLimits ? { executionLimits } : {})}
      />

      </section>
      <section className="workspace workspace-view" hidden={view !== "chat"} aria-label="Konsey çalışma alanı">
        <p className="view-intro">Sorunuzu yazın. Konsey farklı bakış açılarını, itirazları ve dayanakları birlikte görünür kılsın.</p>
        {!connections.length ? <div className="connection-onboarding">Başlamak için bir sağlayıcı bağlantısı ekleyin.<button type="button" className="secondary-button" onClick={() => setView("settings")}>Bağlantıları ayarla</button></div> : null}
      <details ref={configRef} className="settings-card council-config" role="region" aria-label="Konsey yapılandırması"><summary>Konsey yapılandırması <span>{members.length} üye · {reviewRounds} inceleme turu</span></summary>
        <div className="config-heading">
          <div>
            <strong>Konsey yapılandırması</strong>
            <small>Her çalışma 2–6 bağımsız üyenin değişmez snapshot’ını saklar.</small>
          </div>
          <label>
            Üye sayısı
            <select
              aria-label="Üye sayısı"
              value={members.length}
              onChange={(event) => selectMemberCount(Number(event.target.value))}
            >
              {[2, 3, 4, 5, 6].map((count) => <option key={count} value={count}>{count}</option>)}
            </select>
          </label>
        </div>
        <div className="risk-profile-control">
          <label>Değerlendirme profili
            <select aria-label="Değerlendirme profili" value={selectedRiskProfile} onChange={(event) => selectRiskProfile(event.target.value as RiskProfile)}>
              <option value="standard">Otomatik (en az standart)</option>
              <option value="high">Yüksek risk</option>
            </select>
          </label>
          <small>Risk düzeyini yükseltebilirsiniz. Soru ve gönderilecek bağlamdaki belirgin risk işaretleri yüksek risk kontrollerini zorunlu tutar; tamamlanmaları doğruluk veya uzman onayı anlamına gelmez.</small>
        </div>
        <div className={`red-team-setup ${hasRedTeam ? "active" : ""}`}>
          <div>
            <strong>Red-team karşılaştırması</strong>
            <small>
              Ayrı bir üye analistlerin varsayımlarını, karşı örnekleri ve geri dönüşü olmayan riskleri
              sınar. Sonuçları analist zeminiyle yan yana gösterilir; oy veya doğruluk kararı sayılmaz.
            </small>
          </div>
          <label>
            <input
              type="checkbox"
              aria-label="Red-team karşılaştırmasını etkinleştir"
              checked={hasRedTeam}
              disabled={effectiveRiskProfile === "high" && hasRedTeam}
              onChange={(event) => setRedTeamComparison(event.target.checked)}
            />
            {hasRedTeam ? "Etkin" : "Ekle"}
          </label>
        </div>
        <div className="member-editor-grid" aria-label="Konsey üye editörü">
          {members.map((member, index) => {
            const selectedConnection = connections.find(
              (connection) => connection.id === member.connectionId,
            );
            const selectedCatalog = selectedConnection ? catalogChecks[selectedConnection.id] : undefined;
            const selectedModelDetail = selectedCatalog?.details?.find((item) => item.id === member.model);
            const managedWebSearchAvailable = supportsManagedWebSearch(selectedConnection);
            return (
              <article className="member-editor" key={member.id}>
              <div className="member-editor-heading">
                <strong>Üye {index + 1}</strong>
                <span className={member.councilRole === "red-team" ? "red-team-badge" : ""}>
                  {councilRoleLabels[member.councilRole]} · {member.provider === "fake" ? "Eski şablon" : providerLabels[member.provider]}
                </span>
              </div>
              <label>
                Görünen ad
                <input
                  aria-label={`Üye ${index + 1} adı`}
                  value={member.label}
                  maxLength={80}
                  onChange={(event) => updateMember(index, { label: event.target.value })}
                  required
                />
              </label>
              <label>
                Rol
                <input
                  aria-label={`Üye ${index + 1} rolü`}
                  value={member.role}
                  maxLength={240}
                  onChange={(event) => updateMember(index, { role: event.target.value })}
                  required
                />
              </label>
              <label>
                Konsey görevi
                <select
                  aria-label={`Üye ${index + 1} konsey görevi`}
                  value={member.councilRole}
                  onChange={(event) =>
                    updateMember(index, { councilRole: event.target.value as CouncilRole })
                  }
                >
                  <option value="analyst">Analist</option>
                  <option value="red-team">Red-team</option>
                </select>
              </label>
              <>
                  <label>
                    Bağlantı
                    <select
                      aria-label={`Üye ${index + 1} bağlantısı`}
                      value={member.connectionId ?? ""}
                      onChange={(event) => {
                        const connection = connections.find((item) => item.id === event.target.value);
                        if (connection) {
                          updateMember(index, {
                            provider: connection.provider,
                            connectionId: connection.id,
                            model: connection.defaultModel,
                            reasoningLevel: "default",
                            webSearchMode: "off",
                          });
                        }
                      }}
                    >
                      {connections.map((connection) => (
                        <option key={connection.id} value={connection.id}>
                          {connection.label} · {providerLabels[connection.provider]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Bu görevde model kimliği
                    <input
                      aria-label={`Üye ${index + 1} modeli`}
                      list={selectedConnection && catalogChecks[selectedConnection.id]?.status === "available" ? `connection-models-${selectedConnection.id}` : undefined}
                      value={member.model}
                      maxLength={120}
                      onChange={(event) => {
                        const nextModel = event.target.value;
                        updateMember(index, {
                          model: nextModel,
                          ...(nextModel === "gpt-5-pro" && member.reasoningLevel === "max"
                            ? { reasoningLevel: "high" as const }
                            : {}),
                        });
                      }}
                      required
                    />
                    <small>
                      Bağlantının başlangıç modelini değiştirmez. Bu üyeye ve bu görev snapshot’ına uygulanır.
                    </small>
                    {selectedModelDetail ? (
                      <small>Katalog bildirimi · {catalogMetadataText(selectedModelDetail)}</small>
                    ) : selectedCatalog?.status === "available" && !selectedCatalog.models.includes(member.model) ? (
                      <small>{selectedCatalog.truncated ? "Bu model görünen katalog bölümünde yok." : "Bu model katalog listesinde yok."} Model kimliğini yine elle girebilirsiniz.</small>
                    ) : null}
                  </label>
                  <label>
                    Düşünme seviyesi
                    <select
                      aria-label={`Üye ${index + 1} düşünme seviyesi`}
                      value={member.reasoningLevel}
                      disabled={
                        connections.find((connection) => connection.id === member.connectionId)
                          ?.reasoningProtocol === "none"
                      }
                      onChange={(event) =>
                        updateMember(index, { reasoningLevel: event.target.value as ReasoningLevel })
                      }
                    >
                      {Object.entries(reasoningLabels).map(([value, label]) => (
                        <option
                          key={value}
                          value={value}
                          disabled={member.model === "gpt-5-pro" && value === "max"}
                        >
                          {label}
                        </option>
                      ))}
                    </select>
                    <small>
                      {member.model === "gpt-5-pro"
                        ? "GPT-5 Pro yalnızca yüksek düşünme seviyesini kabul eder; “maksimum” bu model için geçerli değildir."
                        : "Seçim her görevde değiştirilebilir. “Maksimum” yalnızca seçtiğiniz model ve uç nokta destekliyorsa gönderilir."}
                    </small>
                  </label>
                  <label>
                    Modelin web erişimi
                    <select
                      aria-label={`Üye ${index + 1} web erişimi`}
                      value={member.webSearchMode}
                      disabled={!managedWebSearchAvailable}
                      onChange={(event) =>
                        updateMember(index, { webSearchMode: event.target.value as WebSearchMode })
                      }
                    >
                      {Object.entries(webSearchModeLabels).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                    <small>
                      {managedWebSearchAvailable
                        ? "Açıldığında sağlayıcının kendi web aracını isteğe ekler; model yalnızca gerekli görürse kullanır."
                        : selectedConnection?.endpointPreset === "litellm"
                          ? "LiteLLM’de web arama, proxy’deki model yönlendirmesine göre değişir. Bu sürüm bağlantıyı destekler; evrensel olmayan web aracını otomatik eklemez."
                          : "Bu uç nokta için güvenilir, ortak bir web aracı sözleşmesi bulunmuyor."}
                    </small>
                  </label>
                  <label className="attachment-member-control">
                    Görev ekleri
                    <span className="check-row">
                      <input
                        type="checkbox"
                        aria-label={`Üye ${index + 1} görev eklerini alsın`}
                        checked={member.receiveAttachments === true}
                        onChange={(event) => updateMember(index, { receiveAttachments: event.target.checked })}
                      />
                      Bu üyeye gönder
                    </span>
                    <small>PDF metni tüm metin modellerine gider; görseller için modelin görsel girdi desteği gerekir. Seçimi bu görevde değiştirebilirsiniz.</small>
                  </label>
              </>
            </article>
            );
          })}
        </div>
        {!memberConfigurationValid ? (
          <p className="inline-warning">
            {!hasAnalyst
              ? "Konseyde en az bir analist üye bulunmalı."
              : "Tüm üyeler için ad, rol, model ve geçerli bağlantı seçimi gerekli."}
          </p>
        ) : null}
          <div className="form-options">
            <strong className="run-mode">{members.length} üye · Kayıtlı sağlayıcı bağlantıları</strong>
            <label>Çapraz inceleme turu
              <select value={reviewRounds} onChange={(event) => setReviewRounds(Number(event.target.value) as ReviewRoundCount)}>
                <option value={0} disabled={effectiveRiskProfile === "high"}>0 · İnceleme yok</option>
                <option value={1}>1 · Varsayılan</option>
                <option value={2}>2 · Ek inceleme</option>
                <option value={3}>3 · Üst sınır</option>
              </select>
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={selfRevisionEnabled && reviewRounds > 0} disabled={reviewRounds === 0} onChange={(event) => setSelfRevisionEnabled(event.target.checked)} />
              Üyelerin kendi ilk iddiaları için düzeltme önerisi üretmesine izin ver
            </label>
            {selfRevisionEnabled && reviewRounds > 0 ? <small>İlk yanıtlar korunur; öneriler otomatik olarak doğru kabul edilmez. Ek bağlam ve çıktı tokenları oluşabilir.</small> : null}
          </div>
        <div className="template-controls">
          <input
            aria-label="Şablon adı"
            value={templateName}
            maxLength={80}
            placeholder="Şablon adı"
            onChange={(event) => setTemplateName(event.target.value)}
          />
          <button type="button" disabled={savingTemplate || deletingTemplateBusy || !templateName.trim() || !memberConfigurationValid} onClick={saveTemplate}>
            {savingTemplate ? "Kaydediliyor…" : "Şablonu kaydet"}
          </button>
        </div>
        {templates.some((template) => template.members.every((member) => member.provider !== "fake")) ? (
          <div className="template-list">
            {templates.filter((template) => template.members.every((member) => member.provider !== "fake")).map((template) => (
              <div key={template.id}>
                <button
                  className="template-button"
                  type="button"
                  disabled={deletingTemplateBusy}
                  onClick={() => {
                    setMembers(template.members);
                  }}
                >
                  {template.name} <small>{template.memberCount} üye</small>
                </button>
                <button className="secondary-button" type="button" disabled={savingTemplate || deletingTemplateBusy} aria-label={`${template.name} şablonunu silmeyi incele`} onClick={() => setDeletingTemplateId(template.id)}>Silmeyi incele</button>
                {deletingTemplateId === template.id && <CouncilTemplateDeletionPanel key={template.id} templateId={template.id}
                  onCancel={() => setDeletingTemplateId(undefined)} onDeleted={onTemplateDeleted} onBusy={setDeletingTemplateBusy} />}
              </div>
            ))}
          </div>
        ) : <p className="hint">Henüz kayıtlı yerel şablon yok.</p>}
      </details>

      <form className="question-card" onSubmit={submit}>
        {compactionDraft ? <ContinuationCompactionEditor packet={compactionDraft.packet} summary={compactionDraft.summary}
          reviewed={continuationReviewed} disabled={pending || loadingContinuation}
          onSummaryChange={(summary) => { setCompactionDraft((current) => current ? { ...current, summary } : undefined); setContinuationReviewed(false); }}
          onReviewedChange={setContinuationReviewed} onRemove={() => { setCompactionDraft(undefined); setContinuationReviewed(false); }} /> : null}
        {continuationContext ? <section aria-label="Yeni çalışmanın geçmiş bağlamı">
          <h3>Önceki rapordan devam</h3>
          <p>Kaynak çalışma: {continuationContext.sourceRunId}. Kaynak soru, raporun tamamı ve varsa önceki devam bağlamı bütün üyelere gönderilir. Eski ekler, bellek, araç girdileri ve kaynak paketi ayrıca gönderilmez. Kaynak alıntılarını yeniden göndermek için Yerel bilgi kaynakları bölümünde yeni paketi hazırlayıp inceleyin. Yeni soru için tüm üyeler yeni yanıt verir; geçmiş uzlaşı doğruluk onayı değildir.</p>
          <details><summary>Gönderilecek geçmiş bağlamın tamamını incele</summary><pre>{continuationContext.content}</pre></details>
          <label><input type="checkbox" checked={continuationReviewed} onChange={(event) => setContinuationReviewed(event.target.checked)} />Geçmiş bağlamı inceledim; yeni soruma dahil et</label>
          <button type="button" className="secondary-button" disabled={pending || loadingContinuation} onClick={() => { setContinuationContext(undefined); setContinuationReviewed(false); }}>Geçmiş bağlamı kaldır</button>
          <p className="hint">Kaynak rapor değişirse yeniden seçin. 256 KiB üzerindeki geçmiş otomatik kısaltılmaz. Token tahmini geçmiş metni her üye için içerir; yeni çalışma kendi gönderim rezervasyonunu tutar.</p>
        </section> : null}
        <label htmlFor="question">Sorunuz</label>
        <textarea
          id="question"
          value={question}
          minLength={10}
          maxLength={4000}
          onChange={(event) => {
            setQuestion(event.target.value);
            setPromptCandidate(suggestStructuredQuestion(event.target.value));
            setPromptChoice("original");
          }}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.currentTarget.form?.requestSubmit();
            }
          }}
          required
        />
        <div className="form-row">
          <div className="composer-council-summary"><strong>{members.length} üye · {reviewRounds} inceleme turu</strong><button type="button" className="secondary-button" onClick={() => { if (configRef.current) { configRef.current.open = true; configRef.current.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); } }}>Konseyi düzenle</button></div>
          <button disabled={knowledgeBlocked || pending || loadingContinuation || (Boolean(continuationSource) && !continuationReviewed) || preparingAttachments || Boolean(limitsError) || selectedQuestion.length < 10 || (!needsContext && promptChoice === "candidate" && !revisionAudit.canSelectCandidate) || !memberConfigurationValid || !highRiskReady || (attachments.length > 0 && !members.some((member) => member.receiveAttachments === true)) || tokenPreview?.key !== previewRequestKey || !tokenPreview.value.promptPlan || !tokenPreview.value.riskPreflight || Boolean(currentPreviewError)} type="submit">
            {pending ? "Değerlendiriliyor…" : (tokenPreview?.key === previewRequestKey && (tokenPreview.value.missingContextQuestions?.length ?? 0) > 0) ? "Açıklama sorularını aç" : "Konseyi çalıştır"}
          </button>
        </div>
        {!highRiskReady ? <p className="inline-warning">Yüksek risk profili için en az bir red-team üyesi ve bir çapraz inceleme turu seçin.</p> : null}
        <p className="hint">Ctrl/⌘ + Enter ile gönderin. Seçili modellere gerçek API isteği yapılır.</p>
        {originalQuestion.length >= 10 ? <details className="composer-disclosure"><summary>İstemi düzenle ve karşılaştır</summary><PromptRevisionEditor originalQuestion={originalQuestion} candidateQuestion={promptCandidate}
          choice={promptChoice} disabled={needsContext} onCandidateChange={setPromptCandidate} onChoiceChange={setPromptChoice} /></details> : null}
        {needsContext ? <p className="hint">Önce eksik bilgi sorularını yanıtlayın; istem sürümü seçimi bu yanıttan sonra açılır.</p> : null}
        <KnowledgePanel key={knowledgePanelGeneration} runId={run?.runId} onChange={(reference, blocked) => { setKnowledgePacket(reference); setKnowledgeBlocked(blocked); }} />
        {knowledgeBlocked && <p role="status">Kaynak paketini inceleyin veya açıkça paketsiz devam etmeyi seçin.</p>}
        <details className="attachment-picker composer-disclosure"><summary>Dosya ekle{attachments.length > 0 ? ` · ${attachments.length} ek` : ""}</summary>
        <p>Büyük (1 MiB üzeri PDF) veya tekrar kullanılan TXT/Markdown/PDF/PNG/JPEG dosyalarını Yerel bilgi kaynakları bölümüne kaydedin. Kaynak paketi seçiliyken aynı kütüphane dosyasını ayrıca tam ek olarak göndermeyin.</p>
          <label htmlFor="task-attachments">Görev ekleri (isteğe bağlı)</label>
          <input
            id="task-attachments"
            ref={attachmentInputRef}
            hidden
            type="file"
            accept="application/pdf,.pdf,image/jpeg,image/png,image/webp,image/gif"
            multiple
            disabled={pending || preparingAttachments}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              void selectAttachments(files);
            }}
          />
          <button type="button" className="secondary-button attachment-select-button"
            disabled={pending || preparingAttachments} onClick={() => attachmentInputRef.current?.click()}>
            {preparingAttachments ? "Dosyalar hazırlanıyor…" : "＋ Dosya seç"}
          </button>
          <small>
            En fazla 6 dosya; görsel başına 2 MiB, PDF başına 5 MiB, toplam 12 MiB. PDF’nin seçilebilir metni çıkarılır; taranmış PDF için OCR henüz yok. Ekler şifreli saklanır ve yalnızca “Bu üyeye gönder” seçili modellere iletilir.
          </small>
          {attachmentError ? <p className="inline-warning" role="alert">{attachmentError}</p> : null}
          {attachments.length > 0 ? (
            <div className="attachment-list">
              {attachments.map((attachment, index) => (
                <span key={`${attachment.sha256}-${index}`}>
                  {attachment.mimeType === "application/pdf" ? "PDF · " : "Görsel · "}{attachment.name}
                  <button type="button" className="icon-button" aria-label={`${attachment.name} ekini kaldır`} onClick={() => {
                    setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index));
                    setAttachmentDimensions((current) => current.filter((item) => item.sha256 !== attachment.sha256));
                    setAttachmentError(undefined);
                  }}>×</button>
                </span>
              ))}
              <button type="button" className="secondary-button" onClick={() => { setAttachments([]); setAttachmentDimensions([]); setAttachmentError(undefined); }}>Ekleri kaldır</button>
            </div>
          ) : null}
          {attachments.length > 0 && !members.some((member) => member.receiveAttachments === true) ? (
            <p className="inline-warning">Ekler seçildi, fakat hiçbir üye için “Bu üyeye gönder” açık değil.</p>
          ) : null}
        </details>
        <details className="token-preview composer-disclosure"><summary>Gönderilecek bağlam ve token tahmini{selectedMemoryEntryIds.length + selectedToolResultIds.length > 0 ? ` · ${selectedMemoryEntryIds.length + selectedToolResultIds.length} seçili bağlam` : ""}</summary>
          {!question.trim() && attachments.length === 0 ? (
            <><strong>Sorunuz ve ekleriniz: 0 token</strong><p className="hint">Soru alanı boş; henüz gönderilecek bir görev yok.</p></>
          ) : !memberConfigurationValid ? (
            <p className="hint">Token tahmini için önce geçerli sağlayıcı bağlantılarını ve modelleri seçin.</p>
          ) : currentPreviewError ? null : tokenPreview?.key === previewRequestKey ? (
            <>
              <strong>Sorunuz ve ekleriniz: ≈{(tokenPreview.value.questionTokens + tokenPreview.value.documentTokens + tokenPreview.value.imageTokens).toLocaleString("tr-TR")} token</strong>
              <p className="hint">Soru ≈{tokenPreview.value.questionTokens.toLocaleString("tr-TR")}{tokenPreview.value.documentTokens > 0 ? ` · PDF metni ≈${tokenPreview.value.documentTokens.toLocaleString("tr-TR")}` : ""}{tokenPreview.value.imageTokens > 0 ? ` · Seçili üyelere gönderilecek görseller ≈${tokenPreview.value.imageTokens.toLocaleString("tr-TR")}` : ""}</p>
              {question.trim().length >= 10 ? <>
                <p><strong>Konseyin ilk turu ≈{tokenPreview.value.totalTokens.toLocaleString("tr-TR")} giriş tokenı</strong> ({tokenPreview.value.members.length} üye, sistem yönergeleri ve seçili bağlam dahil).</p>
                {tokenPreview.value.contextEntryCount > 0 ? <p className="hint">{tokenPreview.value.contextEntryCount} bağlam kaydı hesaba katıldı.</p> : null}
                <details><summary>Üyelere göre tahmin</summary><ul>{tokenPreview.value.members.map((member) => <li key={member.id}>{member.label} ({member.model}): ≈{member.totalTokens.toLocaleString("tr-TR")}{member.documentTokens > 0 ? ` (PDF metni ≈${member.documentTokens.toLocaleString("tr-TR")})` : ""}{member.imageTokens > 0 ? ` (görsel ≈${member.imageTokens.toLocaleString("tr-TR")})` : ""}</li>)}</ul></details>
                {tokenPreview.value.promptPlan ? <details className="prompt-plan-preview"><summary>Üyelere gönderilecek metni incele · {tokenPreview.value.promptPlan.version}</summary>
                  <p className="hint">Bu, ilk turdaki sistem yönergesi ve kullanıcı metnidir. Görseller ayrı içerik olarak gönderilir; sonraki çapraz inceleme turu ve sağlayıcının kendi çerçevesi burada gösterilmez. Otomatik istem iyileştirmesi yapılmadı.</p>
                  {tokenPreview.value.promptPlan.members.map((prompt) => <article key={prompt.id}>
                    <strong>{prompt.label} · {prompt.model}</strong>
                    <small>{prompt.documentCount} PDF · {prompt.imageCount} görsel</small>
                    <label>Sistem yönergesi<pre>{prompt.instructions}</pre></label>
                    <label>Gönderilecek kullanıcı metni<pre>{prompt.userInput}</pre></label>
                  </article>)}
                </details> : null}
              </> : null}
              <p className="hint">Yerel tahmindir; PDF metni her seçili üyeye ayrı gönderilir, bu nedenle konsey toplamında tekrar sayılır. Sağlayıcının gerçek sayımı farklı olabilir. Düşünme, yanıt ve {reviewRounds > 0 ? "seçilen çapraz inceleme" : "sonraki"} turlarının tokenları bu toplamda yoktur. Ek inceleme turları ek sağlayıcı çağrıları ve maliyet oluşturabilir. Tahmin için modele istek gönderilmez.</p>
            </>
          ) : <p className="hint">{compactionDraft && !continuationReviewed ? "Özeti yazıp atlanan bilgileri inceleyin; ardından gönderilecek metin ve token tahmini hazırlanır." : "Token tahmini hesaplanıyor…"}</p>}
        </details>
        {currentPreviewError ? <p className="inline-warning" role="alert">{currentPreviewError}</p> : null}
        {!memberConfigurationValid && connections.length > 0 ? <p className="inline-warning">Konseydeki bağlantı veya model seçimlerini kontrol edin. “Konseyi düzenle” ile ayrıntıları açabilirsiniz.</p> : null}
        {currentRisk ? <>
          {effectiveRiskProfile === "high" ? <RiskAssessmentSummary assessment={currentRisk.assessment} /> : <details className="composer-disclosure"><summary>Risk denetimi · Standart profil</summary><RiskAssessmentSummary assessment={currentRisk.assessment} /></details>}
          {!highRiskReady ? <>
            <button type="button" className="secondary-button" onClick={() => { setReviewRounds((current) => current === 0 ? 1 : current); setRedTeamComparison(true); }}>Gerekli risk kontrollerini ekle</button>
            <p className="hint">Red-team yoksa son üyenin bağlantısıyla eklenir; altı üyede son üyenin görevi değiştirilir. Göndermeden önce bağlantısını ve modelini düzenleyebilirsiniz.</p>
          </> : null}
        </> : null}
        {tokenPreview?.key === previewRequestKey && (tokenPreview.value.missingContextQuestions?.length ?? 0) > 0 ?
          <div className="inline-warning">Bu soruda kritik bağlam eksik olabilir. Devam ettiğinizde açıklama soruları açılır; siz incelemeden model çağrısı başlamaz.</div> : null}
        <details className="composer-disclosure"><summary>Çalışma sınırları{executionLimitsEnabled ? " · Etkin" : " · Kapalı"}</summary><ExecutionLimitsEditor enabled={executionLimitsEnabled} limits={configuredExecutionLimits} plannedProviderCalls={plannedProviderCalls} onEnabledChange={setExecutionLimitsEnabled} onChange={setConfiguredExecutionLimits} /></details>
      </form>

      <details className="settings-card memory-card context-disclosure" role="region" aria-label="Ortak konuşma belleği"><summary>Konuşma belleği · {selectedMemoryEntryIds.length} seçili kayıt</summary>
        <div className="memory-heading">
          <div>
            <strong>Ortak konuşma belleği</strong>
            <small>{memoryEntries.length}/20 kayıt · bu çalışma için {selectedMemoryEntryIds.length}/5 seçili</small>
          </div>
        </div>
        <p className="hint">
          Yalnızca seçtiğiniz kayıtlar sonraki çalışmanın donmuş girdisine eklenir. Bunlar geçmiş
          model iddialarıdır; doğrulanmış gerçek veya talimat sayılmaz.
        </p>
        {memoryEntries.length > 0 ? (
          <div className="memory-list">
            {memoryEntries.map((entry) => (
              <article className="memory-entry" key={entry.id} data-memory-id={entry.id}>
                <label>
                  <input
                    type="checkbox"
                    aria-label={`${entry.content} sonraki çalışmada kullan`}
                    checked={selectedMemoryEntryIds.includes(entry.id)}
                    onChange={(event) => toggleMemoryEntry(entry.id, event.target.checked)}
                  />
                  <span>
                    <strong>{entry.content}</strong>
                    <small>
                      {entry.sourceType === "red-team-challenge" ? "Red-team" : "Analist iddiası"}
                      {" · "}{evidenceStateLabels[entry.evidenceState]}
                    </small>
                  </span>
                </label>
                <button
                  className="secondary-button danger-button"
                  type="button"
                  onClick={() => void removeMemoryEntry(entry.id)}
                >
                  Bellekten kaldır
                </button>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty">Henüz açıkça belleğe alınmış iddia yok.</p>
        )}
      </details>

      {libraryDeletionId && <ConversationDeletionPanel key={libraryDeletionId} conversationId={libraryDeletionId} onCancel={() => setLibraryDeletionId(undefined)}
        onDeletedRun={(id) => {
          if (activeRunIdRef.current === id) { cancelActiveWatchRef.current?.(); activeRunIdRef.current = undefined; setRun(undefined); }
          setHistoryRefreshKey((value) => value + 1);
        }} onDeleted={() => { setLibraryDeletionId(undefined); setHistoryRefreshKey((value) => value + 1); }} />}
      {privateConversationId && <PrivateBranchesPanel key={privateConversationId} conversationId={privateConversationId} onClose={() => setPrivateConversationId(undefined)} />}
      <PreflightDraftsPanel refreshKey={draftRefreshKey} focusDraftId={focusDraftId} onStarted={(created) => {
        cancelActiveWatchRef.current?.();
        activeRunIdRef.current = created.runId;
        setRun(created);
        setHistoryRefreshKey((value) => value + 1);
        if (!terminalStatuses.has(created.status)) void watchRun(created.runId).catch((reason: unknown) => {
          setError(reason instanceof Error ? reason.message : "Çalışma takibi başlatılamadı.");
        });
      }} />

      {error ? <div className="alert error" role="alert">{error}</div> : null}

      {run ? (
        <div className="result-stack" id="council-result" aria-live="polite">
          <RunBranchesPanel key={`${run.runId}:${historyRefreshKey}`} runId={run.runId} refreshKey={historyRefreshKey} onOpenRun={openSavedRun} />
          <ConversationPanel key={`conversation:${run.runId}:${historyRefreshKey}`} runId={run.runId} onOpenRun={openSavedRun} />
          <div className={`status-card ${run.status}`}>
            <div className="status-row">
              <span>{statusLabel}</span>
              {!terminalStatuses.has(run.status) ? (
                <button className="secondary-button" type="button" onClick={cancel}>İptal et</button>
              ) : null}
              {report ? (
                <button className="secondary-button" type="button" disabled={exportingRun} onClick={() => void exportRun()}>
                  {exportingRun ? "Hazırlanıyor…" : "Raporu indir (JSON)"}
                </button>
              ) : null}
              {report && ["completed", "partially_completed"].includes(run.status) ? <button type="button" className="secondary-button" disabled={pending || loadingContinuation} onClick={() => void selectContinuation()}>{loadingContinuation ? "Bağlam hazırlanıyor…" : "Bu rapordan yeni soruyla devam et"}</button> : null}
              {report && ["completed", "partially_completed"].includes(run.status) ? <button type="button" className="secondary-button" disabled={pending || loadingContinuation} onClick={() => void selectContinuation("compaction")}>Geçmişi kısaltarak yeni soruyla devam et</button> : null}
            </div>
            {report ? <small>İndirilen dosya şifresizdir; soru, rapor ve ham model yanıtlarını içerir. API anahtarları ve ek dosyalarının ham içerikleri dahil değildir.</small> : null}
            <small>
              {report?.qualityNotice ??
                (run.status === "cancelled"
                  ? "İptalden sonra yeni aşama başlatılmaz."
                  : "Kalıcı iş kaydı worker tarafından işleniyor.")}
            </small>
            <small>Değerlendirme profili: {run.riskProfile === "high" ? "Yüksek risk" : "Standart"}.</small>
            {run.riskAssessment ? <details><summary>Kaydedilen risk değerlendirmesi</summary><RiskAssessmentSummary assessment={run.riskAssessment} /></details> : <small>Bu eski çalışmada otomatik risk değerlendirmesi kaydı yok.</small>}
            <small>Çalışma sorusu: {run.question}</small>
            {run.continuationContext ? <details><summary>Bu çalışmaya gönderilen geçmiş bağlam · {run.continuationContext.sourceRunId}</summary><p>Başlangıçta donduruldu; kaynak rapordaki sonraki değişikliklerden etkilenmez. JSON rapor indirmesi bu metni de içerir.</p><pre>{run.continuationContext.content}</pre></details> : null}
            {run.continuationArchive ? <ContinuationArchiveDetails archive={run.continuationArchive} /> : null}
            {run.knowledgePacket ? <details><summary>Bu çalışmaya gönderilen kaynak alıntıları</summary><p>Başlangıçta donduruldu; güncel erişim izni veya içerik doğrulaması değildir. Yeni soruda otomatik gönderilmez.</p><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(run.knowledgePacket, null, 2)}</pre></details> : null}
            <small>İlk tur istem sürümü: {run.promptVersion}.</small>
            {run.followUp ? <small>Takip çalışması: {run.followUp.sourceRunId} kaydındaki {run.followUp.reusedMemberIds.length} ilk yanıt korundu; yalnız {run.followUp.rerunMemberId} ilk turda yeniden istendi. Çapraz incelemeler yeni birleşimle tekrar yapıldı veya yapılacak. Bu, doğrulanmış nihai sentez değildir.</small> : null}
            {run.executionLimits ? <small>Kaydedilen gönderim sınırları: en fazla {run.executionLimits.maxProviderCalls} API çağrısı · çağrı başına {run.executionLimits.maxOutputTokensPerCall.toLocaleString("tr-TR")} yanıt tokenı kotası · toplam {run.executionLimits.maxReservedOutputTokens.toLocaleString("tr-TR")} yanıt tokenı rezervasyonu. {run.followUp ? "Kaynak çalışmanın sınırları devralındı; bu takip çalışması kendi rezervasyonunu tutar." : "Bu çalışmanın sınırları görev formundaki sonraki değişikliklerden etkilenmez."}</small> : null}
            {report?.riskControls ? <small>Yüksek risk kontrolleri: red-team {report.riskControls.redTeamCompleted ? "tamamlandı" : "eksik"}; çapraz inceleme {report.riskControls.crossReviewCompleted ? "tamamlandı" : "eksik"}; iddia aktarımı {report.riskControls.claimTransferComplete ? "tamamlandı" : "eksik"}. {report.riskControls.complete ? "Kontroller tamamlandı; doğruluk onayı değildir." : "Tam değerlendirme tamamlanmadı."}</small> : null}
            {report?.reportQuality ? (
              <div className={`report-quality ${report.reportQuality.mechanicalIntegrity ? "" : "incomplete"}`} aria-label="Rapor kalite değerlendirmesi">
                <strong>{report.reportQuality.mechanicalIntegrity ? "Mekanik iddia dökümü" : "İddia aktarımını inceleyin"}</strong>
                <small>Çalışmanın tamamlanması yanıtın doğrulandığı anlamına gelmez. Anlamsal doğrulama yapılmadı; bu döküm nihai karar veya doğruluk onayı değildir.</small>
                {!report.reportQuality.mechanicalIntegrity ? <small>Kaynak iddia ve alıntı kayıtlarında eksik veya tutarsız aktarım var. Ham üye yanıtlarıyla karşılaştırın.</small> : null}
                {report.reportQuality.reasons.includes("partial_execution") ? <small>Bazı üye veya inceleme adımları tamamlanmadı; rapor kısmi.</small> : null}
                {report.reportQuality.reasons.includes("extraction_coverage_incomplete") ? <small>Geçersiz model çıktısındaki iddiaların tamamı yapılandırılmış döküme aktarılamamış olabilir; ham yanıtı inceleyin.</small> : null}
                {report.reportQuality.reasons.includes("risk_controls_incomplete") ? <small>Yüksek risk kontrolleri tamamlanmadı.</small> : null}
                {report.reportQuality.includedWithoutVerifiedEvidenceClaimIds.length > 0 ? <small>Senteze dahil görünen {report.reportQuality.includedWithoutVerifiedEvidenceClaimIds.length} iddianın güncel, incelenmiş dış kaynak desteği işaretli değil.</small> : null}
                {report.reportQuality.unresolvedClaimIds.length > 0 ? <small>{report.reportQuality.unresolvedClaimIds.length} iddia çözümsüz; ilgili iddia defterinde görünür.</small> : null}
                {report.reportQuality.omittedClaimIds.length > 0 ? <small>{report.reportQuality.omittedClaimIds.length} iddia sentez dışında; ilgili iddia defterinde görünür.</small> : null}
                {report.reportQuality.adverseEvidenceClaimIds.length > 0 ? <small>{report.reportQuality.adverseEvidenceClaimIds.length} iddia çelişkili veya eski kanıt durumunda.</small> : null}
                {report.reportQuality.reasons.includes("disputed_included") ? <small>İtirazlı sınıflandırılan en az bir iddia senteze dahil işaretli; kapsamını gözden geçirin.</small> : null}
              </div>
            ) : null}
            {run.memoryEntryCount > 0 ? (
              <small>Bu çalışma kullanıcı tarafından seçilen {run.memoryEntryCount} bellek kaydını kullandı.</small>
            ) : null}
          </div>

          <RunUsagePanel runId={run.runId} runStatus={run.status} />

          {report ? (
            <>
              <p className="evidence-notice">
                Ortak zemin, ayrı sayılan analiz kaynaklarının aynı metnini gösterir;
                doğruluk kanıtı değildir. Aynı modelin farklı bağlantı veya üyelerdeki tekrarları ayrıca görünür,
                ancak bağımsız destek sayılmaz. Kanıt durumu yalnızca sizin işaretinizle değişir.
              </p>
              <section className="report-grid">
                <article className="report-card shared">
                  <div className="card-heading">
                    <span>ORTAK ZEMİN</span>
                    <strong>{report.sharedClaims.length}</strong>
                  </div>
                  {report.sharedClaims.map((claim) => (
                    <div className="claim" key={claim.claimId}>
                      <p>{claim.statement}</p>
                      {evidenceControl(claim)}
                      {memoryButton(claim)}
                      <div className="sources">
                        {claim.occurrences.map((occurrence) => (
                          <span key={occurrence.occurrenceId}>{occurrence.memberLabel}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                  {report.sharedClaims.length === 0 ? <p className="empty">Ortak iddia yok.</p> : null}
                </article>

                <article className="report-card">
                  <div className="card-heading">
                    <span>FARKLI GÖRÜŞLER</span>
                    <strong>{report.distinctClaims.length}</strong>
                  </div>
                  {report.distinctClaims.map((claim) => (
                    <div className="claim" key={claim.claimId}>
                      <em>{claim.kinds.map((kind) => kindLabels[kind]).join(" · ")}</em>
                      <p>{claim.statement}</p>
                      {claim.kinds.includes("objection") && claim.kinds.some((kind) => kind !== "objection") ? (
                        <small>Aynı ifade bazı üyelerde itiraz, bazılarında başka türde işaretlendi. Ortak zemin sayılmadı; bu tek başına mantıksal çelişki kanıtı değildir.{claim.synthesisCoverage === "included" ? " Önceki “dahil” işareti korundu; gözden geçirin." : ""}</small>
                      ) : null}
                      {new Set(claim.occurrences.map((item) => item.memberId)).size > 1 &&
                      new Set(claim.occurrences.map((item) =>
                        agreementSourceByMember.get(item.memberId) ?? `member:${item.memberId}`,
                      )).size === 1 ? (
                        <small>Aynı model veya analiz kaynağı farklı üyelerde tekrarlandı; bağımsız ortak görüş sayılmadı.</small>
                      ) : null}
                      {evidenceControl(claim)}
                      {memoryButton(claim)}
                      <div className="sources">
                        {claim.occurrences.map((occurrence) => (
                          <span key={occurrence.occurrenceId}>{occurrence.memberLabel}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </article>
              </section>

              {redTeamChallenges.length > 0 ? (
                <section className="red-team-section" aria-label="Red-team karşı argümanları">
                  <div className="card-heading red-team-heading">
                    <span>ANALİST ↔ RED-TEAM KARŞILAŞTIRMASI</span>
                    <strong>{redTeamChallenges.length}</strong>
                  </div>
                  <p className="red-team-notice">
                    Yan yana görünüm benzerlik, çelişki veya kazanan taraf çıkarsamaz. Red-team iddiaları
                    analistlerin ortak zemininden ayrı kalır ve karar ya da doğruluk puanı sayılmaz.
                  </p>
                  <div className="red-team-comparison-grid">
                    <article className="red-team-comparison-column analyst-column">
                      <header>
                        <div>
                          <span>ANALİST ZEMİNİ</span>
                          <strong>{analystClaims.length} iddia</strong>
                        </div>
                        <small>{report.sharedClaims.length} ortak · {report.distinctClaims.length} farklı</small>
                      </header>
                      <div className="red-team-comparison-list">
                        {analystClaims.map((claim) => (
                          <div key={claim.claimId}>
                            <em>{report.sharedClaims.some((item) => item.claimId === claim.claimId) ? "Ortak zemin" : "Farklı görüş"}</em>
                            <p>{claim.statement}</p>
                          </div>
                        ))}
                      </div>
                    </article>
                    <article className="red-team-comparison-column challenge-column">
                      <header>
                        <div>
                          <span>RED-TEAM BASINCI</span>
                          <strong>{redTeamChallenges.length} challenge</strong>
                        </div>
                        <small>{redTeamReviewChallenges.length} çapraz itiraz</small>
                      </header>
                      <div className="red-team-comparison-list">
                        {redTeamChallenges.map((claim) => (
                          <div className="red-team-challenge" key={claim.claimId}>
                            <em>{claim.kinds.map((kind) => kindLabels[kind]).join(" · ")}</em>
                            <p>{claim.statement}</p>
                            {evidenceControl(claim)}
                            {memoryButton(claim)}
                            <div className="sources">
                              {claim.occurrences.map((occurrence) => (
                                <span key={occurrence.occurrenceId}>{occurrence.memberLabel}</span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </article>
                  </div>
                </section>
              ) : null}

              <section className="synthesis-section" aria-label="Sentez kapsamı">
                <div className="synthesis-heading">
                  <div>
                    <span>SENTEZ KAPSAMI</span>
                    <strong>{synthesisClaims.length} izlenebilir iddia</strong>
                  </div>
                  <small>
                    Kapsam bir doğruluk kararı değildir; hiçbir azınlık görüşü otomatik silinmez.
                  </small>
                  <button className="secondary-button" type="button" disabled={exportingRun} onClick={() => void exportRun("md")}>Sentezi indir (MD)</button>
                </div>
                <div className="synthesis-grid">
                  {(["included", "unresolved", "omitted"] as const).map((coverage) => {
                    const entries = synthesisClaims.filter(
                      ({ claim }) => (claim.synthesisCoverage ?? "unresolved") === coverage,
                    );
                    return (
                      <article className={`synthesis-column ${coverage}`} key={coverage}>
                        <div className="card-heading">
                          <span>{synthesisCoverageLabels[coverage]}</span>
                          <strong>{entries.length}</strong>
                        </div>
                        {entries.map(({ claim, source }) => (
                          <div className="synthesis-item" key={claim.claimId}>
                            <em>{source}</em>
                            <p>{claim.statement}</p>
                            <label>
                              <span>Kapsam</span>
                              <select
                                aria-label={`${claim.statement} sentez kapsamı`}
                                value={claim.synthesisCoverage ?? "unresolved"}
                                disabled={updatingClaimId === claim.claimId}
                                onChange={(event) =>
                                  void updateSynthesisCoverage(
                                    claim.claimId,
                                    event.target.value as SynthesisCoverage,
                                  )
                                }
                              >
                                {Object.entries(synthesisCoverageLabels).map(([value, label]) => (
                                  <option key={value} value={value}>{label}</option>
                                ))}
                              </select>
                            </label>
                          </div>
                        ))}
                        {entries.length === 0 ? <p className="empty">Bu durumda iddia yok.</p> : null}
                      </article>
                    );
                  })}
                </div>
              </section>

              <ClaimContextPanel run={run} onRunUpdated={setRun} />

              <EvidenceCandidatePanel key={run.runId} run={run} onSourcesChanged={() => { void refreshEvidenceSources(run.runId); }} />

              <ResearchCapturePanel
                runId={run.runId}
                claims={synthesisClaims.map(({ claim, source }) => ({
                  claimId: claim.claimId,
                  statement: claim.statement,
                  source,
                }))}
                onEvidenceSourceCreated={() => { void refreshEvidenceSources(run.runId); }}
              />

              <section className="evidence-source-section" aria-label="Kaynak bağlantılı kanıtlar">
                <div className="synthesis-heading">
                  <div>
                    <span>KAYNAK BAĞLANTILI KANITLAR</span>
                    <strong>{evidenceSources.filter((source) => !source.candidateProvenance).length} kayıt</strong>
                  </div>
                  <small>
                    Manuel kayıtlar bağlantıyı ziyaret etmez. Güvenli getirme yoluyla oluşturulanlar da
                    yalnız seçtiğiniz birebir alıntıyı buraya aktarır; doğrulama ile güncellik kararları kullanıcıya aittir.
                  </small>
                </div>
                <label className="evidence-claim-picker">
                  İddia
                  <select
                    aria-label="Kanıt kaydı eklenecek iddia"
                    value={effectiveSelectedEvidenceClaimId ?? ""}
                    onChange={(event) => setSelectedEvidenceClaimId(event.target.value)}
                  >
                    {synthesisClaims.map(({ claim, source }) => (
                      <option key={claim.claimId} value={claim.claimId}>
                        {source} · {claim.statement}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedEvidenceClaim ? (
                  <>
                    <form className="evidence-source-form" onSubmit={saveEvidenceSource}>
                      <label>
                        Kaynak başlığı
                        <input
                          aria-label="Kaynak başlığı"
                          value={evidenceTitle}
                          maxLength={160}
                          onChange={(event) => setEvidenceTitle(event.target.value)}
                          required
                        />
                      </label>
                      <label>
                        Kaynak bağlantısı
                        <input
                          aria-label="Kaynak bağlantısı"
                          type="url"
                          value={evidenceUrl}
                          maxLength={2048}
                          placeholder="https://…"
                          onChange={(event) => setEvidenceUrl(event.target.value)}
                          required
                        />
                      </label>
                      <label>
                        İlişki
                        <select
                          aria-label="Kaynağın iddiayla ilişkisi"
                          value={evidenceRelation}
                          onChange={(event) => setEvidenceRelation(event.target.value as EvidenceRelation)}
                        >
                          {Object.entries(evidenceRelationLabels).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Kaynak yayın tarihi
                        <input
                          aria-label="Kaynak yayın tarihi"
                          type="date"
                          value={evidencePublishedAt}
                          onChange={(event) => setEvidencePublishedAt(event.target.value)}
                        />
                      </label>
                      <label>
                        İnceleme notu
                        <input
                          aria-label="Kaynak inceleme notu"
                          value={evidenceNote}
                          maxLength={1000}
                          onChange={(event) => setEvidenceNote(event.target.value)}
                        />
                      </label>
                      <label className="evidence-excerpt-field">
                        Kaynaktan değiştirilemez alıntı
                        <textarea
                          aria-label="Kaynaktan değiştirilemez alıntı"
                          value={evidenceExcerpt}
                          maxLength={4000}
                          rows={4}
                          onChange={(event) => setEvidenceExcerpt(event.target.value)}
                          required
                        />
                      </label>
                      <button disabled={savingEvidenceSource} type="submit">
                        {savingEvidenceSource ? "Ekleniyor…" : "Kaynak kaydı ekle"}
                      </button>
                    </form>
                    <div className="evidence-source-list">
                      {selectedClaimSources.map((source) => (
                        <article className="evidence-source" key={source.id}>
                          <div>
                            {/^https?:\/\//i.test(source.url) ? <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a> : <strong>{source.title}</strong>}
                            <small>{evidenceRelationLabels[source.relation]} · {source.note || "Not yok"}</small>
                            <blockquote>
                              {source.excerpt ?? "Bu eski kaynak kaydında mühürlenmiş alıntı bulunmuyor."}
                            </blockquote>
                            <small>
                              Yakalandı: {new Date(source.capturedAt).toLocaleString("tr-TR")}
                              {source.publishedAt ? ` · Yayın: ${source.publishedAt}` : " · Yayın tarihi belirtilmedi"}
                            </small>
                          </div>
                          <div className="evidence-review-controls">
                            <label>
                              İçerik incelemesi
                              <select
                                aria-label={`${source.title} inceleme durumu`}
                                value={source.reviewStatus}
                                onChange={(event) =>
                                  void updateEvidenceSourceReview(source.id, {
                                    reviewStatus: event.target.value as EvidenceReviewStatus,
                                  })
                                }
                              >
                                {Object.entries(evidenceReviewStatusLabels).map(([value, label]) => (
                                  <option key={value} value={value}>{label}</option>
                                ))}
                              </select>
                            </label>
                            <label>
                              Güncellik incelemesi
                              <select
                                aria-label={`${source.title} güncellik durumu`}
                                value={source.freshnessStatus}
                                onChange={(event) =>
                                  void updateEvidenceSourceReview(source.id, {
                                    freshnessStatus: event.target.value as EvidenceFreshnessStatus,
                                  })
                                }
                              >
                                {Object.entries(evidenceFreshnessStatusLabels).map(([value, label]) => (
                                  <option key={value} value={value}>{label}</option>
                                ))}
                              </select>
                            </label>
                            {source.freshnessReviewedAt ? (
                              <small>
                                Güncellik kararı: {new Date(source.freshnessReviewedAt).toLocaleString("tr-TR")}
                              </small>
                            ) : null}
                          </div>
                          <button
                            className="secondary-button danger-button"
                            type="button"
                            onClick={() => void removeEvidenceSource(source.id)}
                          >
                            Kaydı sil
                          </button>
                        </article>
                      ))}
                      {selectedClaimSources.length === 0 ? (
                        <p className="empty">Bu iddiaya bağlı kaynak kaydı yok.</p>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </section>

              <DecisionAssessmentPanel
                runId={run.runId}
                claims={synthesisClaims.map(({ claim }) => ({
                  claimId: claim.claimId,
                  statement: claim.statement,
                }))}
                sources={evidenceSources.filter((source) => !source.candidateProvenance).map((source) => ({
                  id: source.id,
                  claimId: source.claimId,
                  title: source.title,
                  excerpt: source.excerpt,
                }))}
              />

              <section className="member-grid" aria-label="Model ayrıntıları">
                {run.status === "completed" && run.providerMode === "remote" ? (
                  <p className="hint">Bir üyenin ilk yanıtını yeniden isteyebilirsiniz. Diğer ilk yanıtlar bu rapordan kopyalanır; seçili {run.reviewRounds ?? report.reviewExecution?.requestedRounds ?? 0} çapraz inceleme turu yeni birleşim üzerinde tekrar çalışır. Otomatik tekrar olmadan en fazla {1 + run.memberCount * (run.reviewRounds ?? report.reviewExecution?.requestedRounds ?? 0)} yeni sağlayıcı çağrısı yapılabilir; düşünme, web arama ve yanıt tokenları önceden kesin hesaplanamaz. Eski rapor saklanır.</p>
                ) : null}
                {report.memberResults.map((member) => (
                  <details className="member-card" key={member.memberId}>
                    <summary>
                      <span>{member.label}</span>
                      <small>{councilRoleLabels[member.councilRole]} · tur 0{member.reusedFromRunId ? " · önceki çalışmadan kopya" : ""}</small>
                    </summary>
                    <p>{member.parsed.summary}</p>
                    {["completed", "partially_completed"].includes(run.status) && <PrivateBranchSeedButton key={`${run.runId}:${member.memberId}`} runId={run.runId} memberId={member.memberId} />}
                    {member.reusedFromRunId ? <small>Kaynak çalışma: {member.reusedFromRunId}</small> : null}
                    {run.status === "completed" && run.providerMode === "remote" ? (
                      <button type="button" className="secondary-button" disabled={Boolean(rerunningMemberId)} onClick={() => void rerunSelectedMember(member.memberId)}>
                        {rerunningMemberId === member.memberId ? "Başlatılıyor…" : "Bu üyeyi yeniden çalıştır (API çağrısı)"}
                      </button>
                    ) : null}
                    {member.citations.length > 0 ? (
                      <div className="provider-citations">
                        <strong>Modelin web kaynakları</strong>
                        {member.citations.map((citation) => (
                          <a key={citation.url} href={citation.url} target="_blank" rel="noreferrer">
                            {citation.title ?? citation.url}
                          </a>
                        ))}
                      </div>
                    ) : null}
                    <pre>{member.rawText}</pre>
                  </details>
                ))}
                {report.failures.map((failure) => (
                  <div className="member-card failed" key={failure.memberId}>
                    <strong>{failure.label}</strong>
                    <p>{failure.message}</p>
                    {failure.rawText ? <details><summary>İşlenemeyen ham yanıtı incele</summary><pre>{failure.rawText}</pre></details> : null}
                  </div>
                ))}
              </section>

              {reviews.length > 0 || reviewFailures.length > 0 || report.reviewExecution ? (
                <section className="review-section" aria-label="Çapraz incelemeler">
                  <div className="review-section-heading">
                    <div>
                      <span>ÇAPRAZ İNCELEME · TUR 1–3</span>
                      <strong>{reviews.length} tamamlanan inceleme</strong>
                    </div>
                    <small>İlk turda diğer üyelerin yapılandırılmış analizleri; sonraki turlarda ayrıca yalnızca bir önceki kapanmış turun incelemeleri kullanılır.</small>
                  </div>
                  {report.reviewExecution ? <p className="hint">İstenen tur: {report.reviewExecution.requestedRounds}; eksiksiz tamamlanan tur: {report.reviewExecution.completedRounds}. {report.reviewExecution.stopReason === "prior_round_incomplete" ? "Bir tur eksik kaldığı için sonraki turlar başlatılmadı." : report.reviewExecution.stopReason === "insufficient_members" ? "İnceleme için en az iki başarılı üye gerekli." : report.reviewExecution.stopReason === "not_requested" ? "Çapraz inceleme seçilmedi." : "Seçilen tur sınırına ulaşıldı."}</p> : null}
                  {reviewPromptPlans.length > 0 ? (
                    <details className="review-prompt-plan">
                      <summary>{reviewPromptPlans.some((plan) => plan.round > 1) ? "Turlar için oluşturulan istemleri ve gerçek girdileri incele" : "Tur 1 için oluşturulan istemleri ve gerçek girdileri incele · cross-review-v1"}</summary>
                      <p className="hint">Metinler önceki tur kapandıktan sonra mevcut başarılı çıktılarla oluşturulup çalışma raporunda saklandı. Başarısız incelemede ağ gönderimi gerçekleşmiş olmayabilir. Sağlayıcının gizli çerçevesi ve araç kullanımı burada gösterilmez.</p>
                      {reviewPromptPlans.map((plan) => (
                        <article key={`${plan.round}:${plan.reviewerMemberId}`}>
                          <strong>Tur {plan.round} · {plan.reviewerLabel} · {plan.version}</strong>
                          <small>Hedefler: {plan.peerMemberIds.map((id) => report.memberResults.find((member) => member.memberId === id)?.label ?? id).join(", ")}</small>
                          <small>İstem izi: {plan.fingerprint}</small>
                          <p>Sistem yönergesi</p><pre>{plan.instructions}</pre>
                          <p>Kullanıcı girdisi</p><pre>{plan.input}</pre>
                        </article>
                      ))}
                    </details>
                  ) : <p className="hint">Bu çalışmada çapraz inceleme istem kaydı yok; eski raporlar geriye dönük olarak kesin istem diye yeniden kurulmaz.</p>}
                  <div className="review-grid">
                    {reviews.map((review) => (
                      <article className="review-card" key={`${review.round}:${review.reviewerMemberId}`}>
                        <div className="review-card-heading">
                          <strong>Tur {review.round} · {review.reviewerLabel}</strong>
                          <span>{councilRoleLabels[review.reviewerCouncilRole]} · inceleyen</span>
                        </div>
                        <p>{review.parsed.summary}</p>
                        {review.citations.length > 0 ? (
                          <div className="provider-citations">
                            <strong>İnceleme sırasında kullanılan web kaynakları</strong>
                            {review.citations.map((citation) => (
                              <a key={citation.url} href={citation.url} target="_blank" rel="noreferrer">
                                {citation.title ?? citation.url}
                              </a>
                            ))}
                          </div>
                        ) : null}
                        {review.parsed.claims.map((claim, index) => {
                          const target = report.memberResults.find(
                            (member) => member.memberId === claim.targetMemberId,
                          );
                          return (
                            <div className="review-assessment" key={`${review.reviewerMemberId}-${index}`}>
                              <div>
                                <strong>{target?.label ?? claim.targetMemberId}</strong>
                                <em>{reviewStanceLabels[claim.reviewStance]}</em>
                              </div>
                              <p>{claim.statement}</p>
                              <blockquote>{claim.quote}</blockquote>
                            </div>
                          );
                        })}
                        {"selfRevisions" in review.parsed && Array.isArray(review.parsed.selfRevisions) ? (
                          <div className="review-assessment">
                            <strong>Öz düzeltme önerileri · ilk iddialar korunur</strong>
                            {review.parsed.selfRevisions.length === 0 ? <p>Bu turda değişiklik önerisi yok.</p> : review.parsed.selfRevisions.map((revision) => {
                              const original = report.memberResults.find((member) => member.memberId === review.reviewerMemberId)?.parsed.claims[revision.sourceClaimIndex];
                              return <div key={revision.sourceClaimIndex}>
                                <p><strong>İlk iddia {revision.sourceClaimIndex + 1}:</strong> {original?.statement ?? "İlk iddia bulunamadı"}</p>
                                <p><strong>{revision.action === "withdraw" ? "Geri çekme" : "Niteleme"} önerisi:</strong> {revision.statement}</p>
                                <p><strong>Gerekçe:</strong> {revision.reason}</p>
                              </div>;
                            })}
                          </div>
                        ) : null}
                      </article>
                    ))}
                    {reviewFailures.map((failure) => (
                      <article className="review-card failed" key={`${failure.round}:${failure.memberId}`}>
                        <strong>Tur {failure.round} · {failure.label}</strong>
                        <p>{failure.message}</p>
                        {failure.rawText ? <details><summary>İşlenemeyen ham incelemeyi incele</summary><pre>{failure.rawText}</pre></details> : null}
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
      </section>
    </WorkspaceShell>
  );
}
