import { CouncilWorkbench } from "./ui/council-workbench";
import { LocalDiagnosticsPanel } from "./ui/local-diagnostics-panel";

export default function Home() {
  return (
    <main className="page-shell">
      <header className="hero">
        <div className="eyebrow">YEREL SÜRÜM · ÇOK MODELLİ KONSEY</div>
        <h1>Bir soruyu 2–6 bağımsız bakışla inceleyin.</h1>
        <p>
          Kayıtlı bağlantılarla farklı sağlayıcıları, düşünme seviyelerini ve
          red-team karşılaştırmasını görev başına seçebilirsiniz.
        </p>
      </header>
      <LocalDiagnosticsPanel />
      <CouncilWorkbench />
      <footer>
        Uzlaşı doğruluk değildir · Çalışmalar PostgreSQL üzerinde kalıcı olarak saklanır
      </footer>
    </main>
  );
}
