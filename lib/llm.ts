import OpenAI from "openai";
import type { ChatMessage, Provider } from "@/lib/types";

type JsonSchema = Record<string, unknown>;

function stripCodeFence(value: string) {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function parseJson(value: string): unknown {
  const cleaned = stripCodeFence(value);
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("The model returned an invalid structured response.");
  }
}

function transcript(messages: ChatMessage[]) {
  return messages.map((message) => `${message.role === "user" ? "Customer" : "Clarity"}: ${message.content}`).join("\n\n");
}

async function callOllama(args: {
  messages: ChatMessage[];
  system: string;
  schema: JsonSchema;
}) {
  const apiKey = process.env.OLLAMA_API_KEY;
  if (!apiKey) throw new Error("OLLAMA_API_KEY is not configured.");

  const baseUrl = (process.env.OLLAMA_BASE_URL || "https://ollama.com/api").replace(/\/$/, "");
  let parseFailure: Error | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const correction = attempt === 0
      ? ""
      : "\n\nRETRY NOTICE: Your previous response was not valid JSON. Return one complete JSON object only. Do not use Markdown, comments, trailing commas, or text before/after the object.";
    const response = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OLLAMA_MODEL || "gpt-oss:120b",
        messages: [
          {
            role: "system",
            content: `${args.system}\n\nJSON CONTRACT — every required property must be present and every value must use the exact type below. Do not rename fields or replace arrays with objects:\n${JSON.stringify(args.schema, null, 2)}${correction}`,
          },
          ...args.messages.map(({ role, content }) => ({ role, content })),
        ],
        format: args.schema,
        stream: false,
        options: { temperature: attempt === 0 ? 0.2 : 0 },
      }),
      signal: AbortSignal.timeout(90_000),
    });

    const body = (await response.json().catch(() => null)) as
      | { message?: { content?: string }; error?: string }
      | null;

    if (!response.ok) {
      throw new Error(body?.error || `Ollama Cloud returned ${response.status}.`);
    }

    const content = body?.message?.content;
    if (!content) throw new Error("Ollama Cloud returned an empty response.");
    try {
      return parseJson(content);
    } catch (error) {
      parseFailure = error instanceof Error ? error : new Error("Invalid JSON response.");
    }
  }

  throw new Error(`${parseFailure?.message || "The model returned invalid JSON."} Please retry this answer.`);
}

async function callOpenAI(args: {
  messages: ChatMessage[];
  system: string;
  schema: JsonSchema;
  schemaName: string;
}) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
    instructions: args.system,
    input: transcript(args.messages),
    text: {
      format: {
        type: "json_schema",
        name: args.schemaName,
        strict: true,
        schema: args.schema,
      },
    },
    reasoning: { effort: "medium" },
    store: false,
  });

  if (!response.output_text) throw new Error("OpenAI returned an empty response.");
  return parseJson(response.output_text);
}

export async function generateStructured(args: {
  provider: Provider;
  messages: ChatMessage[];
  system: string;
  schema: JsonSchema;
  schemaName: string;
}) {
  return args.provider === "openai" ? callOpenAI(args) : callOllama(args);
}
