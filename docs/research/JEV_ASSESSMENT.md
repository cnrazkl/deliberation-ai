# Jev ve DeliberationAI uygunluk değerlendirmesi

Araştırma tarihi: **21 Eylül 2026**. Durum: araştırma tamamlandı; deneysel entegrasyon planlandı, uygulanmadı. Bu çalışma sırasında hiçbir model API çağrısı yapılmadı.

## Karar

**Jev'i isteğe bağlı bir iddia–kaynak inceleme yardımcısı adayı olarak plana ekliyoruz.** Önce Türkçe ve insan tarafından kaynak üzerinden etiketlenmiş örneklerle doğruluk ölçülecek. Konseyin yerini alması, nihai hakem olması veya kanıt durumlarını otomatik değiştirmesi kabul edilmiyor. Mevcut TypeScript, PostgreSQL ve worker mimarisini değiştirmeye gerek yok.

Beklenen fayda, bir iddianın verilen kaynak parçasınca desteklenmediğini ya da çeliştiğini fark etmeye yardım etmesi. Bu henüz projemizde ölçülmüş bir kazanım değil. Hız ve maliyet ancak doğruluk koşulları sağlandıktan sonra karşılaştırma ölçütü olacak. Teknik karar [ADR-0017](../adr/0017-advisory-decision-evaluation.md), kabul koşulları [değerlendirme planında](../EVALUATION.md).

## JEV nedir, karar ağacı mı?

