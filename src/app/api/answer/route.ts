import { answerQuery } from "@/lib/server/answering";
import { handleRouteError, json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as {
      query?: string;
      top_k?: number;
      document_id?: string | null;
    };
    return json(
      await answerQuery({
        query: body.query ?? "",
        topK: body.top_k ?? 8,
        documentId: body.document_id,
      }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
