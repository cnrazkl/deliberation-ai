import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import { defaultFakeCouncilMembers } from "@deliberation-ai/contracts";
import { provisionLocalRoot } from "../src/local-auth";
import { closeDatabase } from "../src/database";
import { createRuntimeReadToken } from "../src/runtime-read-auth";
import { requestRehearsalHttp } from "./rehearsal-http";

// Fresh rehearsal database only; never accepts an existing application database.
const database = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/");
const origin = process.env.APP_ORIGIN ?? "";
const address = process.env.REHEARSAL_WEB_URL ?? "http://web:3000";
type Session = { cookie: string; owner: string };
async function request(path: string, method = "GET", body?: unknown, session?: Session) {
  return requestRehearsalHttp(address,path,{ method,origin,...(body===undefined ? {} : {body}),
    ...(session ? {headers:{cookie:session.cookie,"x-deliberation-owner":session.owner}} : {}) });
}
async function login(username: string, password: string): Promise<Session> {
  const response = await request("/api/auth/login", "POST", { username,password });
  assert.equal(response.status,200);
  const session = await response.json() as { scope: { ownerId: string } };
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return { cookie,owner: session.scope.ownerId };
}
try {
  assert.match(database.pathname,/^\/deliberation_rehearsal_[a-f0-9]{12}$/u);
  assert.equal(database.hostname,"db");
  const rootPassword = process.env.REHEARSAL_ROOT_PASSWORD;
  assert.ok(rootPassword && rootPassword.length >= 8);
  await provisionLocalRoot(rootPassword);
  const deadline = Date.now()+90_000;
  for (;;) {
    try {
      const response = await requestRehearsalHttp(address,"/api/local-diagnostics",{origin,timeoutMs:3000,maxBytes:16000,headers:{
        "x-deliberation-runtime-read": createRuntimeReadToken(process.env.DATA_ENCRYPTION_KEY ?? "") } });
      const health = await response.json() as { database: string; readyWorkers: number };
      if (response.ok && health.database === "ready" && health.readyWorkers === 1) break;
    } catch { /* Bounded readiness wait; no model request. */ }
    if (Date.now()>deadline) throw new Error("Rehearsal runtime unavailable.");
    await pause(1000);
  }
  assert.equal((await request("/api/runs")).status,401);
  const root = await login("root",rootPassword);
  assert.equal((await request("/api/runs","GET",undefined,root)).status,403);
  const password = randomBytes(24).toString("base64url");
  const usernames = [0,1].map(() => `smoke_${randomBytes(6).toString("hex")}`);
  const sessions: Session[] = [];
  for (const username of usernames) {
    assert.equal((await request("/api/auth/register","POST",{ username,password })).status,201);
    sessions.push(await login(username,password));
  }
  const sent = await request("/api/runs","POST",{ question: "Compare the fictional garden layouts using only the supplied facts.", members: defaultFakeCouncilMembers,
    providerMode: "fake",reviewRounds: 1,riskProfile: "standard",idempotencyKey: randomUUID() },sessions[0]);
  assert.equal(sent.status,201);
  const { runId } = await sent.json() as { runId: string };
  const end = Date.now()+60_000;
  let status = "queued";
  while (["queued","running"].includes(status) && Date.now()<end) {
    const response = await request(`/api/runs/${runId}`,"GET",undefined,sessions[0]);
    assert.equal(response.status,200);
    status = ((await response.json()) as { status: string }).status;
    if (["queued","running"].includes(status)) await pause(500);
  }
  assert.equal(status,"completed");
  assert.equal((await request(`/api/runs/${runId}`,"GET",undefined,sessions[1])).status,404);
  for (const [index,session] of sessions.entries()) {
    const response = await request("/api/auth/account/deletion","GET",undefined,session);
    assert.equal(response.status,200);
    const preview = await response.json() as { fingerprint?: string; preview?: { fingerprint: string } };
    const fingerprint = preview.fingerprint ?? preview.preview?.fingerprint;
    assert.ok(fingerprint);
    assert.equal((await request("/api/auth/account/deletion","POST",{ username: usernames[index],currentPassword: password,fingerprint },session)).status,200);
    assert.equal((await request("/api/runs","GET",undefined,session)).status,401);
  }
  console.log(JSON.stringify({ status: "passed",checks: ["migration","database","worker","anonymous-denial","root-chat-denial","registration","login","fake-council-round","owner-isolation","complete-erasure","session-revocation"], providerCalls: 0 }));
} catch {
  console.error("Isolated rehearsal smoke failed; inspect only the new rehearsal environment.");
  process.exitCode=1;
} finally { await closeDatabase(); }
