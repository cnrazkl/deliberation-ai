export const privateOutputDefaultKey = "deliberation-private-output-default-v1";
export const privateOutputCaps = [128, 256, 512, 1024] as const;
export function readPrivateOutputDefault(): number {
  try {
    const raw = localStorage.getItem(privateOutputDefaultKey);
    return privateOutputCaps.some((value) => String(value) === raw) ? Number(raw) : 1024;
  } catch { return 1024; }
}
export function savePrivateOutputDefault(value: number): boolean {
  if (!privateOutputCaps.some((allowed) => allowed === value)) return false;
  try {
    localStorage.setItem(privateOutputDefaultKey, String(value));
    window.dispatchEvent(new Event(privateOutputDefaultKey));
    return true;
  } catch { return false; }
}
export function subscribePrivateOutputDefault(callback: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === privateOutputDefaultKey || event.key === null) callback(); };
  window.addEventListener("storage", storage);
  window.addEventListener(privateOutputDefaultKey, callback);
  return () => { window.removeEventListener("storage", storage); window.removeEventListener(privateOutputDefaultKey, callback); };
}
