import { handleRouteError, json } from "@/lib/server/http";
import { searchChunks } from "@/lib/server/retrieval";
import type { SearchMode } from "@/lib/server/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as {
      query?: string;
      mode?: SearchMode;
      top_k?: number;
      document_id?: string | null;
    };
    const mode = body.mode ?? "hybrid";
    const hits = await searchChunks({
      query: body.query ?? "",
      mode,
      topK: body.top_k ?? 20,
      documentId: body.document_id,
    });
    return json({
      query: body.query ?? "",
      mode,
      results: hits.map((hit) => ({
        chunk_id: hit.chunk_id,
        document_id: hit.metadata.document_id,
        ordinal: hit.metadata.ordinal,
        page_start: hit.metadata.page_start,
        page_end: hit.metadata.page_end,
        section_title: hit.metadata.section_title,
        text: hit.text,
        score_hybrid: hit.rrf_score,
        score_vector: hit.vector_score,
        score_lexical: hit.lexical_score,
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
