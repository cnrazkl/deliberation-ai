import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { provisionLocalRoot } from "../src/local-auth";
import { closeDatabase } from "../src/database";

try {
  if (process.argv.length !== 3) throw new Error();
  const file = resolve(process.argv[2]!);
  if (!statSync(file).isFile() || statSync(file).size > 1024) throw new Error();
  const password = readFileSync(file, "utf8").trim();
  const root = await provisionLocalRoot(password);
  console.log(JSON.stringify({ status: "provisioned", username: root.username, ownerId: root.ownerId }));
} catch { console.error("Root hesabı hazırlanamadı. Yerel parola dosyasını ve migration durumunu kontrol edin."); process.exitCode = 1; }
finally { await closeDatabase(); }
