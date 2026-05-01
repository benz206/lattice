import { handleRouteError, HttpError, json } from "@/lib/server/http";
import { readChunks, withStore } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string; ordinal: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id, ordinal } = await context.params;
    const document = await withStore(async (store) => store.getDocument(id));
    if (!document) throw new HttpError(404, "Document not found.");
    const n = Number.parseInt(ordinal, 10);
    const chunk = (await readChunks(id)).find((item) => item.ordinal === n);
    if (!chunk) throw new HttpError(404, "Chunk not found.");
    return json({
      id: chunk.id,
      ordinal: chunk.ordinal,
      text: chunk.text,
      page_start: chunk.page_start,
      page_end: chunk.page_end,
      char_start: chunk.char_start,
      char_end: chunk.char_end,
      section_title: chunk.section_title,
      summary: chunk.summary,
      keywords: chunk.keywords,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
