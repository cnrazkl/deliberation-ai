import { expect, test } from "@playwright/test";
import { revealCouncilControls, workspaceView } from "./workspace-navigation";

test("NVIDIA hosted editor fixes conservative settings and permits explicit manual model without a catalog call", async ({ page, request }) => {
  let connectionId: string | undefined;
  let catalogCalls = 0;
  await page.route("**/api/provider-connections/*/models", async (route) => {
    catalogCalls += 1;
    await route.fulfill({ json: { status: "unsupported", verification: "none", models: [], truncated: false, checkedAt: new Date().toISOString() } });
  });
  try {
    await page.goto("/"); await revealCouncilControls(page); await workspaceView(page, "Ayarlar");
    await page.getByText(/Yerel sağlayıcı bağlantıları/).click();
    const form = page.locator(".connection-form");
    await form.getByLabel("Sağlayıcı ailesi").selectOption("openai-compatible");
    await form.getByLabel("API anahtarı", { exact: true }).fill("offline-other-service-key");
    await form.getByLabel("Uç nokta türü").selectOption("nvidia");
    await expect(form.getByLabel("API anahtarı", { exact: true })).toHaveValue("");
    await expect(form.getByLabel("Temel URL")).toHaveValue("https://integrate.api.nvidia.com/v1");
    await expect(form.getByLabel("Temel URL")).toHaveAttribute("readonly", "");
    await expect(form.getByLabel("Düşünme parametresi")).toBeDisabled();
    await expect(form.getByLabel("Yapılandırılmış çıktı")).toBeDisabled();
    await form.getByLabel("Bağlantı adı", { exact: true }).fill("E2E NVIDIA fixture");
    await form.getByLabel("API anahtarı", { exact: true }).fill("offline-nvidia-fixture-key");
    await form.getByLabel("Başlangıç modeli (görev sırasında değiştirilebilir)").fill("vendor/manual-model");
    const saved = page.waitForResponse((response) => response.url().endsWith("/api/provider-connections") && response.request().method() === "POST");
    await form.getByRole("button", { name: "Yeni bağlantıyı şifrele" }).click();
    const response = await saved; expect(response.ok()).toBe(true);
    connectionId = (await response.json() as { id: string }).id;
    const card = page.locator(".connection-card").filter({ hasText: "E2E NVIDIA fixture" });
    await expect(card).toContainText("NVIDIA hosted");
    expect(catalogCalls).toBe(0);
    await card.getByRole("button", { name: "Model listesini kontrol et" }).click();
    expect(catalogCalls).toBe(1);
    await workspaceView(page, "Sohbet");
    await page.getByLabel("Üye 1 bağlantısı").selectOption(connectionId);
    await page.getByLabel("Üye 1 modeli").fill("vendor/task-specific-model");
    await expect(page.getByLabel("Üye 1 modeli")).toHaveValue("vendor/task-specific-model");
    await page.setViewportSize({ width: 390, height: 844 });
    await workspaceView(page, "Ayarlar");
    await card.getByRole("button", { name: "Düzenle", exact: true }).click();
    await expect(card.getByLabel("API anahtarı", { exact: true })).toHaveValue("");
    expect((await card.boundingBox())!.width).toBeLessThanOrEqual(390);
  } finally {
    if (connectionId) await request.delete(`/api/provider-connections?id=${encodeURIComponent(connectionId)}`);
  }
});
