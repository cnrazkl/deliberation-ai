export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { requireOwnerContext } = await import("@deliberation-ai/persistence");
    requireOwnerContext();
  }
}
