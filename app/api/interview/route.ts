import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { generateStructured } from "@/lib/llm";
import { INTERVIEWER_PROMPT } from "@/lib/prompts";
import { coerceInterviewTurn, INTERVIEW_JSON_SCHEMA, interviewRequestSchema, interviewTurnSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_INTERVIEW_ANSWERS = 10;

function mergeParameters(
  previous: Array<{ key: string; label: string; value: string }>,
  current: Array<{ key: string; label: string; value: string }>,
) {
  const merged = new Map(previous.map((parameter) => [parameter.key.toLowerCase(), parameter]));
  current.forEach((parameter) => merged.set(parameter.key.toLowerCase(), parameter));
  return Array.from(merged.values()).slice(0, 24);
}

function confirmationFromParameters(parameters: Array<{ label: string; value: string }>) {
  const facts = parameters.map((parameter) => `${parameter.label}: ${parameter.value}`).join("\n");
  return `Here’s what I understood:\n\n${facts}\n\nIs this correct?`;
}

export async function POST(request: Request) {
  try {
    const input = interviewRequestSchema.parse(await request.json());
    const briefContext = input.brief
      ? `\n\nCURRENT STRUCTURED BRIEF — preserve answered facts, update corrections, and do not ask about a topic already captured here:\n${JSON.stringify(input.brief, null, 2)}`
      : "";
    const raw = await generateStructured({
      provider: input.provider,
      messages: input.messages,
      system: `${INTERVIEWER_PROMPT}${briefContext}`,
      schema: INTERVIEW_JSON_SCHEMA,
      schemaName: "decision_interview_turn",
    });
    const parsed = interviewTurnSchema.parse(coerceInterviewTurn(raw));
    const parameters = mergeParameters(input.brief?.parameters || [], parsed.parameters);
    const userAnswerCount = input.messages.filter((message) => message.role === "user").length;
    const askedLabels = new Set(
      input.messages
        .filter((message) => message.role === "assistant" && message.question?.label)
        .map((message) => message.question!.label.trim().toLowerCase()),
    );
    const repeatedTopic = Boolean(parsed.question.label) && askedLabels.has(parsed.question.label.trim().toLowerCase());
    const shouldCheckpoint = parsed.stage === "interviewing"
      && parameters.length >= 6
      && (userAnswerCount >= MAX_INTERVIEW_ANSWERS || (repeatedTopic && userAnswerCount >= 6));

    const turn = shouldCheckpoint
      ? {
          ...parsed,
          stage: "confirmation" as const,
          assistantMessage: confirmationFromParameters(parameters),
          completionScore: Math.max(parsed.completionScore, 85),
          parameters,
          summary: confirmationFromParameters(parameters),
          question: { label: "", prompt: "", helpText: "", suggestions: [] },
        }
      : { ...parsed, parameters };
    return NextResponse.json(turn);
  } catch (error) {
    const message = error instanceof ZodError
      ? "The interviewer returned an incomplete response. Please retry this answer."
      : error instanceof Error ? error.message : "Unable to continue the interview.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
