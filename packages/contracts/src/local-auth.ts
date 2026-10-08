import { z } from "zod";

export const localUsernameSchema = z.string().trim().toLowerCase().min(3).max(32).regex(/^[a-z0-9][a-z0-9_.-]*$/u);
export const localPasswordSchema = z.string().min(8).max(128);
export const localRegistrationSchema = z.object({ username: localUsernameSchema,
  displayName: z.string().trim().min(1).max(80).optional(), password: localPasswordSchema }).strict();
export const localLoginSchema = z.object({ username: localUsernameSchema, password: z.string().min(1).max(128) }).strict();
export const localPasswordChangeSchema = z.object({ currentPassword: z.string().min(1).max(128), password: localPasswordSchema }).strict();
export const localUserUpdateSchema = z.object({ username: localUsernameSchema,
  displayName: z.string().trim().min(1).max(80), password: localPasswordSchema.optional() }).strict();
export const localAccountDeletionSchema = z.object({ currentPassword: z.string().min(1).max(128),
  username: localUsernameSchema, fingerprint: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();
export type LocalAccountDeletionPreview = { user: LocalUserSummary; eligible: boolean; fingerprint: string;
  recordCount: number; connectionCount: number; runCount: number; blockers: string[] };
export type LocalUserSummary = { id: string; ownerId: string; username: string; displayName: string; role: "root" | "user"; createdAt: string };
export type LocalSessionSummary = { user: LocalUserSummary; scope: LocalUserSummary; expiresAt: string };
