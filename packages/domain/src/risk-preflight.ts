import type { CouncilMemberConfig, RiskAssessment, RiskProfile } from "@deliberation-ai/contracts";

export type RiskInput = {
  question: string;
  continuationContext?: { content: string; sourceRiskProfile: RiskProfile } | null | undefined;
  requestedProfile?: RiskProfile | undefined;
  documents?: Array<{ content: string }>;
  memoryContext?: Array<{ content: string }>;
  toolContext?: Array<{ content: string }>;
  imageCount?: number;
};

// This is an intentionally conservative, versioned floor, not a semantic safety
// classifier. Negation, quotations and requests to lower risk do not waive a match.
const rules: Array<{ category: RiskAssessment["signals"][number]["category"]; pattern: RegExp }> = [
  { category: "health", pattern: /\b(?:saglik\w*|tibbi|tedavi\w*|teshis\w*|tani|tanisi|hastalik\w*|ilac\w*|doz\w*|insulin\w*|hamile\w*|gebelik\w*|ameliyat\w*|intihar\w*|health\w*|medical\w*|medication\w*|dosage\w*|dose\w*|diagnos\w*|treatment\w*|pregnan\w*|suicid\w*)\b/u },
  { category: "legal", pattern: /\b(?:hukuk\w*|kanun\w*|mevzuat\w*|mahkeme\w*|dava|davasi|sozlesme\w*|tazminat\w*|yasal\w*|legal\w*|law|laws|lawsuit\w*|jurisdiction\w*|contract\w*|litigation\w*)\b/u },
  { category: "financial", pattern: /\b(?:finans\w*|yatirim\w*|kredi\w*|borc\w*|vergi\w*|hisse\w*|borsa\w*|kripto\w*|emeklilik\w*|financial\w*|invest\w*|loan\w*|mortgage\w*|debt\w*|tax|taxes|stock\w*|crypto\w*|retirement\w*)\b/u },
  { category: "physical-safety", pattern: /\b(?:elektrik\w*|yuksek gerilim|yangin\w*|patlayici\w*|zehir\w*|deprem\w*|tasiyici kolon\w*|electric\w*|high voltage|fire safety|explosive\w*|toxic\w*|poison\w*|structural safety)\b/u },
  { category: "irreversible", pattern: /\b(?:kalici\s+(?:olarak\s+)?sil\w*|geri\s+don(?:u\w*)?\s+olmayan|veritabanini\s+sil\w*|diski\s+(?:sil\w*|bicimlendir\w*)|permanent\w*\s+delet\w*|irreversible\w*|drop\s+(?:database|table)|truncate\s+table|wipe\s+(?:the\s+)?(?:disk|database))\b/u },
];

function normalized(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").replace(/\p{Cf}/gu, "").toLowerCase().replace(/ı/gu, "i");
}

export function assessRequestRisk(input: RiskInput): RiskAssessment {
  const texts: Array<{ source: RiskAssessment["signals"][number]["sources"][number]; text: string }> = [
    { source: "question" as const, text: input.question },
    ...(input.continuationContext ? [{ source: "conversation" as const, text: input.continuationContext.content }] : []),
    ...(input.documents ?? []).map(({ content }) => ({ source: "document" as const, text: content })),
    ...(input.memoryContext ?? []).map(({ content }) => ({ source: "memory" as const, text: content })),
    ...(input.toolContext ?? []).map(({ content }) => ({ source: "tool" as const, text: content })),
  ].map((item) => ({ ...item, text: normalized(item.text) }));
  const signals: RiskAssessment["signals"] = rules.flatMap(({ category, pattern }) => {
    const sources = [...new Set(texts.filter(({ text }) => pattern.test(text)).map(({ source }) => source))];
    return sources.length ? [{ category, sources }] : [];
  });
  // Images are not inspected locally. Unknown visual content gets the higher
  // control floor; never label it safe because no text keyword was found.
  if ((input.imageCount ?? 0) > 0) signals.push({ category: "uninspected-image", sources: ["image"] });
  const requestedProfile = input.requestedProfile ?? "standard";
  return { policyVersion: "risk-rules-v1", requestedProfile, effectiveProfile: requestedProfile === "high" || input.continuationContext?.sourceRiskProfile === "high" || signals.length > 0 ? "high" : "standard", signals };
}

export class RiskConfigurationError extends Error {
  constructor(readonly assessment: RiskAssessment) {
    super("Yüksek riskte en az bir red-team üyesi ve bir çapraz inceleme turu zorunlu. Ön değerlendirmedeki kontrolleri tamamlayın.");
    this.name = "RiskConfigurationError";
  }
}

export function assertRiskConfiguration(assessment: RiskAssessment, members: CouncilMemberConfig[], reviewRounds: number): void {
  if (assessment.effectiveProfile === "high" && (reviewRounds < 1 || !members.some((member) => member.councilRole === "red-team"))) {
    throw new RiskConfigurationError(assessment);
  }
}
