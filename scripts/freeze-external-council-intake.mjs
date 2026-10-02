// Curated primary-source excerpts inspected 2026-09-27. No network or gold labels.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const capturedAt = new Date().toISOString(); // Curated snapshot creation time, not an HTTP Last-Modified value.
const usage = "Short US federal agency text excerpt; public-domain government information. Logos, images, third-party quotations and endorsement excluded.";
const definitions = [
  ["pluto", "pluto", "astronomy", "Pluto Facts", "https://science.nasa.gov/dwarf-planets/pluto/facts/", null,
    "Discovered in 1930, Pluto was long considered our solar system's ninth planet. But after the discovery of similar worlds deeper in the Kuiper Belt, Pluto was reclassified as a dwarf planet in 2006 by the International Astronomical Union."],
  ["planet-x", "pluto", "astronomy", "Hypothetical Planet X", "https://science.nasa.gov/solar-system/planet-x/", "2025-03-12",
    "Pluto was considered the ninth major planet in our solar system until the definition of “planet” was changed by the International Astronomical Union (IAU) in 2016. This new definition reclassified Pluto as a dwarf planet."],
  ["sun", "solar-rotation", "astronomy", "Our Sun: Facts", "https://science.nasa.gov/sun/facts/", null,
    "Measuring a “day” on the Sun is complicated. The Sun is made of super-hot, electrically charged gas called plasma. This plasma rotates at different speeds on different parts of the Sun. At its equator, the Sun completes one rotation in 25 Earth days. At its poles, the Sun rotates once on its axis every 36 Earth days.\nThe part of the Sun we see from Earth – the part we call the surface – is the photosphere. The Sun doesn’t actually have a solid surface because it’s a ball of plasma."],
  ["earthquake", "earthquake-prediction", "earth-science", "Can you predict earthquakes?", "https://www.usgs.gov/faqs/can-you-predict-earthquakes", null,
    "No. Neither the USGS nor any other scientists have ever predicted a major earthquake. We do not know how, and we do not expect to know how any time in the foreseeable future. USGS scientists can only calculate the probability that a significant earthquake will occur in a specific area within a certain number of years.\nAn earthquake prediction must define 3 elements: 1) the date and time, 2) the location, and 3) the magnitude."],
  ["volcano", "volcano-forecast", "earth-science", "How can we tell when a volcano will erupt?", "https://www.usgs.gov/faqs/how-can-we-tell-when-a-volcano-will-erupt", null,
    "Most volcanoes provide warnings before an eruption. Magmatic eruptions involve the rise of magma toward the surface, which normally generates detectable earthquakes. It can also deform the ground surface and cause anomalous heat flow or changes in the temperature and chemistry of the groundwater and spring waters. Steam-blast eruptions, however, can occur with little or no warning as superheated water flashes to steam.\nThese precursors do not indicate the type or scale of an expected eruption (that information is best obtained by mapping previous eruptions). Precursors can continue for weeks, months, or even years before eruptive activity begins, or they can subside at any time and not be followed by an eruption."],
  ["hurricane", "hurricane-alert", "weather-ocean", "Hurricane watch and warning", "https://oceanservice.noaa.gov/facts/watch-warning.html", "2026-09-23",
    "Hurricane warnings indicate that hurricane conditions (sustained winds of 74 mph or higher) are expected somewhere within the specified area. Because hurricane preparedness activities become difficult once winds reach tropical storm force (sustained winds of 39 to 73 mph), the hurricane warning is issued 36 hours in advance of the anticipated onset of tropical-storm-force winds to allow for important preparation.\nA hurricane watch means that hurricane conditions (sustained winds of 74 mph or higher) are possible within the specified area. A hurricane watch is issued 48 hours in advance of the anticipated onset of tropical-storm-force winds in an area."],
  ["tides", "tidal-range", "weather-ocean", "What are tides?", "https://oceanservice.noaa.gov/facts/tides.html", "2026-09-23",
    "Tides are very long-period waves that move through the ocean in response to the forces exerted by the moon and sun. Tides originate in the ocean and progress toward the coastlines where they appear as the regular rise and fall of the sea surface.\nWhen the highest part, or crest, of the wave reaches a particular location, high tide occurs; low tide corresponds to the lowest part of the wave, or its trough. The difference in height between the high tide and the low tide is called the tidal range."],
  ["antibiotics", "antibiotic-scope", "health", "Healthy Habits: Antibiotic Do's and Don'ts", "https://www.cdc.gov/antibiotic-use/about/", "2025-09-23",
    "Some infections caused by bacteria can still get better without antibiotics. You DO NOT need antibiotics for some common bacterial infections, including many sinus infections and some ear infections.\nAntibiotics DO NOT work on viruses.\nTaking antibiotics when you do not need them will not help you, and their side effects can still cause harm. Talk to a healthcare professional about the best treatment for you when you are sick. Never pressure a healthcare professional to prescribe an antibiotic."],
  ["co", "generator-safety", "health", "Carbon Monoxide Poisoning Basics", "https://www.cdc.gov/carbon-monoxide/about/index.html", "2026-01-12",
    "Carbon monoxide (CO) is an odorless, colorless gas that kills without warning.\nNever use a generator inside your home or garage, even if doors and windows are open.\nOnly use generators outside, more than 20 feet away from any windows, doors, and vents.\nWhen using a generator, use a battery-powered or battery backup CO detector in your home."],
  ["si", "si-units", "measurement", "Definitions of SI Base Units", "https://www.nist.gov/si-redefinition/definitions-si-base-units", null,
    "The second is defined by taking the fixed numerical value of the cesium frequency ∆νCs, the unperturbed ground-state hyperfine transition frequency of the cesium-133 atom, to be 9,192,631,770 when expressed in the unit Hz, which is equal to s−1.\nThe meter is defined by taking the fixed numerical value of the speed of light in vacuum c to be 299,792,458 when expressed in the unit m s−1, where the second is defined in terms of ∆νCs."],
  ["interest", "compound-interest", "finance", "How does compound interest work?", "https://www.consumerfinance.gov/ask-cfpb/how-does-compound-interest-work-en-1683/", "2023-10-19",
    "Compound interest is when you earn interest on the money you’ve saved and on the interest you earn along the way.\nAmount you start with: $1,000. How much you earn: 5 percent. How often you calculate interest: Once a year. Amount after the first year: $1,050. Amount after the second year: $1,102.50."],
];
// Source extraction normalizes whitespace and flattens NIST math/CFPB table typography;
// these transformations are recorded here and never represented as byte-identical HTML.
const sources = definitions.map(([id, family, domain, title, url, publishedAt, text]) => ({
  id, documentId: id, family, domain, title, url, capturedAt, publishedAt, usage,
  text, sha256: createHash("sha256").update(text).digest("hex"),
}));
const groups = [
  { sources: ["pluto", "planet-x"], split: "held_out", tags: ["source_conflict", "temporal", "numeric", "minority"], questions: [
    "İki kaynağa göre Plüton'un yeniden sınıflandırıldığı tarih nedir? Uyuşmazlığı kaynak atıflarıyla koru; tek tarihi kesinleştirme.",
    "Bir özet yalnız 2016 yazarsa hangi karşı kanıtı kaybeder? Her iki belgedeki iddiayı ayrı belirt.",
    "What do these sources agree on, and where do their dates disagree? Preserve both attributions.",
    "Pluto reclassification: tarih ve sınıflandırma iddialarını ayır; source conflict açık kalsın.",
  ] },
  { sources: ["sun"], split: "development", tags: ["numeric", "condition", "entity", "negation"], questions: [
    "Güneşin dönüş süresi neden tek sayıyla anlatılamaz? Ekvator ve kutup koşullarını açıkla.",
    "Güneşin görünür yüzeyi katı mıdır ve adı nedir? Kaynaktaki olumsuzlamayı koru.",
    "Are 25 and 36 Earth days contradictory rotation estimates? Explain their scopes from the source.",
    "Güneşin tamamı 25 günde döner ifadesini kaynak sınırlarıyla düzelt; iki süreyi de belirt.",
  ] },
  { sources: ["earthquake"], split: "development", tags: ["negation", "temporal", "condition", "red_team"], questions: [
    "Kaynağa göre kesin deprem tahmini ile olasılık hesabı arasındaki fark nedir?",
    "Belirli bir bölgede yıllar içindeki deprem olasılığı yarının kesin saatini verir mi? Kaynağa göre değerlendir.",
    "Which three elements must an earthquake prediction define, and what can USGS calculate?",
    "Birisi kesin deprem tahmini yaptığını söylüyor. Kaynaktan hareketle bu iddiaya itirazı ve ölçütleri açıkla.",
  ] },
  { sources: ["volcano"], split: "held_out", tags: ["negation", "condition", "temporal", "red_team"], questions: [
    "Her volkanik patlamanın mutlaka önceden uyarı vereceği söylenebilir mi? İstisnayı koru.",
    "Öncü belirtilerin sürmesi kesin patlama zamanı veya ölçeği verir mi? Belirsizliği açıklayınız.",
    "What warning differences does the excerpt describe for magmatic and steam-blast eruptions?",
    "Volcano precursors: belirtiler weeks veya years sürerse kesinlik artar mı? Kaynaktaki sınırı koru.",
  ] },
  { sources: ["hurricane"], split: "development", tags: ["numeric", "temporal", "condition", "entity"], questions: [
    "Watch ile warning arasındaki olasılık ve zaman farklarını rüzgâr eşikleriyle açıkla.",
    "36 ve 48 saat hangi rüzgârın başlamasına göredir? Yanlış eşik kullanımını önle.",
    "Compare hurricane watches and warnings without exchanging possible and expected or their lead times.",
    "Kasırga uyarısını 48 saat ve watch durumunu 36 saat olarak özetlemek kaynağa uygun mu? Düzelt.",
  ] },
  { sources: ["tides"], split: "held_out", tags: ["entity", "condition", "numeric"], questions: [
    "Gelgit aralığı nedir; yüksek ve alçak su hangi dalga kısımlarına karşılık gelir?",
    "Gelgitlerin nedeni yalnız Ay mıdır? Kaynağın saydığı etkenleri ve kıyıda görülen sonucu açıkla.",
    "Define tidal range and distinguish the crest and trough without inventing a numerical range.",
    "Tidal range bir süre mi yükseklik farkı mı? Kaynaktaki high tide ve low tide tanımlarını kullan.",
  ] },
  { sources: ["antibiotics"], split: "development", tags: ["negation", "condition", "minority", "red_team"], questions: [
    "Antibiyotikler virüsler ve tüm bakteriyel enfeksiyonlar için gerekli midir? İstisnaları koru.",
    "Gereksiz antibiyotiğin zararsız olduğu iddiasını kaynağa göre değerlendir.",
    "Preserve both the bacterial-infection exceptions and the statement about viruses in a short summary.",
    "Çoğunluk tüm bakteriyel enfeksiyonlara antibiyotik gerekir diyorsa kaynakta hangi karşı örnekler var?",
  ] },
  { sources: ["co"], split: "held_out", tags: ["negation", "numeric", "condition", "red_team"], questions: [
    "Pencereleri açık garajda jeneratör kullanılabilir mi? Dışarıdaki mesafe ve dedektör koşulunu koru.",
    "Karbonmonoksit kokusuzsa tehlikesiz midir? Kaynaktaki korunma koşullarını özetle.",
    "What does the source require for generator placement and CO detection? Preserve the strict distance wording.",
    "Generator safety: tam 20 feet yeterli denebilir mi? More than koşulunu ve garaj yasağını koru.",
  ] },
  { sources: ["si"], split: "development", tags: ["numeric", "entity", "condition"], questions: [
    "Saniye ve metre hangi fiziksel niceliklerle tanımlanır? Sayıları ve birimleri karıştırmadan yaz.",
    "Işık hızı değerindeki vakum koşulu neden özette korunmalı? Kaynağın verdiği tanımı aktar.",
    "Distinguish the cesium frequency from the speed of light, preserving every digit and unit.",
    "Saniyenin tanımındaki atom hangisidir, metre saniyeye nasıl bağlıdır? Kaynağa bağlı kal.",
  ] },
  { sources: ["interest"], split: "held_out", tags: ["numeric", "temporal", "condition"], questions: [
    "Örnekte birinci ve ikinci yıl bakiyeleri neden farklı artar? Anapara, oran ve sıklığı belirt.",
    "Bu örnek aylık bileşik faiz hesabı mıdır? Dönem koşulunu ve ikinci yıl tutarını koru.",
    "Summarize the example's starting principal, annual rate, compounding frequency and both year-end amounts.",
    "İkinci yıl sonunu 1100 dolar yazmak kaynağa uygun mu? Faizin faizini açıklayarak değerlendir.",
  ] },
];
const cases = groups.flatMap((group) => group.questions.map((question, index) => ({
  id: `case-external-${group.sources[0]}-${index + 1}`, sourceIds: group.sources,
  family: sources.find((source) => source.id === group.sources[0]).family,
  split: group.split, language: index === 2 ? "en" : index === 3 && ["pluto", "volcano", "tides", "co"].includes(group.sources[0]) ? "mixed" : "tr",
  riskTags: group.tags, question,
})));
const suite = { schemaVersion: "external-council-suite-v1", description: "40 implementer-selected external-domain candidate questions; 26 Turkish, 10 English, 4 mixed. US agency excerpts with attributed source conflict. Not independent gold or population-representative sampling. Source language is English; question/answer language is recorded separately.", sources, cases };
if (process.argv.length !== 3 || process.argv[2] !== "--write") throw new Error("Explicit --write required; existing snapshots are never overwritten.");
writeFileSync(resolve(import.meta.dirname, "../docs/evaluation/COUNCIL_EXTERNAL_SUITE.json"), `${JSON.stringify(suite, null, 2)}\n`, { flag: "wx" });
console.log("External candidate suite frozen: 40 cases, 11 source excerpts; no labels or network calls.");
