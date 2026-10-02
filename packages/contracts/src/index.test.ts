import { describe, expect, it } from "vitest";
import {
  createRunRequestSchema,
  createScheduleSchema,
  defaultFakeCouncilMembers,
  modelCatalogCheckSchema,
  providerOutputSchema,
  resolveProviderOperationSchema,
  saveProviderConnectionSchema,
  saveEvidenceSourceSchema,
  updateEvidenceSourceSchema,
  updateClaimEvidenceStateSchema,
  updateClaimSynthesisCoverageSchema,
  updateClaimScopeSchema,
  saveClaimRelationSchema,
  deleteClaimRelationSchema,
} from "./index";

describe("external contracts", () => {
  it("bounds persisted catalog observations and rejects unknown provider fields", () => {
    const check = { status: "available", verification: "catalog_only", models: ["local-model"], truncated: false, checkedAt: "2026-09-27T00:00:00.000Z" };
    expect(modelCatalogCheckSchema.safeParse(check).success).toBe(true);
    expect(modelCatalogCheckSchema.safeParse({ ...check, models: Array.from({ length: 301 }, (_, index) => `model-${index}`) }).success).toBe(false);
    expect(modelCatalogCheckSchema.safeParse({ ...check, rawProviderResponse: { apiKey: "must-not-persist" } }).success).toBe(false);
    expect(modelCatalogCheckSchema.safeParse({ ...check, checkedAt: "yesterday" }).success).toBe(false);
  });
  it("bounds claim scope and requires distinct, explained relation endpoints", () => {
    expect(updateClaimScopeSchema.safeParse({ scopeNote: "" }).success).toBe(true);
    expect(updateClaimScopeSchema.safeParse({ scopeNote: "x".repeat(501) }).success).toBe(false);
    const relation = { fromClaimId: "claim-001", toClaimId: "claim-002", kind: "qualifies", note: "Yalnızca belirtilen koşulda" };
    expect(saveClaimRelationSchema.safeParse(relation).success).toBe(true);
    expect(saveClaimRelationSchema.safeParse({ ...relation, toClaimId: relation.fromClaimId }).success).toBe(false);
    expect(saveClaimRelationSchema.safeParse({ ...relation, note: " " }).success).toBe(false);
    expect(deleteClaimRelationSchema.safeParse(relation).success).toBe(true);
  });
  it("rejects short questions and silently unknown fields", () => {
    const result = createRunRequestSchema.safeParse({
      question: "short",
      idempotencyKey: "12345678",
      unexpected: "ignored",
    });
    expect(result.success).toBe(false);
  });

  it("requires traceable claim quotes", () => {
    const result = providerOutputSchema.safeParse({
      summary: "A summary",
      claims: [{ statement: "A claim", kind: "shared", quote: "" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts two to six unique configured members and rejects duplicates", () => {
    const member = {
      id: "fake-a",
      label: "Analist A",
      role: "Risk analisti",
      provider: "fake" as const,
      model: "deterministic-fixture-v1",
      perspective: "risk" as const,
    };
    const base = {
      question: "Yapılandırılmış konsey sözleşmesi doğru çalışıyor mu?",
      idempotencyKey: "contract-members-1",
      providerMode: "fake",
    } as const;
    expect(createRunRequestSchema.safeParse({ ...base, members: [member, member] }).success).toBe(false);
    expect(
      createRunRequestSchema.safeParse({
        ...base,
        members: [
          member,
          { ...member, id: "fake-b", label: "Analist B", perspective: "procedural" },
        ],
      }).success,
    ).toBe(true);
  });

  it("accepts only explicit provider-operation decisions", () => {
    expect(resolveProviderOperationSchema.safeParse({ action: "authorize_retry" }).success).toBe(
      true,
    );
    expect(resolveProviderOperationSchema.safeParse({ action: "automatic_retry" }).success).toBe(
      false,
    );
  });

  it("bounds cross-review to zero through three rounds", () => {
    const base = {
      question: "Çapraz inceleme turu güvenli biçimde sınırlandırılıyor mu?",
      idempotencyKey: "review-rounds-contract",
      providerMode: "fake",
    };
    expect(createRunRequestSchema.safeParse({ ...base, reviewRounds: 1 }).success).toBe(true);
    expect(createRunRequestSchema.safeParse({ ...base, reviewRounds: 2 }).success).toBe(true);
    expect(createRunRequestSchema.safeParse({ ...base, reviewRounds: 3 }).success).toBe(true);
    expect(createRunRequestSchema.safeParse({ ...base, reviewRounds: 4 }).success).toBe(false);
    expect(createRunRequestSchema.safeParse({ ...base, reviewRounds: 0, selfRevisionEnabled: true }).success).toBe(false);
    expect(createRunRequestSchema.safeParse({ ...base, reviewRounds: 1, selfRevisionEnabled: true }).success).toBe(true);
  });

  it("requires a red-team member and cross-review for explicit high-risk runs and schedules", () => {
    const members = [
      defaultFakeCouncilMembers[0]!,
      { ...defaultFakeCouncilMembers[1]!, councilRole: "red-team" as const },
    ];
    const run = { question: "Yüksek riskli bir soruda kontroller çalışıyor mu?", idempotencyKey: "high-risk-contract", providerMode: "fake", riskProfile: "high", members, reviewRounds: 1 };
    expect(createRunRequestSchema.safeParse(run).success).toBe(true);
    expect(createRunRequestSchema.safeParse({ ...run, reviewRounds: 0 }).success).toBe(false);
    expect(createRunRequestSchema.safeParse({ ...run, members: defaultFakeCouncilMembers }).success).toBe(false);
    expect(createRunRequestSchema.safeParse({ ...run, riskProfile: "standard", reviewRounds: 0, members: defaultFakeCouncilMembers }).success).toBe(true);
    const schedule = { name: "Yüksek risk", question: run.question, providerMode: "fake", riskProfile: "high", reviewRounds: 1, cadence: "daily", nextRunAt: "2026-09-26T12:00:00Z", members };
    expect(createScheduleSchema.safeParse(schedule).success).toBe(true);
    expect(createScheduleSchema.safeParse({ ...schedule, reviewRounds: 0 }).success).toBe(false);
    expect(createScheduleSchema.safeParse({ ...schedule, members: defaultFakeCouncilMembers }).success).toBe(false);
  });

  it("bounds and deduplicates selected shared-memory entries", () => {
    const ids = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
      "55555555-5555-4555-8555-555555555555",
    ];
    const base = {
      question: "Seçilen geçmiş bağlam güvenli biçimde sınırlandırılıyor mu?",
      idempotencyKey: "memory-contract-1",
      providerMode: "fake",
    };
    expect(createRunRequestSchema.safeParse({ ...base, memoryEntryIds: ids }).success).toBe(true);
    expect(
      createRunRequestSchema.safeParse({ ...base, memoryEntryIds: [...ids, ids[0]] }).success,
    ).toBe(false);
    expect(
      createRunRequestSchema.safeParse({ ...base, memoryEntryIds: [ids[0], ids[0]] }).success,
    ).toBe(false);
  });

  it("bounds image attachments and their decoded size", () => {
    const attachment = {
      name: "diagram.png",
      mimeType: "image/png",
      dataBase64: "aGVsbG8=",
      sha256: "a".repeat(64),
    };
    const base = {
      question: "Görev görselleri güvenli biçimde sınırlandırılıyor mu?",
      idempotencyKey: "attachment-contract",
      providerMode: "fake",
    };
    expect(createRunRequestSchema.safeParse({ ...base, attachments: [attachment] }).success).toBe(true);
    expect(createRunRequestSchema.safeParse({ ...base, attachments: Array(6).fill(attachment) }).success).toBe(true);
    expect(createRunRequestSchema.safeParse({ ...base, attachments: Array(7).fill(attachment) }).success).toBe(false);
    expect(createRunRequestSchema.safeParse({
      ...base,
      attachments: [{ ...attachment, mimeType: "image/svg+xml" }],
    }).success).toBe(false);
  });

  it("accepts bounded extracted PDF attachments and rejects missing text", () => {
    const pdf = {
      name: "karar.pdf",
      mimeType: "application/pdf",
      dataBase64: "aGVsbG8=",
      sha256: "a".repeat(64),
      extractedText: "[Sayfa 1] Karar metni",
    };
    const base = {
      question: "Ekli PDF bu karar için ne söylüyor?",
      idempotencyKey: "pdf-attachment-contract",
      providerMode: "fake",
    };
    expect(createRunRequestSchema.safeParse({ ...base, attachments: [pdf] }).success).toBe(true);
    expect(createRunRequestSchema.safeParse({ ...base, attachments: [{ ...pdf, extractedText: "" }] }).success).toBe(false);
    expect(createRunRequestSchema.safeParse({ ...base, attachments: [{ ...pdf, extractedText: "x".repeat(64_001) }] }).success).toBe(false);
  });

  it("requires at least one analyst when red-team roles are configured", () => {
    const redTeamMember = {
      id: "red-a",
      label: "Red Team",
      role: "Karşı argüman analisti",
      provider: "fake",
      model: "fixture",
      perspective: "risk",
      councilRole: "red-team",
    };
    const base = {
      question: "Red-team rolleri ortak zeminden ayrı tutuluyor mu?",
      idempotencyKey: "red-team-contract",
      providerMode: "fake",
      reviewRounds: 1,
    };
    expect(
      createRunRequestSchema.safeParse({
        ...base,
        members: [redTeamMember, { ...redTeamMember, id: "red-b" }],
      }).success,
    ).toBe(false);
    expect(
      createRunRequestSchema.safeParse({
        ...base,
        members: [redTeamMember, { ...redTeamMember, id: "analyst-b", councilRole: "analyst" }],
      }).success,
    ).toBe(true);
  });

  it("accepts only explicit claim evidence states", () => {
    expect(
      updateClaimEvidenceStateSchema.safeParse({ evidenceState: "externally-verified" }).success,
    ).toBe(true);
    expect(
      updateClaimEvidenceStateSchema.safeParse({ evidenceState: "majority-agrees" }).success,
    ).toBe(false);
  });

  it("validates source-backed evidence records", () => {
    const source = {
      runId: "11111111-1111-4111-8111-111111111111",
      claimId: "claim-001",
      title: "Resmî kaynak",
      url: "https://example.test/evidence",
      relation: "supports",
      excerpt: "Kaynakta iddiayı destekleyen değiştirilemez alıntı.",
      publishedAt: "2026-09-17",
      note: "Kullanıcı inceleme notu",
    };
    expect(saveEvidenceSourceSchema.safeParse(source).success).toBe(true);
    expect(saveEvidenceSourceSchema.safeParse({ ...source, url: "not-a-url" }).success).toBe(false);
    expect(saveEvidenceSourceSchema.safeParse({ ...source, relation: "proves" }).success).toBe(false);
    expect(saveEvidenceSourceSchema.safeParse({ ...source, excerpt: "" }).success).toBe(false);
    expect(saveEvidenceSourceSchema.safeParse({ ...source, publishedAt: "2026-99-99" }).success).toBe(false);
    expect(updateEvidenceSourceSchema.safeParse({ freshnessStatus: "current" }).success).toBe(true);
    expect(updateEvidenceSourceSchema.safeParse({}).success).toBe(false);
  });

  it("accepts only explicit synthesis coverage states", () => {
    expect(
      updateClaimSynthesisCoverageSchema.safeParse({ synthesisCoverage: "unresolved" }).success,
    ).toBe(true);
    expect(
      updateClaimSynthesisCoverageSchema.safeParse({ synthesisCoverage: "ignored" }).success,
    ).toBe(false);
  });

  it("accepts mixed remote provider councils and rejects fake/remote mixing", () => {
    const remoteMembers = [
      {
        id: "claude-a",
        label: "Claude",
        role: "Risk analisti",
        provider: "anthropic",
        model: "claude-test",
        connectionId: "5a5447b8-51e8-4d2c-a177-4318fe62a184",
        reasoningLevel: "high",
        webSearchMode: "auto",
      },
      {
        id: "gemini-b",
        label: "Gemini",
        role: "Kanıt analisti",
        provider: "google",
        model: "gemini-test",
        connectionId: "bbba148d-52ed-4e79-ad9c-272989b2c09c",
        reasoningLevel: "medium",
      },
    ];
    const base = {
      question: "Farklı sağlayıcılar aynı konseyde güvenle çalışabilir mi?",
      idempotencyKey: "remote-contract-1",
      providerMode: "remote",
    };
    const parsed = createRunRequestSchema.safeParse({ ...base, members: remoteMembers });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.members?.map((member) => member.webSearchMode)).toEqual(["auto", "off"]);
    }
    expect(
      createRunRequestSchema.safeParse({
        ...base,
        members: remoteMembers.map((member) => ({ ...member, webSearchMode: "always" })),
      }).success,
    ).toBe(false);
    expect(
      createRunRequestSchema.safeParse({
        ...base,
        members: [
          remoteMembers[0],
          {
            id: "fake-b",
            label: "Deneme",
            role: "Deneme",
            provider: "fake",
            model: "fixture",
            perspective: "risk",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("allows keyless local endpoints and requires keys for cloud presets", () => {
    const local = {
      provider: "openai-compatible",
      label: "Yerel Ollama",
      apiKey: "",
      defaultModel: "qwen3",
      baseUrl: "http://127.0.0.1:11434/v1",
      endpointPreset: "ollama",
      reasoningProtocol: "none",
      structuredOutputMode: "json-object",
    };
    expect(saveProviderConnectionSchema.safeParse(local).success).toBe(true);
    expect(
      saveProviderConnectionSchema.safeParse({
        ...local,
        label: "OpenRouter",
        endpointPreset: "openrouter",
      }).success,
    ).toBe(false);
  });
});
