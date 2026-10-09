import { expect, test } from "vitest";
import { saveProviderConnectionSchema } from "./index";

const settings = { provider: "openai" as const, label: "Personal API", apiKey: "offline-fixture-key" };
test("connections may be saved without a default model or with several selected models", () => {
  expect(saveProviderConnectionSchema.parse(settings)).toMatchObject({ defaultModel: "" });
  expect(saveProviderConnectionSchema.parse({ ...settings, selectedModels: ["model-a", "model-b"] }).selectedModels).toEqual(["model-a", "model-b"]);
  expect(saveProviderConnectionSchema.parse({ ...settings, selectedModels: [] }).selectedModels).toEqual([]);
});
test("saved model choices reject duplicate, empty, oversized and excessive identifiers", () => {
  for (const selectedModels of [["same", "same"], [" "], ["x".repeat(121)], Array.from({ length: 101 }, (_, i) => `model-${i}`)]) {
    expect(saveProviderConnectionSchema.safeParse({ ...settings, selectedModels }).success).toBe(false);
  }
  expect(saveProviderConnectionSchema.parse({ ...settings, selectedModels: [" model-a "] }).selectedModels).toEqual(["model-a"]);
});
