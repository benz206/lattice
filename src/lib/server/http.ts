import { NextResponse } from "next/server";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function json<T>(body: T, init?: ResponseInit): NextResponse<T> {
  return NextResponse.json(body, init);
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

export function handleRouteError(error: unknown): Response {
  if (error instanceof HttpError) {
    return NextResponse.json({ detail: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Internal server error.";
  return NextResponse.json({ detail: message }, { status: 500 });
}
