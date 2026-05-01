import { createUpload } from "@/lib/server/ingestion";
import { handleRouteError, HttpError, json } from "@/lib/server/http";
import { withStore } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const documents = await withStore(async (store) =>
      store.listDocuments().map((document) => ({
        id: document.id,
        filename: document.filename,
        content_type: document.content_type,
        size_bytes: document.size_bytes,
        num_pages: document.num_pages,
        status: document.status,
        created_at: document.created_at,
        updated_at: document.updated_at,
        error: document.error,
      })),
    );
    return json(documents);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new HttpError(400, "Missing PDF file.");
    }
    try {
      return json(await createUpload(file), { status: 202 });
    } catch (error) {
      if (error instanceof Error && error.name === "PayloadTooLarge") {
        throw new HttpError(413, error.message);
      }
      if (error instanceof Error && error.message.includes("Only PDF")) {
        throw new HttpError(415, error.message);
      }
      throw error;
    }
  } catch (error) {
    return handleRouteError(error);
  }
}
