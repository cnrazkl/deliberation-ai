import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Curated source lines and questions. --write deliberately replaces the frozen snapshot.
// These are candidate questions, not human-authored gold claims or model predictions.
const selections = [
  ["PRODUCT", 3, "tr", ["numeric", "minority"], "Konsey kaç üyeden oluşabilir ve üyeler anlaşınca bu neden kanıt sayılmaz?"],
  ["PRODUCT", 25, "tr", ["condition", "entity"], "Otomatik web araması hangi sağlayıcılarda kullanılabilir; gelen bağlantılar doğrulanmış kanıt olur mu?"],
  ["PRODUCT", 37, "tr", ["red_team", "minority"], "Red-team üyesinin iddiaları analistlerin ortak görüşüne katılır mı, hangi bölümde korunur?"],
  ["PRODUCT", 51, "tr", ["condition", "negation"], "Yüksek riskli bir çalışmanın tamamlandı sayılması için hangi denetimler gerçekten başarılı olmalıdır?"],
  ["ARCHITECTURE", 18, "tr", ["temporal", "numeric"], "İş kuyruğa alınırken üyelerin ayarları nasıl sabitlenir ve çapraz inceleme ne zaman başlar?"],
  ["ARCHITECTURE", 24, "tr", ["condition", "negation"], "Önizlemeden sonra istek değişirse yürütme sınırı bunu nasıl tespit eder?"],
  ["ARCHITECTURE", 32, "tr", ["temporal", "condition"], "Tarayıcı olay akışı koparsa ilerleme hangi kalıcı bilgiyle yeniden yakalanır?"],
  ["ARCHITECTURE", 38, "tr", ["entity", "numeric"], "Yapılandırılmış iddiaların rapora aktarımı hangi kimlik ve alanlar üzerinden denetlenir?"],
  ["DATA_MODEL", 5, "tr", ["temporal", "negation"], "Eski çalışmalarda istem parmak izi neden boş olabilir; yeni çalışmalarda hangi bilgiler dondurulur?"],
  ["DATA_MODEL", 12, "tr", ["condition", "entity"], "Geçersiz sağlayıcı çıktısı hangi işlem kaydında saklanabilir ve ayrıştırılmış çıktı ne olur?"],
  ["DATA_MODEL", 14, "tr", ["temporal", "condition"], "Bir kanıt kaynağında hangi alanlar sonradan değiştirilemez, hangileri inceleme durumudur?"],
  ["DATA_MODEL", 23, "tr", ["condition", "temporal"], "Çalışma oluşturma ile pg-boss işinin kaydı birbirinden kopabilir mi; veri modeli neyi garanti eder?"],
  ["ORCHESTRATION", 3, "tr", ["numeric", "temporal"], "İlk turda üyeler birbirinin çıktısını görür mü ve kaç ek çapraz inceleme turu vardır?"],
  ["ORCHESTRATION", 5, "tr", ["condition", "negation"], "Çapraz incelemeye hangi üyeler katılır ve inceleyici kendi yanıtını ya da ham metni görür mü?"],
  ["ORCHESTRATION", 21, "tr", ["condition", "minority"], "Kısmi tamamlanma hangi başarısızlıkta oluşur ve aynı modelin iki koltuğu bağımsız uzlaşı sayılır mı?"],
  ["ORCHESTRATION", 29, "tr", ["negation", "minority"], "İddia aktarımı denetimi hangi kayıpları bulur ve kaynak metinden tüm önemli iddiaların çıkarıldığını kanıtlar mı?"],
  ["PROMPTS", 5, "tr", ["condition", "entity"], "Sağlayıcılara gönderilen ortak talimat üyelerden nasıl bir çıktı ve belirsizlik beyanı ister?"],
  ["PROMPTS", 7, "tr", ["negation", "condition"], "PDF içindeki komutlar sistem talimatının yerini alabilir mi ve PDF metni kimlere gönderilir?"],
  ["PROMPTS", 9, "tr", ["negation", "minority"], "Çapraz inceleme talimatı çoğunluğu hakikat sayar mı; her eş için hangi kararlar istenir?"],
  ["PROMPTS", 13, "tr", ["temporal", "negation"], "Önceki çalışmadan seçilen bellek metni yeni görevde doğrulanmış gerçek veya talimat sayılır mı?"],
  ["PROVIDERS", 14, "tr", ["entity", "condition"], "DeepSeek ve Qwen için uyumlu uç nokta adresi nasıl belirleniyor; yerel sunucular anahtarsız olabilir mi?"],
  ["PROVIDERS", 39, "tr", ["condition", "negation"], "GPT-5 Pro için max düşünme seviyesi varsayılabilir mi; seviye göreve göre değiştirilebilir mi?"],
  ["PROVIDERS", 45, "tr", ["condition", "negation"], "Otomatik web araması açılınca her API modeli sınırsız internet erişimi kazanır mı?"],
  ["PROVIDERS", 63, "tr", ["condition", "negation"], "PDF ve görseller hangi turda, hangi üyelerle paylaşılır; taranmış PDF nasıl ele alınır?"],
  ["SECURITY", 5, "en", ["entity", "condition"], "Which sensitive fields are encrypted before PostgreSQL, and what prevents ciphertext from being moved between records?"],
  ["SECURITY", 15, "en", ["negation", "minority"], "What information may cross from one provider to another during peer review, and what stays excluded?"],
  ["SECURITY", 31, "en", ["condition", "entity"], "Which URL and DNS checks prevent the application's research fetch from reaching private targets?"],
  ["SECURITY", 37, "en", ["numeric", "condition"], "What are the file-count and size limits for attachments, and how is PDF text checked before storage?"],
  ["OPERATIONS", 12, "en", ["temporal", "condition"], "If the web and worker processes stop, what happens to PostgreSQL jobs when they start again?"],
  ["OPERATIONS", 14, "en", ["numeric", "negation"], "Does the pre-submit token preview consume provider tokens, and where would exact billed usage come from?"],
  ["OPERATIONS", 20, "en", ["temporal", "condition"], "When are local schedules first eligible to run, and what happens to an overdue occurrence after a worker restart?"],
  ["OPERATIONS", 26, "en", ["condition", "temporal"], "Why must the database and local environment file be backed up together before changing the encryption key?"],
  ["TESTING", 16, "en", ["negation", "condition"], "What do perfect predictions on the frozen fixture establish about real-world model accuracy?"],
  ["TESTING", 28, "en", ["numeric", "negation"], "Do the council coverage unit cases validate real extraction recall or only calculation and report binding?"],
  ["TESTING", 32, "en", ["entity", "negation"], "Can the labeling-gate tests prove that reviewers were independent humans?"],
  ["TESTING", 38, "en", ["condition", "temporal"], "When are live provider tests run, and can they incur cost in ordinary checks?"],
  ["ROADMAP", 5, "mixed", ["temporal", "entity"], "Local foundation kapsamında PostgreSQL ve provider connection işleri tamamlandı mı?"],
  ["ROADMAP", 6, "mixed", ["red_team", "minority"], "Council slices içinde red-team ve claim transfer audit hangi kapsamda teslim edildi?"],
  ["ROADMAP", 7, "mixed", ["condition", "negation"], "Research/tools slices içinde PDF ve MCP var mı; local demo mode hâlâ kullanıcıya sunuluyor mu?"],
  ["ROADMAP", 8, "mixed", ["numeric", "condition"], "Remaining gates listesinde ek review rounds ve semantic contradiction hâlâ açık mı?"],
];

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "docs/evaluation/COUNCIL_CANDIDATE_INTAKE.json");
if (process.argv[2] !== "--write" || process.argv.length !== 3) {
  throw new Error("Frozen intake replacement requires explicit --write.");
}
if (selections.length !== 40) throw new Error("Expected exactly 40 curated cases.");
const capturedAt = new Date().toISOString();
const counts = new Map();
const cases = selections.map(([document, line, language, riskTags, question]) => {
  const sourceRef = `repo:docs/${document}.md`;
  const lines = readFileSync(resolve(root, "docs", `${document}.md`), "utf8").split(/\r?\n/);
  const sourceText = lines[line - 1];
  if (!sourceText || sourceText.length < 80 || sourceText.startsWith("#") || sourceText.startsWith("|")) {
    throw new Error(`Invalid source line: ${sourceRef}:${line}`);
  }
  const sequence = (counts.get(document) ?? 0) + 1;
  counts.set(document, sequence);
  return {
    id: `case-${document.toLowerCase().replaceAll("_", "-")}-${String(sequence).padStart(2, "0")}`,
    sourceId: `source-${document.toLowerCase().replaceAll("_", "-")}`,
    sourceRef,
    capturedAt,
    sourceSha256: createHash("sha256").update(sourceText, "utf8").digest("hex"),
    split: ["PRODUCT", "ARCHITECTURE", "DATA_MODEL", "ORCHESTRATION", "PROMPTS"].includes(document)
      ? "development" : "held_out",
    language,
    riskTags,
    question,
    sourceText,
  };
});
writeFileSync(output, `${JSON.stringify({
  schemaVersion: "council-coverage-intake-v1",
  description: "Forty candidate question/source pairs from the owner's local DeliberationAI documentation; no human gold labels or model evaluation.",
  cases,
}, null, 2)}\n`, "utf8");
console.log(`Frozen ${cases.length} candidate cases from ${counts.size} source documents at ${capturedAt}.`);
