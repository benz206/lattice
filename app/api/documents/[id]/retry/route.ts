import { handleRouteError, HttpError, json } from "@/lib/server/http";
import { ingestDocument } from "@/lib/server/ingestion";
import { withStore } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    const document = await withStore(async (store) => store.getDocument(id));
    if (!document) throw new HttpError(404, "Document not found.");
    void ingestDocument(id);
    return json({ id, status: "pending" }, { status: 202 });
  } catch (error) {
    return handleRouteError(error);
  }
}
