import { afterEach, beforeEach, expect, test, vi } from "vitest";

const { listEvents, readSession, lease } = vi.hoisted(() => ({ listEvents: vi.fn(), readSession: vi.fn(), lease: vi.fn() }));
vi.mock("@deliberation-ai/persistence", () => ({
  getOwnerId: () => "user:alice", listDurableRunEvents: listEvents, readLocalSession: readSession, withLiveOwner: lease,
}));
vi.mock("./local-auth", () => ({ localSessionToken: () => "session-token", withLocalSession: (handler: unknown) => handler }));
import { GET } from "../app/api/runs/[id]/stream/route";

const context = { params: Promise.resolve({ id: "run-id" }) };
const active = { run: { status: "running", question: "synthetic private question" }, events: [] };
const session = { user: { role: "user" }, scope: { ownerId: "user:alice" } };

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  listEvents.mockResolvedValue(active); readSession.mockResolvedValue(session);
  lease.mockImplementation(async (_owner: string, work: () => Promise<unknown>) => work());
});
afterEach(() => { vi.useRealTimers(); });

test.each([null, { ...session, scope: { ownerId: "user:bob" } }, { ...session, user: { role: "root" } }])(
  "revoked, changed-scope or root sessions close the stream before another run read", async changed => {
    const response = await GET(new Request("http://localhost/api/runs/run-id/stream"), context);
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("synthetic private question");
    readSession.mockResolvedValue(changed);
    await vi.advanceTimersByTimeAsync(250);
    expect(await reader.read()).toEqual({ done: true, value: undefined });
    expect(listEvents).toHaveBeenCalledOnce(); expect(readSession).toHaveBeenCalledTimes(2);
    reader.releaseLock();
  },
);

test("a session revoked during initial loading receives no private data", async () => {
  readSession.mockResolvedValue(null);
  const response = await GET(new Request("http://localhost/api/runs/run-id/stream"), context);
  expect(await response.text()).toBe(""); expect(listEvents).toHaveBeenCalledOnce();
});

test("an authorized stream receives later terminal data under an owner lease", async () => {
  const response = await GET(new Request("http://localhost/api/runs/run-id/stream"), context);
  const reader = response.body!.getReader(); await reader.read();
  listEvents.mockResolvedValue({ run: { ...active.run, status: "completed" }, events: [{ sequence: 1, type: "completed" }] });
  await vi.advanceTimersByTimeAsync(250);
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('"status":"completed"');
  expect(await reader.read()).toEqual({ done: true, value: undefined });
  expect(lease).toHaveBeenCalledTimes(2); expect(listEvents).toHaveBeenLastCalledWith("run-id", 0);
  reader.releaseLock();
});

test("consumer cancellation stops the polling timer and further database reads", async () => {
  const response = await GET(new Request("http://localhost/api/runs/run-id/stream"), context);
  const reader = response.body!.getReader(); await reader.read();
  await reader.cancel(); await vi.advanceTimersByTimeAsync(60_000);
  expect(listEvents).toHaveBeenCalledOnce(); expect(readSession).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  reader.releaseLock();
});

test("slow consumers retain one queued event without accumulating run bodies or database polls", async () => {
  listEvents.mockResolvedValue({ ...active, events: [{ sequence: 1, type: "running" }] });
  const response = await GET(new Request("http://localhost/api/runs/run-id/stream"), context);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(listEvents).toHaveBeenCalledOnce(); expect(readSession).toHaveBeenCalledOnce();
  const reader = response.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain("synthetic private question");
  await vi.advanceTimersByTimeAsync(250);
  expect(listEvents).toHaveBeenCalledTimes(2);
  await reader.cancel(); reader.releaseLock();
});

test("client abort stops polling without accumulating abort listeners", async () => {
  const abort = new AbortController();
  const response = await GET(new Request("http://localhost/api/runs/run-id/stream", { signal: abort.signal }), context);
  const reader = response.body!.getReader(); await reader.read();
  await vi.advanceTimersByTimeAsync(5_000);
  const calls = listEvents.mock.calls.length;
  abort.abort(); await vi.advanceTimersByTimeAsync(60_000);
  expect(listEvents).toHaveBeenCalledTimes(calls); expect(vi.getTimerCount()).toBe(0);
  await reader.cancel(); reader.releaseLock();
});
