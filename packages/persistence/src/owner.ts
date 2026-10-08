import { AsyncLocalStorage } from "node:async_hooks";

// The legacy local owner belongs to the provisioned root account. Local administrative
// scripts retain that scope; authenticated web and worker entry points bind explicitly.
export const LOCAL_OWNER_ID = "local-owner";
declare global {
  var deliberationOwnerContext: AsyncLocalStorage<string> | undefined;
  var deliberationRequireOwnerContext: boolean | undefined;
}
const context = globalThis.deliberationOwnerContext ??= new AsyncLocalStorage<string>();
export function requireOwnerContext(): void { globalThis.deliberationRequireOwnerContext = true; }
export function getOwnerId(): string {
  const owner = context.getStore();
  if (owner) return owner;
  if (globalThis.deliberationRequireOwnerContext) throw new Error("Authenticated owner context required.");
  return LOCAL_OWNER_ID;
}
export function withOwner<T>(ownerId: string, work: () => T): T {
  if (!ownerId || ownerId.length > 80) throw new Error("Invalid owner context.");
  return context.run(ownerId, work);
}
