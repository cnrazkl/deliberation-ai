import { describe, expect, it } from "vitest";
import {
  createFakeCouncilRun,
  executeFakeCouncil,
  executeCouncil,
  IdempotencyConflictError,
  type RunRecord,
  type RunRepository,
} from "./index";
import type { CouncilMemberConfig, CreateRunRequest } from "@deliberation-ai/contracts";
import { FakeProvider, NormalizedProviderError, type TextProvider } from "@deliberation-ai/providers";

describe("selected member follow-up", () => {
  it("reuses one frozen initial answer without a round-0 provider call and reviews the new combination", async () => {
    const members = sixMembers.slice(0, 2);
    const snapshot = { snapshotId: "member-rerun-fixture", question: "Hangi varsayımlar ve riskler yeniden incelenmeli?" };
    const source = await executeFakeCouncil(snapshot, "success", members, 1);
    const calls: Record<string, number[]> = { "fake-a": [], "fake-b": [] };
    const providers: TextProvider[] = members.map((member) => {
      const fake = new FakeProvider({ id: member.id, label: member.label,
        role: member.role, councilRole: member.councilRole, perspective: member.perspective! });
      return { id: fake.id, label: fake.label, role: member.role,
        councilRole: fake.councilRole, async generate(request) {
          calls[member.id]!.push(request.round);
          return fake.generate(request);
        } };
    });
    const reused = { ...source.memberResults[0]!, reusedFromRunId: "source-run" };
    const followUp = await executeCouncil(snapshot, providers, 1, members, false, [reused]);
    expect(calls["fake-a"]).toEqual([1]);
    expect(calls["fake-b"]).toEqual([0, 1]);
    expect(followUp.status).toBe("completed");
    expect(followUp.memberResults[0]).toMatchObject({ memberId: "fake-a", reusedFromRunId: "source-run" });
    expect(followUp.reviews).toHaveLength(2);
    expect(source.memberResults[0]?.reusedFromRunId).toBeUndefined();
  });
});

const sixMembers: CouncilMemberConfig[] = [
  ["fake-a", "Analist A", "procedural"],
  ["fake-b", "Analist B", "risk"],
  ["fake-c", "Analist C", "evidence"],
  ["fake-d", "Analist D", "implementation"],
  ["fake-e", "Analist E", "alternatives"],
  ["fake-f", "Analist F", "assumptions"],
].map(([id, label, perspective]) => ({
  id: id!,
  label: label!,
  role: `${label} rolü`,
  provider: "fake" as const,
  model: "deterministic-fixture-v1",
  reasoningLevel: "default" as const,
  webSearchMode: "off" as const,
  councilRole: "analyst" as const,
  perspective: perspective as NonNullable<CouncilMemberConfig["perspective"]>,
}));

class MemoryRepository implements RunRepository {
  readonly records = new Map<string, RunRecord>();

  async findByIdempotencyKey(key: string) {
    return [...this.records.values()].find((record) => record.idempotencyKey === key);
  }

  async findById(id: string) {
    return this.records.get(id);
  }

  async save(run: RunRecord) {
    this.records.set(run.runId, run);
  }
}

