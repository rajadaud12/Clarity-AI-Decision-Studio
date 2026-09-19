import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    providers: {
      ollama: {
        configured: Boolean(process.env.OLLAMA_API_KEY),
        model: process.env.OLLAMA_MODEL || "gpt-oss:120b",
      },
      openai: {
        configured: Boolean(process.env.OPENAI_API_KEY),
        model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
      },
    },
    jev: {
      configured: Boolean(process.env.TYPESAFE_API_KEY),
      model: process.env.TYPESAFE_MODEL || "jev-latest",
    },
  });
}
