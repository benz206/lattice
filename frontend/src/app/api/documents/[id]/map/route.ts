import { handleRouteError, HttpError, json } from "@/lib/server/http";
import { withStore } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    const document = await withStore(async (store) => store.getDocument(id));
    if (!document) throw new HttpError(404, "Document not found.");
    if (!document.document_map) {
      throw new HttpError(404, "Document map not available.");
    }
    return json(document.document_map);
  } catch (error) {
    return handleRouteError(error);
  }
}
