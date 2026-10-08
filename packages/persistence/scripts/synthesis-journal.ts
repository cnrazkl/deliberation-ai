import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { decryptJson, encryptJson } from "../src/crypto";
import type { SynthesisAttempt, SynthesisJournal } from "@deliberation-ai/application";
import type { SynthesisStage } from "@deliberation-ai/contracts";

/** Immutable encrypted local artifacts; submitted is durable before network starts. */
export class SynthesisFileJournal implements SynthesisJournal {
  readonly directory: string;
  constructor(root: string, readonly name: string, readonly revalidate: () => Promise<void>) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(name)) throw new Error("Invalid synthesis identity");
    this.directory = resolve(root, name);
    mkdirSync(this.directory, { recursive: true });
  }
  private path(file: string) {
    if (!/^[a-z_]+\.enc$/u.test(file)) throw new Error("Invalid journal artifact");
    return resolve(this.directory, file);
  }
  has(file: string): boolean { return existsSync(this.path(file)); }
  read<T>(file: string): T { return decryptJson<T>(readFileSync(this.path(file), "utf8"), `synthesis:${this.name}:${file}`); }
  write(file: string, value: unknown): void {
    const encrypted = encryptJson(value, `synthesis:${this.name}:${file}`);
    const descriptor = openSync(this.path(file), "wx", 0o600);
    try { writeFileSync(descriptor, encrypted, "utf8"); fsyncSync(descriptor); }
    finally { closeSync(descriptor); }
  }
  async before(stage: SynthesisStage, input: { instructions: string; data: string }): Promise<void> {
    await this.revalidate();
    this.write(`${stage}_submitted.enc`, { stage, input, at: new Date().toISOString() });
  }
  async after(attempt: SynthesisAttempt): Promise<void> {
    this.write(`${attempt.stage}_returned.enc`, { attempt, at: new Date().toISOString() });
    await this.revalidate();
  }
}
