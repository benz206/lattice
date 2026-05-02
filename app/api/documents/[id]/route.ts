import { handleRouteError, HttpError, json, noContent } from "@/lib/server/http";
import {
  deleteDocumentFiles,
  readChunks,
  readPages,
  withStore,
} from "@/lib/server/store";

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
    const [pages, chunks] = await Promise.all([readPages(id), readChunks(id)]);
    return json({
      id: document.id,
      filename: document.filename,
      content_type: document.content_type,
      size_bytes: document.size_bytes,
      num_pages: document.num_pages,
      status: document.status,
      created_at: document.created_at,
      updated_at: document.updated_at,
      error: document.error,
      pages: pages.map((page) => ({
        page_number: page.page_number,
        char_count: page.char_count,
        preview: page.text.slice(0, 240),
      })),
      num_chunks: chunks.length,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const { id } = await context.params;
    const removed = await withStore(async (store) => store.deleteDocument(id));
    if (!removed) throw new HttpError(404, "Document not found.");
    await deleteDocumentFiles(removed);
    return noContent();
  } catch (error) {
    return handleRouteError(error);
  }
}
