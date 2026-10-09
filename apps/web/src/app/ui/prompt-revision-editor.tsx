"use client";

import { auditPromptRevision, PROMPT_REVISION_VERSION } from "@deliberation-ai/domain";

export function PromptRevisionEditor({ originalQuestion, candidateQuestion, choice, onCandidateChange, onChoiceChange, disabled = false }: {
  originalQuestion: string;
  candidateQuestion: string;
  choice: "original" | "candidate";
  onCandidateChange: (value: string) => void;
  onChoiceChange: (value: "original" | "candidate") => void;
  disabled?: boolean;
}) {
  const audit = auditPromptRevision({ version: PROMPT_REVISION_VERSION, originalQuestion, candidateQuestion, choice });
  return <section className="prompt-revision-editor" aria-label="İstem sürümleri">
    <h3>İstem sürümleri</h3>
    <p className="hint">Yapılandırılmış aday yerel bir metin ekidir; model tarafından iyileştirildiği veya daha doğru sonuç vereceği iddia edilmez. Özgün soru adayın içinde aynen kalmalıdır. Baş ve sondaki boşluklar gönderimden önce temizlenir; gösterilen fark gönderilecek metne göredir.</p>
    <div className="prompt-choice" data-selected={choice === "original"}>
      <label className="check-row"><input type="radio" name="prompt-revision-choice" checked={choice === "original"} disabled={disabled} onChange={() => onChoiceChange("original")} /><span>Özgün soruyu kullan</span></label>
      <pre>{originalQuestion}</pre>
    </div>
    <div className="prompt-choice" data-selected={choice === "candidate"}>
      <label className="check-row"><input type="radio" name="prompt-revision-choice" checked={choice === "candidate"} disabled={disabled} onChange={() => onChoiceChange("candidate")} /><span>Düzenlenebilir adayı kullan</span></label>
      <textarea aria-label="Yapılandırılmış aday istem" value={candidateQuestion} maxLength={4000} disabled={disabled}
        onChange={(event) => onCandidateChange(event.target.value)} />
    </div>
    <details><summary>Özgün metne göre fark ve denetim</summary>
      {audit.originalPreserved ? <>
        <p>Eklenen ön metin:</p><pre>{audit.prefix || "(yok)"}</pre>
        <p>Eklenen son metin:</p><pre>{audit.suffix || "(yok)"}</pre>
      </> : <p className="inline-warning">Adayda özgün metin tam ve tek kez korunmuyor; bu aday gönderilemez.</p>}
      <p className="hint">Yerel risk işaretleri: özgün {audit.originalRiskProfile === "high" ? "yüksek" : "standart"} · seçili {audit.selectedRiskProfile === "high" ? "yüksek" : "standart"}. Nihai risk denetimi seçilen metin ve eklerle sunucuda tekrar yapılır.</p>
      {audit.issues.length > 0 ? <ul>{audit.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}
    </details>
    {choice === "candidate" && !audit.canSelectCandidate ? <p className="inline-warning">Bu aday denetimi geçmedi. Özgün soruyu seçin veya adayı düzeltin.</p> : null}
  </section>;
}
