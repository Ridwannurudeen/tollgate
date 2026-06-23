import { NextRequest, NextResponse } from "next/server";
import { settleQuestion } from "@/lib/settlement";

export const runtime = "nodejs";

function readQuestion(body: unknown): string {
  if (!body || typeof body !== "object") {
    throw new Error("Request body must be a JSON object.");
  }
  const question = (body as Record<string, unknown>).question;
  if (typeof question !== "string") {
    throw new Error("Question must be a string.");
  }
  return question;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as unknown;
    const question = readQuestion(body);
    const result = await settleQuestion(question);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Query failed." },
      { status: 400 },
    );
  }
}
