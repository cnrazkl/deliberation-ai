import { previewPrivateBranchSeed } from "@deliberation-ai/persistence";
import { privateBranchError, privateBranchJson, privateBranchUuid } from "../../../../../lib/private-branches-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params; const member = new URL(request.url).searchParams.get("member");
  if (!privateBranchUuid.test(id) || !member || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(member)) return privateBranchJson({ error: "Kaynak bulunamadı." }, 404);
  try {
    const seed = await previewPrivateBranchSeed(id.toLowerCase(), member);
    return seed ? privateBranchJson(seed) : privateBranchJson({ error: "Kaynak bulunamadı." }, 404);
  } catch (error) { return privateBranchError(error); }
}