Bahsedilen ürün, TypeSafe AI'ın **Jev** modeli. Üretici bunu 15 Eylül 2026'da “System One” sınıfında tanıttı; paralel örnekleme ve RLCD adlı eğitim yaklaşımından söz ediyor. Açık bilgiler, iç mimariyi klasik bir karar ağacı olarak nitelemek için yeterli değil. Karar ağacı benzeri uygulama akışlarına yerleştirilebilen bir karar modeli demek daha doğru. [Üreticinin tanıtımı](https://typesafe.ai/blog/introducing-system-one-models-and-jev).

Serbest cevap yazmak yerine metin/JSON girdisi üzerinde tanımlanan dar soruları yanıtlıyor: `Choice` seçenek seçiyor, `Score` tanımlı ölçeğe göre puanlıyor, `Noul` evet olasılığı döndürüyor. Bu nedenle uzun gerekçeli konsey üyesi veya araştırma yapan sohbet modeliyle aynı görevi üstlenmiyor. [Ürün belgeleri](https://docs.typesafe.ai/introduction), [System One sınırları](https://docs.typesafe.ai/concepts/system-one).

## İddiaların kanıt gücü

| İddia / gözlem | Kaynak ve anlamı | Bizim kararımıza etkisi |
| --- | --- | --- |
| 193,6 kat hız ve 444,6 kat maliyet avantajı | Üreticinin dört iş akışından elde ettiği tanıtım sonuçları; evrensel oranlar değil. [Tanıtım](https://typesafe.ai/blog/introducing-system-one-models-and-jev) | Mimariyi bu sayılara dayanarak değiştirmiyoruz. |
| “Halüsinasyon yok” | Tanımlanan çıktı biçiminin dışına çıkmama iddiası; yanlış seçenek seçememe veya olgusal doğruluk garantisi değil. [Tanıtım](https://typesafe.ai/blog/introducing-system-one-models-and-jev) | Şema geçerliliği ile doğruluğu ayrı ölçüyoruz. |
| Üreticinin doğruluk karşılaştırması | Referans etiketler GPT-6 Astra ile Claude Fable 5.1'in yüksek düşünme düzeyindeki değerlendirmelerinden oluşturuluyor. İnsan tarafından doğrulanmış gerçeklik yerine bu referansla uyumu ölçüyor. [Değerlendirme yöntemi](https://evals.typesafe.ai/) | Model çoğunluğunu gerçek kabul etmeyen ürün ilkemiz için tek başına yeterli değil. |
| Küçük bir dış deneyde yüksek başarı | TrueStandard'ın kendi yayımladığı deney: altı kaynak parçasından 108 etiketli iddia; Jev %96,3, Gemini 3.1 Flash Lite %94,4, Claude Haiku 4.5 %93,5. Jev'in ECE değeri 0,0660; Gemini'nin 0,0611. [Deney raporu](https://truestandard.ai/blog/jev-accuracy-tested) | Umut verici; yalnızca birkaç örneklik fark, az sayıda belge ve tek deney. Tarafımızdan yeniden üretilmedi; ticari bir ürün ekibinin raporu. Türkçe/genel üstünlük veya kusursuz kalibrasyon kanıtı değil. |
| Hız farkının bir kısmı çağrı düzeninden geliyor | Başka bir TrueStandard deneyi tek çağrıda 1,7 kat; sıralı altı çağrı ile toplu değerlendirmeyi karşılaştırınca 100,7 kat bildiriyor. [Hız deneyi](https://truestandard.ai/blog/is-jev-really-193x-faster) | Aynı iş, bağlam ve uygun toplu/paralel çağrı düzeniyle karşılaştırma yapılmalı. |

Bu kaynaklar ürünün varlığını ve denenmeye değer olduğunu destekliyor; bizim uygulamamızda doğruluğu artırdığını göstermiyor.

## Doğruluk açısından kritik sınırlar

Üretici; sayma, matematik, tarih karşılaştırma, dolaylı/çok adımlı sorular, ilgisiz içerikle uzayan bağlam ve yönlendirici metinlerde zayıflıkları belgeliyor. Kaynak metnindeki kötü niyetli talimatlar kararı etkileyebiliyor. Sayı/tarih hesapları kodda yapılmalı; yalnız gerekli metin gönderilmeli, ama anlamı değiştiren bağlam sessizce kesilmemeli. [Jev 1.13 bilinen zayıflıklar](https://docs.typesafe.ai/model-jaggedness/jev-1.13).

`Choice`/`Score` çıktısındaki `confidence`, dağılımın yoğunluğunu ifade ediyor; “bu kararın doğru olma olasılığı” ile eşit değil. `Noul` ayrı bir confidence alanı sunmuyor. Biz tüm seçenek olasılıklarını saklayacağız; örneğin 0,9'u doğrudan “%90 doğru” diye sunmayacağız. [Confidence tanımı](https://docs.typesafe.ai/confidence).

Güncel doğrudan model kimliği `jev-1.13.0`. İngilizce ana eğitim dili; Türkçe başarı varsayılamaz. Hareketli `latest` etiketi yerine sürüm sabitlenecek. Doğrudan API bütçesi tüm istek için 64k, state + en uzun soru için 32k token. Açıklanan fiyat milyon girdi tokenı başına 0,042 USD; çıktı ücretsiz. Bunlar araştırma tarihindeki bilgiler; uygulamada sabit garanti sayılmayacak. İncelenen belgeler barındırılan hizmeti anlatıyor; Ollama/vLLM'de çalıştırılabilir resmî bir yerel paket bu incelemede doğrulanmadı. [Model belgeleri](https://docs.typesafe.ai/models).

## Bizim projede nerede yararlı olabilir?

| Kullanım | Değerlendirme |
| --- | --- |
| Kaynak parçası ile tek iddia arasındaki destek/çelişki ilişkisi | İlk deney için uygun aday; insan incelemesine yardımcı işaret. |
| Kaynakların alakasızlığını veya eksik kanıtı işaretleme | Aynı değerlendirme içinde araştırılabilir; kaynağı otomatik eleme yok. |
| Nihai doğru cevabı seçmek, azınlık görüşlerini bastırmak | Uygun değil; konseyin otoritesiz yapısını bozar. |
| Hangi modelin daha az düşünmesi gerektiğini belirlemek veya araştırmayı atlamak | Bu aşamada kapsam dışı; doğruluk pahasına tasarruf hedeflemiyoruz. |
| Kaynağın güvenilir/güncel olduğunu onaylamak | Metin desteğinden ayrı bir sorun; insan incelemesi devam eder. |
| İnternetten arama yapıp kaynak toplamak | Belgelenen karar arayüzünün görevi değil; mevcut web araması ve planlanan güvenli kaynak getirme katmanı devam eder. |

Örnek: iddia “ürün 2025'te çıktı”, kaynak parçası “ürün 2024'te tanıtıldı” diyorsa inceleme adayı oluşturulabilir. Bu sonuç kaynağın kendisinin doğru olduğunu veya iki ifadenin aynı olaydan söz ettiğini kanıtlamaz; bağlam ve tarih anlamı korunmalıdır.

## Bağlantı ve uygulama kararı

Doğrudan TypeSafe çağrısı `POST https://api.typesafe.ai/v1/systemone` üzerinden `state` ve `questions` gönderiyor. Soru anahtarları modelin gördüğü talimatlar değil; her soru değerlendireceği öğeyi açıkça belirtmeli. Mevcut sohbet çıktısı sözleşmemiz buna uymuyor. [API sözleşmesi](https://docs.typesafe.ai/api).

OpenRouter da Jev'i sunuyor; ancak resmî örnek `alpha.decisions.create` kullanıyor. Mevcut Chat Completions bağlantısına sadece `typesafe/jev-1.13` yazmak yeterli kabul edilmeyecek. Önce doğrudan karar adaptörü, sonra ayrı bir OpenRouter karar yeteneği değerlendirilecek. Labs özellikleri deneysel; uygulama sırasında sözleşme tekrar doğrulanmalı. [OpenRouter örneği](https://openrouter.ai/labs/jev/compile), [Labs](https://openrouter.ai/labs).

Yerel uygulamadan barındırılan Jev'e istek göndermek seçilen metni bilgisayar dışına çıkarır. Üretici eğitimde kullanmama taahhüdü bildiriyor; bu her hesap için sıfır saklama garantisi değildir. Kaynak metni paylaşımı ayrı ve açık bir seçim olacak. [Veri işleme açıklaması](https://docs.typesafe.ai/models), [gizlilik politikası](https://typesafe.ai/legal/privacy-policy).

## Sıra ve tamamlanma ölçütü

1. **DA-027 — tamamlandı:** araştırma, mimari karar ve dokümanların güncellenmesi.
2. **DA-028 — tamamlandı:** Türkçe ağırlıklı sentetik kaynak/iddia düzeneği, insan etiketleme yönergesi, ölçüm araçları ve dondurulmuş ön kayıt. API anahtarı gerektirmez.
3. **DA-029 — tamamlandı:** varsayılanı kapalı ayrı karar sözleşmesi, sahte ve doğrudan TypeSafe adaptörleri, şifreli kayıtlar, işlem makbuzları ve etkisiz gözlem modu. Normal testlerde ağ çağrısı yapılmaz.
4. **DA-030 — ertelendi:** kullanıcı daha sonra anahtar ve model seçtiğinde gerçek, sürümü sabitlenmiş karşılaştırmalı doğruluk deneyi. Sonuç yetersizse Jev kapalı/gözlem modunda kalır.
5. **DA-031 — arayüz hazır, terfi koşullu:** kaynak metni, olasılıklar ve sürümler gözlem sonucu olarak gösterilebilir; danışman önerisi olarak terfi yalnız kalite ölçütleri sağlanırsa açılır. Hiçbir kanıt durumu otomatik değişmez.

Güvenli uygulama yönetimli kaynak getirme işi **DA-032** olarak korunuyor. Bu iş Jev'in başarısına veya canlı API erişimine bağlı değil. İlk deney elle kaydedilmiş sabit kaynak parçalarıyla yapılabilir. Sonraki uygulama adımlarının ayrıntıları [TASKS](../TASKS.md) ve [ROADMAP](../ROADMAP.md) içinde.
