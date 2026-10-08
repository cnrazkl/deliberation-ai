let currentOwner: string | null = null;
export function setSessionOwner(ownerId: string | null): void { currentOwner = ownerId; }
export function sessionOwner(): string {
  if (!currentOwner) throw new Error("Oturum açmanız gerekiyor.");
  return currentOwner;
}
export function ownerFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set("X-Deliberation-Owner", sessionOwner());
  return fetch(input, { ...init, headers });
}
