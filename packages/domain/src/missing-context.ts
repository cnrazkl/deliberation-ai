import { z } from "zod";

export const missingContextQuestionSchema = z.object({
  id: z.enum(["legal-jurisdiction", "legal-event-date", "medication-details", "tax-jurisdiction-period"]),
  question: z.string().min(1).max(220),
  reason: z.string().min(1).max(260),
}).strict();
export type MissingContextQuestion = z.infer<typeof missingContextQuestionSchema>;

export class MissingContextError extends Error {
  constructor(readonly questions: MissingContextQuestion[]) {
    super("Kritik bilgi eksik; model çağrısından önce kısa soruları yanıtlayın veya orijinal soruyla devam etmeyi seçin.");
    this.name = "MissingContextError";
  }
}

export const PREFLIGHT_CONTEXT_POLICY_VERSION = "missing-context-v1";
export const preflightQuestionsSchema = z.object({
  policyVersion: z.literal(PREFLIGHT_CONTEXT_POLICY_VERSION),
  questions: z.array(missingContextQuestionSchema).min(1).max(2),
}).strict();

function normalized(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}|\p{Cf}/gu, "").toLowerCase().replace(/ı/gu, "i");
}

/** Bounded prompts for concrete decision requests only. This is not semantic completeness detection. */
export function findCriticalMissingContext(question: string): MissingContextQuestion[] {
  const text = normalized(question);
  const found: MissingContextQuestion[] = [];
  const legal = /\b(?:hukuk\w*|kanun\w*|mevzuat\w*|mahkeme\w*|sozlesme\w*|tazminat\w*|yasal\w*|legal\w*|lawsuit\w*|contract\w*)\b/u.test(text);
  const legalDecision = /\b(?:fesih\w*|feshet\w*|dava\s+ac\w*|itiraz\s+et\w*|imzala\w*|haklarim\w*|yapmali\w*|can\s+i\s+(?:sue|terminate|sign)|should\s+i\s+(?:sue|terminate|sign)|dismiss\w*|evict\w*)\b/u.test(text);
  if (legal && legalDecision) {
    if (!/\b(?:turkiye|turk|almanya|abd|amerika|ingiltere|fransa|avrupa|[a-z]+\s+(?:ulkesinde|eyaletinde)|country|jurisdiction|state|province|germany|turkey|united states|uk|england|france)\b/u.test(text)) {
      found.push({ id: "legal-jurisdiction", question: "Hangi ülke veya eyaletin hukuku geçerli?", reason: "Hukuki kararın dayanağı yargı bölgesine göre değişebilir." });
    }
    if (/(?:dava\s+ac|itiraz\s+et|fesih|feshet|dismiss|evict)/u.test(text) && !/\b(?:\d{4}[-./]\d{1,2}[-./]\d{1,2}|\d{1,2}[-./]\d{1,2}[-./]\d{4}|\d{4}\s+yilinda|today|yesterday|bugun|dun|gecen\s+hafta)\b/u.test(text)) {
      found.push({ id: "legal-event-date", question: "İlgili olay veya işlem hangi tarihte gerçekleşti?", reason: "Tarih, uygulanacak kuralları ve süreleri etkileyebilir." });
    }
  }
  const hasDose = /\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|ml|tablet|capsule|kapsul)\b/u.test(text);
  const hasAge = /\b\d{1,3}\s*(?:yas\w*|year(?:s)? old)\b/u.test(text);
  if (/\b(?:ilac\w*|medication\w*|medicine\w*|insulin\w*)\b/u.test(text) && /\b(?:doz\w*|dosage\w*|dose\w*|artir\w*|azalt\w*|change\w*|adjust\w*)\b/u.test(text)
    && !(hasDose && hasAge)) {
    found.push({ id: "medication-details", question: "Hangi ilaç, mevcut doz ve ilgili kişinin yaşı söz konusu?", reason: "Kişi ve ilaç bilgisi olmadan dozla ilgili değerlendirme eksik kalır." });
  }
  const taxDecision = /\b(?:vergi\w*|tax(?:es|ation)?|tax\s+return)\b/u.test(text) && /\b(?:yapmali\w*|odemeli\w*|beyan\w*|deduct\w*|file\w*|pay\w*|should\s+i)\b/u.test(text);
  if (taxDecision) {
    const hasJurisdiction = /\b(?:turkiye|abd|almanya|ingiltere|country|jurisdiction|turkey|united states|germany|uk)\b/u.test(text);
    const hasPeriod = /\b(?:19|20)\d{2}\b/u.test(text);
    if (!hasJurisdiction || !hasPeriod) found.push({ id: "tax-jurisdiction-period",
      question: !hasJurisdiction && !hasPeriod ? "Hangi ülkenin vergisi ve hangi vergi yılı söz konusu?" : !hasJurisdiction ? "Hangi ülkenin vergisi söz konusu?" : "Hangi vergi yılı söz konusu?",
      reason: "Vergi değerlendirmesi ülkeye ve yıla bağlıdır." });
  }
  return found.slice(0, 2);
}

export type PreflightChoice = "answer" | "original";

export function composeClarifiedQuestion(original: string, choice: PreflightChoice, answer?: string): string {
  if (choice === "original") {
    if (answer?.trim()) throw new Error("Orijinal soruyla devam ederken ayrıca yanıt gönderilemez.");
    return original;
  }
  const clean = answer?.trim();
  if (!clean || clean.length > 1_500) throw new Error("Açıklama 1–1500 karakter olmalı.");
  const composed = `${original}\n\nKullanıcının ek açıklaması:\n${clean}`;
  if (composed.length > 4_000) throw new Error("Açıklamayla birlikte soru 4000 karakteri aşamaz.");
  return composed;
}
