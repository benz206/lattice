import { handleRouteError, HttpError, json } from "@/lib/server/http";
import { readPages, withStore } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string; pageNumber: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id, pageNumber } = await context.params;
    const document = await withStore(async (store) => store.getDocument(id));
    if (!document) throw new HttpError(404, "Document not found.");
    const n = Number.parseInt(pageNumber, 10);
    const page = (await readPages(id)).find((item) => item.page_number === n);
    if (!page) throw new HttpError(404, "Page not found.");
    return json(page);
  } catch (error) {
    return handleRouteError(error);
  }
}
