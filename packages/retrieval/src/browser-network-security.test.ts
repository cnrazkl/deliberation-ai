import { afterEach, expect, test, vi } from "vitest";

const { launch, lookup } = vi.hoisted(() => ({ launch: vi.fn(), lookup: vi.fn() }));
vi.mock("playwright", () => ({ chromium: { launch } }));
vi.mock("node:dns/promises", () => ({ lookup }));

import { retrieveRenderedPublicDocument } from "./index";

afterEach(() => vi.clearAllMocks());

test("all browser pages share the public-only router and WebSocket connections cannot reach a server", async () => {
  lookup.mockResolvedValue([{ address: "1.1.1.1", family: 4 }]);
  const popupAbort = vi.fn().mockResolvedValue(undefined);
  const imageAbort = vi.fn().mockResolvedValue(undefined);
  const socketClose = vi.fn();
  let contextRouter: ((route: unknown) => Promise<void>) | undefined;
  let socketRouter: ((socket: unknown) => unknown) | undefined;
  const page = {
    on: vi.fn(), route: vi.fn(),
    goto: vi.fn(async () => {
      expect(contextRouter).toBeDefined();
      expect(socketRouter).toBeDefined();
      // A popup's very first navigation bypasses page.route, but not context.route.
      await contextRouter!({ request: () => ({ url: () => "http://127.0.0.1/private", method: () => "GET",
        resourceType: () => "document" }), abort: popupAbort });
      // Block disallowed resource types before even resolving/contacting the host.
      await contextRouter!({ request: () => ({ url: () => "http://image.fixture.test/image", method: () => "GET",
        resourceType: () => "image" }), abort: imageAbort });
      socketRouter!({ close: socketClose, connectToServer: vi.fn(() => { throw new Error("WebSocket escaped"); }) });
    }),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn(() => ({ innerText: vi.fn().mockResolvedValue("Bounded source text") })),
    title: vi.fn().mockResolvedValue("Source"),
  };
  const context = { route: vi.fn(async (_pattern, handler) => { contextRouter = handler; }),
    routeWebSocket: vi.fn(async (_pattern, handler) => { socketRouter = handler; }),
    newPage: vi.fn().mockResolvedValue(page), close: vi.fn().mockResolvedValue(undefined) };
  const browser = { newContext: vi.fn().mockResolvedValue(context), close: vi.fn().mockResolvedValue(undefined) };
  launch.mockResolvedValue(browser);

  await expect(retrieveRenderedPublicDocument("https://source.fixture.test/")).resolves.toMatchObject({ content: "Bounded source text" });
  expect(popupAbort).toHaveBeenCalledWith("blockedbyclient");
  expect(imageAbort).toHaveBeenCalledWith("blockedbyclient");
  expect(lookup).toHaveBeenCalledTimes(1);
  expect(socketClose).toHaveBeenCalledOnce();
  expect(context.close).toHaveBeenCalledOnce();
  expect(browser.close).toHaveBeenCalledOnce();
});
