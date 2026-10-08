import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { SynthesisFileJournal } from "./synthesis-journal";

const roots: string[] = [];
function journal(name = "fixture", validate = async () => {}) {
  vi.stubEnv("DATA_ENCRYPTION_KEY", Buffer.alloc(32, 42).toString("base64"));
  const root = mkdtempSync(resolve(tmpdir(), "da-synthesis-")); roots.push(root);
  return { root, instance: new SynthesisFileJournal(root, name, validate) };
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(resolve(tmpdir(), "da-synthesis-"))) throw new Error("Unexpected cleanup target");
    rmSync(root, { recursive: true, force: true });
  }
  vi.unstubAllEnvs();
});
it("binds encrypted artifacts to study and phase, rejects replacement and tampering", () => {
  const { root, instance } = journal(); instance.write("plan.enc", { text: "private claim and raw output" });
  const envelope = readFileSync(resolve(instance.directory, "plan.enc"), "utf8");
  expect(envelope).not.toContain("private claim"); expect(instance.read("plan.enc")).toEqual({ text: "private claim and raw output" });
  expect(() => instance.write("plan.enc", {})).toThrow();
  const other = new SynthesisFileJournal(root, "another", async () => {});
  writeFileSync(resolve(other.directory, "plan.enc"), envelope);
  expect(() => other.read("plan.enc")).toThrow();
  writeFileSync(resolve(instance.directory, "result.enc"), envelope);
  expect(() => instance.read("result.enc")).toThrow();
});
it("allows just one concurrent submitted marker and refuses changed input before durable submission", async () => {
  const { instance } = journal(); const input = { instructions: "private instruction", data: "private data" };
  const outcomes = await Promise.allSettled([instance.before("draft", input), instance.before("draft", input)]);
  expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
  const { instance: blocked } = journal("blocked", async () => { throw new Error("Changed source"); });
  await expect(blocked.before("draft", input)).rejects.toThrow(); expect(blocked.has("draft_submitted.enc")).toBe(false);
});
it("retains a returned receipt even when post-call revalidation detects changed source", async () => {
  const { instance } = journal("changed", async () => { throw new Error("Changed source"); });
  await expect(instance.after({ stage: "draft", instructions: "private", data: "private",
    outcome: { status: "failed", outcome: "unknown", code: "timeout", inputTokens: null, outputTokens: null } })).rejects.toThrow();
  expect(instance.has("draft_returned.enc")).toBe(true);
});
it("rejects path traversal identities and journal artifact paths", () => {
  const { root, instance } = journal();
  expect(() => new SynthesisFileJournal(root, "../escape", async () => {})).toThrow();
  expect(() => instance.write("../escape.enc", {})).toThrow();
});
