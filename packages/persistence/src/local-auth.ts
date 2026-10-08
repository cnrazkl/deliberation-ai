import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { localRegistrationSchema, localLoginSchema, localPasswordChangeSchema,
  type LocalUserSummary, type LocalSessionSummary } from "@deliberation-ai/contracts";
import { getDatabase } from "./database";
import { localUsers, localSessions, localLoginAttempts } from "./schema";
import { hashLocalPassword, verifyLocalPassword } from "./local-password";
import { LOCAL_OWNER_ID } from "./owner";

export const LOCAL_SESSION_COOKIE = "deliberation-session";
export const LOCAL_SESSION_SECONDS = 8 * 60 * 60;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
type User = typeof localUsers.$inferSelect;
export class LocalAuthError extends Error {
  constructor(message: string, readonly status = 400) { super(message); this.name = "LocalAuthError"; }
}
function summary(user: User): LocalUserSummary {
  return { id: user.id, ownerId: user.ownerId, username: user.username, displayName: user.displayName,
    role: user.role === "root" ? "root" : "user", createdAt: user.createdAt.toISOString() };
}
async function throttle(identity: string, limit: number, seconds: number): Promise<void> {
  const id = digest(`local-auth:${identity}`);
  const [row] = await getDatabase().insert(localLoginAttempts).values({ identityHash: id, attempts: 1, windowStartedAt: new Date() })
    .onConflictDoUpdate({ target: localLoginAttempts.identityHash, set: {
      attempts: sql`case when ${localLoginAttempts.windowStartedAt} < now() - ${seconds} * interval '1 second' then 1 else ${localLoginAttempts.attempts} + 1 end`,
      windowStartedAt: sql`case when ${localLoginAttempts.windowStartedAt} < now() - ${seconds} * interval '1 second' then now() else ${localLoginAttempts.windowStartedAt} end`,
    } }).returning({ attempts: localLoginAttempts.attempts });
  if (!row || row.attempts > limit) throw new LocalAuthError("Çok fazla deneme yapıldı. Bir süre sonra tekrar deneyin.", 429);
}
export async function provisionLocalRoot(password: string): Promise<LocalUserSummary> {
  const input = localRegistrationSchema.parse({ username: "root", displayName: "Root", password });
  const passwordHash = await hashLocalPassword(input.password);
  return getDatabase().transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('local-root-provision-v1'))`);
    const [existing] = await tx.select().from(localUsers).where(eq(localUsers.role, "root")).limit(1);
    if (existing) {
      if (!await verifyLocalPassword(password, existing.passwordHash)) throw new LocalAuthError("Root hesabı zaten farklı bir parolayla yapılandırılmış.", 409);
      return summary(existing);
    }
    const [created] = await tx.insert(localUsers).values({ ownerId: LOCAL_OWNER_ID, username: "root", displayName: "Root", role: "root", passwordHash }).returning();
    if (!created) throw new LocalAuthError("Hesap oluşturulamadı.");
    return summary(created);
  });
}
export async function registerLocalUser(value: unknown): Promise<LocalUserSummary> {
  const input = localRegistrationSchema.safeParse(value);
  if (!input.success || input.data.username === "root") throw new LocalAuthError("Kullanıcı bilgileri geçersiz; parola en az 8 karakter olmalı.");
  await throttle("registration", 60, 3600);
  const db = getDatabase();
  if (!(await db.select({ id: localUsers.id }).from(localUsers).where(eq(localUsers.role, "root")).limit(1)).length)
    throw new LocalAuthError("Yerel hesap sistemi henüz hazırlanmadı.", 503);
  const passwordHash = await hashLocalPassword(input.data.password);
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('local-user-registration-v1'))`);
    const [count] = await tx.select({ total: sql<number>`count(*)::int` }).from(localUsers);
    if ((count?.total ?? 0) >= 500) throw new LocalAuthError("Yerel kullanıcı kapasitesi doldu.", 409);
    const id = randomUUID();
    const [created] = await tx.insert(localUsers).values({ id, ownerId: `user:${id}`, username: input.data.username,
      displayName: input.data.displayName, role: "user", passwordHash }).onConflictDoNothing().returning();
    if (!created) throw new LocalAuthError("Bu kullanıcı adı kullanılamıyor.", 409);
    return summary(created);
  });
}
async function issue(user: User) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + LOCAL_SESSION_SECONDS * 1000);
  await getDatabase().transaction(async tx => {
    const [current] = await tx.select().from(localUsers).where(eq(localUsers.id, user.id)).for("share").limit(1);
    if (!current || current.passwordHash !== user.passwordHash) throw new LocalAuthError("Hesap değişti; yeniden giriş yapın.", 409);
    await tx.delete(localSessions).where(and(eq(localSessions.userId, user.id), lt(localSessions.expiresAt, new Date())));
    await tx.insert(localSessions).values({ tokenHash: digest(token), userId: user.id, scopeUserId: user.id, expiresAt });
  });
  return { token, session: { user: summary(user), scope: summary(user), expiresAt: expiresAt.toISOString() } satisfies LocalSessionSummary };
}
export async function loginLocalUser(value: unknown) {
  const parsed = localLoginSchema.safeParse(value);
  if (!parsed.success) throw new LocalAuthError("Kullanıcı adı veya parola geçersiz.", 401);
  await throttle("login-global", 120, 60);
  await getDatabase().delete(localLoginAttempts).where(lt(localLoginAttempts.windowStartedAt, new Date(Date.now() - 24 * 60 * 60 * 1000)));
  await throttle(`login:${parsed.data.username}`, 10, 900);
  const [user] = await getDatabase().select().from(localUsers).where(eq(localUsers.username, parsed.data.username)).limit(1);
  if (!await verifyLocalPassword(parsed.data.password, user?.passwordHash ?? null) || !user)
    throw new LocalAuthError("Kullanıcı adı veya parola geçersiz.", 401);
  await getDatabase().delete(localLoginAttempts).where(eq(localLoginAttempts.identityHash, digest(`local-auth:login:${parsed.data.username}`)));
  return issue(user);
}
export async function readLocalSession(token: string | undefined): Promise<LocalSessionSummary | null> {
  if (!token || !/^[A-Za-z0-9_-]{43}$/u.test(token)) return null;
  const db = getDatabase();
  const [record] = await db.select().from(localSessions).where(and(eq(localSessions.tokenHash, digest(token)), gt(localSessions.expiresAt, new Date()))).limit(1);
  if (!record) return null;
  const [user] = await db.select().from(localUsers).where(eq(localUsers.id, record.userId)).limit(1);
  const [scope] = await db.select().from(localUsers).where(eq(localUsers.id, record.scopeUserId)).limit(1);
  if (!user || !scope || (user.role !== "root" && scope.id !== user.id)) return null;
  return { user: summary(user), scope: summary(scope), expiresAt: record.expiresAt.toISOString() };
}
export async function logoutLocalUser(token: string | undefined): Promise<void> {
  if (token && /^[A-Za-z0-9_-]{43}$/u.test(token)) await getDatabase().delete(localSessions).where(eq(localSessions.tokenHash, digest(token)));
}
export async function selectLocalUserScope(token: string, userId: string): Promise<LocalSessionSummary> {
  return getDatabase().transaction(async tx => {
    const [record] = await tx.select().from(localSessions).where(and(eq(localSessions.tokenHash, digest(token)), gt(localSessions.expiresAt, new Date()))).for("update").limit(1);
    if (!record) throw new LocalAuthError("Oturum açmanız gerekiyor.", 401);
    const [actor] = await tx.select().from(localUsers).where(eq(localUsers.id, record.userId)).for("share").limit(1);
    if (actor?.role !== "root") throw new LocalAuthError("Bu işlem için root yetkisi gerekiyor.", 403);
    const [scope] = await tx.select().from(localUsers).where(eq(localUsers.id, userId)).limit(1);
    if (!scope) throw new LocalAuthError("Kullanıcı bulunamadı.", 404);
    await tx.update(localSessions).set({ scopeUserId: scope.id }).where(eq(localSessions.tokenHash, record.tokenHash));
    return { user: summary(actor), scope: summary(scope), expiresAt: record.expiresAt.toISOString() };
  });
}
export async function listLocalUsers(token: string): Promise<LocalUserSummary[]> {
  const session = await readLocalSession(token);
  if (session?.user.role !== "root") throw new LocalAuthError("Bu işlem için root yetkisi gerekiyor.", session ? 403 : 401);
  return (await getDatabase().select().from(localUsers).orderBy(localUsers.createdAt).limit(500)).map(summary);
}
export async function changeLocalPassword(token: string, value: unknown) {
  const parsed = localPasswordChangeSchema.safeParse(value);
  if (!parsed.success) throw new LocalAuthError("Parola bilgileri geçersiz.");
  const session = await readLocalSession(token);
  if (!session) throw new LocalAuthError("Oturum açmanız gerekiyor.", 401);
  await throttle(`password:${session.user.id}`, 10, 900);
  const db = getDatabase();
  const [user] = await db.select().from(localUsers).where(eq(localUsers.id, session.user.id)).limit(1);
  if (!user || !await verifyLocalPassword(parsed.data.currentPassword, user.passwordHash)) throw new LocalAuthError("Mevcut parola geçersiz.", 401);
  const passwordHash = await hashLocalPassword(parsed.data.password);
  const saved = await db.transaction(async tx => {
    const [current] = await tx.select().from(localUsers).where(eq(localUsers.id, user.id)).for("update").limit(1);
    if (!current || current.passwordHash !== user.passwordHash) throw new LocalAuthError("Hesap değişti; yeniden giriş yapın.", 409);
    await tx.update(localUsers).set({ passwordHash }).where(eq(localUsers.id, user.id));
    await tx.delete(localSessions).where(eq(localSessions.userId, user.id));
    return { ...current, passwordHash };
  });
  return issue(saved);
}
