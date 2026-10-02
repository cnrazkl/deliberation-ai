import { memoryEntryIdSchema, saveMemoryEntrySchema } from "@deliberation-ai/contracts";
import {
  deleteMemoryEntry,
  listMemoryEntries,
  MemoryLimitError,
  saveMemoryEntry,
} from "@deliberation-ai/persistence";
import { rejectCrossOriginMutation } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json({ entries: await listMemoryEntries() });
}

export async function POST(request: Request): Promise<Response> {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const parsed = saveMemoryEntrySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Belleğe alınacak iddia geçersiz." }, { status: 400 });
  }
  try {
    const entry = await saveMemoryEntry(parsed.data);
    if (!entry) {
      return Response.json({ error: "Çalışma veya iddia bulunamadı." }, { status: 404 });
    }
    return Response.json(entry);
  } catch (error) {
    if (error instanceof MemoryLimitError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const parsed = memoryEntryIdSchema.safeParse(new URL(request.url).searchParams.get("id"));
  if (!parsed.success) {
    return Response.json({ error: "Bellek kaydı kimliği geçersiz." }, { status: 400 });
  }
  const deleted = await deleteMemoryEntry(parsed.data);
  return Response.json({ deleted });
}
