import { handleRouteError, HttpError, json } from "@/lib/server/http";
import { readChunks, withStore } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function renderChunk(chunk: Awaited<ReturnType<typeof readChunks>>[number]) {
  return {
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
  };
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    const document = await withStore(async (store) => store.getDocument(id));
    if (!document) throw new HttpError(404, "Document not found.");
    const url = new URL(request.url);
    const limit = Math.max(1, Math.min(500, Number.parseInt(url.searchParams.get("limit") ?? "100", 10)));
    const offset = Math.max(0, Number.parseInt(url.searchParams.get("offset") ?? "0", 10));
    const chunks = await readChunks(id);
    return json(chunks.slice(offset, offset + limit).map(renderChunk));
  } catch (error) {
    return handleRouteError(error);
  }
}