describe("createFakeCouncilRun", () => {
  it("keeps an invalid provider response inspectable without treating it as claims", async () => {
    const raw = '{"summary":"Eksik iddialar"}';
    const providers: TextProvider[] = [
      { id: "good", label: "Geçerli üye", councilRole: "analyst", async generate() {
        const parsed = { summary: "Geçerli özet", claims: [{ statement: "Geçerli iddia", kind: "risk" as const, quote: "Geçerli iddia" }] };
        return { rawText: JSON.stringify(parsed), parsed };
      } },
      { id: "bad", label: "Geçersiz üye", councilRole: "analyst", async generate() {
        throw new NormalizedProviderError("Geçersiz JSON", "provider_response_invalid", "known", false, raw);
      } },
    ];
    const report = await executeCouncil({ snapshotId: "invalid-raw", question: "Bu çıktı güvenilir biçimde işlendi mi?" }, providers, 0);
    expect(report.status).toBe("partially_completed");
    expect(report.failures[0]).toMatchObject({ memberId: "bad", rawText: raw });
    expect(report.qualityNotice).toContain("iddia çıkarımının tamlığı doğrulanamadı");
    expect(report.sharedClaims).toHaveLength(0);
    expect(report.distinctClaims.flatMap((claim) => claim.occurrences).every((claim) => claim.memberId === "good")).toBe(true);
  });
  it("runs two independent fake members against one frozen snapshot", async () => {
    const repository = new MemoryRepository();
    const run = await createFakeCouncilRun(
      { question: "Bu kararı güvenli biçimde nasıl değerlendirmeliyim?", idempotencyKey: "run-key-0001", scenario: "success", providerMode: "fake", reviewRounds: 1, memoryEntryIds: [] },
      repository,
    );

    expect(run.report?.status).toBe("completed");
    expect(run.report?.memberResults).toHaveLength(2);
    expect(run.report?.sharedClaims[0]?.occurrences).toHaveLength(2);
    expect(run.report?.reviews).toHaveLength(2);
    expect(run.report?.reviews[0]?.parsed.claims[0]?.targetMemberId).toBe("fake-b");
  });

  it("returns the same run for an identical idempotent request", async () => {
    const repository = new MemoryRepository();
    const request: CreateRunRequest = { question: "Bu kararı güvenli biçimde nasıl değerlendirmeliyim?", idempotencyKey: "run-key-0002", scenario: "success", providerMode: "fake", reviewRounds: 1, memoryEntryIds: [] };
    const first = await createFakeCouncilRun(request, repository);
    const second = await createFakeCouncilRun(request, repository);
    expect(second.runId).toBe(first.runId);
    expect(repository.records).toHaveLength(1);
  });

  it("rejects reuse of an idempotency key with a different body", async () => {
    const repository = new MemoryRepository();
    await createFakeCouncilRun(
      { question: "İlk uzun soru burada yer alıyor.", idempotencyKey: "run-key-0003", scenario: "success", providerMode: "fake", reviewRounds: 1, memoryEntryIds: [] },
      repository,
    );
    await expect(
      createFakeCouncilRun(
        { question: "Tamamen farklı ikinci bir soru.", idempotencyKey: "run-key-0003", scenario: "success", providerMode: "fake", reviewRounds: 1, memoryEntryIds: [] },
        repository,
      ),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("marks one-member output as partial rather than consensus", async () => {
    const repository = new MemoryRepository();
    const run = await createFakeCouncilRun(
      { question: "Kısmi hata durumunu açıkça nasıl sunmalıyım?", idempotencyKey: "run-key-0004", scenario: "member-b-fails", providerMode: "fake", reviewRounds: 1, memoryEntryIds: [] },
      repository,
    );
    expect(run.report?.status).toBe("partially_completed");
    expect(run.report?.sharedClaims).toHaveLength(0);
    expect(run.report?.failures).toHaveLength(1);
  });

  it("runs a six-member council from an explicit frozen configuration", async () => {
    const report = await executeFakeCouncil(
      { snapshotId: "snapshot-six", question: "Altı bakış açısı bu kararı nasıl değerlendirir?" },
      "success",
      sixMembers,
    );
    expect(report.status).toBe("completed");
    expect(report.memberResults).toHaveLength(6);
    expect(report.sharedClaims[0]?.occurrences).toHaveLength(6);
    expect(report.distinctClaims).toHaveLength(6);
    expect(report.reviews).toHaveLength(6);
    expect(report.reviews.every((review) => review.parsed.claims.length === 5)).toBe(true);
    expect(report.reviewPromptPlans).toHaveLength(6);
    const firstReviewPrompt = report.reviewPromptPlans?.[0];
    expect(firstReviewPrompt).toMatchObject({ version: "cross-review-v1", reviewerMemberId: sixMembers[0]?.id });
    expect(firstReviewPrompt?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(firstReviewPrompt?.instructions).toContain("Analist A rolü");
    const delivered = JSON.parse(firstReviewPrompt!.input) as { originalQuestion: string; peers: Array<{ memberId: string; summary: string }>; toolContext: unknown[] };
    expect(delivered.originalQuestion).toBe("Altı bakış açısı bu kararı nasıl değerlendirir?");
    expect(delivered.peers).toHaveLength(5);
    expect(delivered.peers.some((peer) => peer.memberId === sixMembers[0]?.id)).toBe(false);
    expect(delivered.toolContext).toEqual([]);
  });

  it("runs three review barriers with only the closed previous round in later inputs", async () => {
    const report = await executeFakeCouncil(
      { snapshotId: "three-rounds", question: "Üç turda önceki eleştiriler nasıl aktarılır?" },
      "success", sixMembers.slice(0, 2), 3,
    );
    expect(report.status).toBe("completed");
    expect(report.reviews.map((review) => review.round)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(report.reviewExecution).toEqual({ requestedRounds: 3, completedRounds: 3, stopReason: "round_limit" });
    expect(report.reviewPromptPlans?.map((plan) => plan.version)).toEqual([
      "cross-review-v1", "cross-review-v1", "cross-review-v2", "cross-review-v2", "cross-review-v2", "cross-review-v2",
    ]);
    const roundTwo = report.reviewPromptPlans?.find((plan) => plan.round === 2);
    const roundThree = report.reviewPromptPlans?.find((plan) => plan.round === 3);
    const secondInput = JSON.parse(roundTwo!.input) as { previousRound: number; previousReviews: Array<{ reviewerMemberId: string }> };
    const thirdInput = JSON.parse(roundThree!.input) as { previousRound: number; previousReviews: Array<{ reviewerMemberId: string }> };
    expect(secondInput.previousRound).toBe(1);
    expect(secondInput.previousReviews).toHaveLength(2);
    expect(thirdInput.previousRound).toBe(2);
    expect(thirdInput.previousReviews).toHaveLength(2);
    expect(roundTwo?.input).not.toContain("rawText");
  });
  it("keeps original claims while saving bounded self-revision proposals", async () => {
    const report = await executeFakeCouncil(
      { snapshotId: "self-revision", question: "Özgün iddia ve düzeltme önerileri nasıl ayrılır?" },
      "success", sixMembers.slice(0, 2), 2, true,
    );
    expect(report.status).toBe("completed");
    expect(report.reviewPromptPlans?.every((plan) => plan.version === "cross-review-v3")).toBe(true);
    expect(report.memberResults[0]?.parsed.claims[0]?.statement).not.toContain("koşulları doğrulanmalı");
    expect(report.reviews.every((review) => "selfRevisions" in review.parsed)).toBe(true);
    const first = report.reviews[0]!.parsed;
    expect("selfRevisions" in first && first.selfRevisions[0]?.sourceClaimIndex).toBe(0);
    expect(JSON.parse(report.reviewPromptPlans![0]!.input).ownInitial).toEqual(report.memberResults[0]?.parsed);
  });

  it("rejects self-revision proposals without a valid original claim", async () => {
    const providers: TextProvider[] = ["seat-a", "seat-b"].map((id) => ({
      id, label: id, councilRole: "analyst" as const,
      async generate(request) {
        const parsed = request.round === 0
          ? { summary: id, claims: [{ statement: `İddia ${id}`, kind: "risk" as const, quote: `İddia ${id}` }] }
          : { summary: id, claims: [{ statement: "İnceleme", kind: "objection" as const, quote: "İddia", targetMemberId: request.reviewContext!.peers[0]!.memberId, reviewStance: "qualify" as const }],
              selfRevisions: [{ sourceClaimIndex: 2, action: "withdraw" as const, statement: "Yok", reason: "Yanlış bağ" }] };
        return { rawText: JSON.stringify(parsed), parsed };
      },
    }));
    const report = await executeCouncil({ snapshotId: "invalid-self", question: "Yanlış öz düzeltme reddedilir mi?" }, providers, 1, [], true);
    expect(report.reviewFailures).toHaveLength(2);
    expect(report.reviewFailures[0]?.code).toBe("invalid_self_revision");
    expect(report.reviewExecution?.stopReason).toBe("prior_round_incomplete");
    expect(report.memberResults).toHaveLength(2);
  });

  it("stops after an incomplete review barrier and never starts round three", async () => {
    const calledRounds: number[] = [];
    const providers: TextProvider[] = ["seat-a", "seat-b"].map((id) => ({
      id, label: id, councilRole: "analyst" as const,
      async generate(request) {
        calledRounds.push(request.round);
        if (request.round === 2 && id === "seat-b") throw new NormalizedProviderError("Known review failure", "review_failed", "known", false);
        const parsed = request.round === 0
          ? { summary: id, claims: [{ statement: `İddia ${id}`, kind: "risk" as const, quote: `Alıntı ${id}` }] }
          : { summary: `Tur ${request.round}`, claims: [{
              statement: `Görüş ${id}`, kind: "objection" as const,
              quote: request.reviewContext!.peers[0]!.claims[0]!.statement,
              targetMemberId: request.reviewContext!.peers[0]!.memberId,
              reviewStance: "qualify" as const,
            }] };
        return { rawText: JSON.stringify(parsed), parsed };
      },
    }));
    const report = await executeCouncil({ snapshotId: "stop", question: "Eksik turda devam edilmeli mi?" }, providers, 3);
    expect(report.status).toBe("partially_completed");
    expect(report.reviewExecution).toEqual({ requestedRounds: 3, completedRounds: 1, stopReason: "prior_round_incomplete" });
    expect(report.reviewFailures).toMatchObject([{ round: 2, memberId: "seat-b" }]);
    expect(calledRounds).toEqual([0, 0, 1, 1, 2, 2]);
    expect(report.reviewPromptPlans?.map((plan) => plan.round)).toEqual([1, 1, 2, 2]);
  });

  it("keeps duplicate demo perspectives visible without counting them as separate agreement", async () => {
    const configured = sixMembers.slice(0, 2).map((member) => ({
      ...member,
      perspective: "risk" as const,
    }));
    const report = await executeFakeCouncil(
      { snapshotId: "snapshot-duplicate", question: "Tekrarlanan bakış açısı nasıl görünür?" },
      "success",
      configured,
      0,
    );

    expect(report.sharedClaims).toHaveLength(0);
    expect(report.distinctClaims.every((claim) => claim.occurrences.length === 2)).toBe(true);
  });

  it("marks a multi-member run partial when any configured member fails", async () => {
    const report = await executeFakeCouncil(
      { snapshotId: "snapshot-partial", question: "Kısmi çoklu sonuç nasıl görünür?" },
      "member-b-fails",
      sixMembers.slice(0, 4),
    );
    expect(report.status).toBe("partially_completed");
    expect(report.memberResults).toHaveLength(3);
    expect(report.failures).toHaveLength(1);
    expect(report.reviewPromptPlans).toHaveLength(3);
  });

  it("projects red-team output separately and preserves its review stance", async () => {
    const configured = sixMembers.slice(0, 3).map((member, index) => ({
      ...member,
      councilRole: index === 2 ? "red-team" as const : "analyst" as const,
    }));
    const report = await executeFakeCouncil(
      { snapshotId: "snapshot-red-team", question: "Karşı argümanlar nasıl ayrılır?" },
      "success",
      configured,
      1,
    );
    expect(report.status).toBe("completed");
    expect(report.redTeamChallenges).toHaveLength(2);
    const redReview = report.reviews.find((review) => review.reviewerCouncilRole === "red-team");
    expect(redReview?.parsed.claims.every((claim) => claim.reviewStance === "challenge")).toBe(true);
  });
});
