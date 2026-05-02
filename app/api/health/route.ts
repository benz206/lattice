import { json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  return json({ status: "ok", version: "0.2.0-next16" });
}
