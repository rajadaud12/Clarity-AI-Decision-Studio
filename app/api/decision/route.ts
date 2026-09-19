import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { buildJevPayload, composeDecision, evaluateWithJev, normalizePlan } from "@/lib/jev";
import { generateStructured } from "@/lib/llm";
import { JEV_ARCHITECT_PROMPT } from "@/lib/prompts";
import { decisionRequestSchema, jevPlanSchema, JEV_PLAN_JSON_SCHEMA } from "@/lib/schemas";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const input = decisionRequestSchema.parse(await request.json());
    const architectInput = [
      `Confirmed summary:\n${input.summary}`,
      "Confirmed parameters:",
      JSON.stringify(input.parameters, null, 2),
    ].join("\n\n");

    const rawPlan = await generateStructured({
      provider: input.provider,
      messages: [{ id: "confirmed-brief", role: "user", content: architectInput }],
      system: JEV_ARCHITECT_PROMPT,
      schema: JEV_PLAN_JSON_SCHEMA,
      schemaName: "jev_decision_plan",
    });

    const plan = normalizePlan(jevPlanSchema.parse(rawPlan));
    const payload = buildJevPayload(plan, input.parameters);
    const result = await evaluateWithJev(plan, input.parameters);
    const composite = composeDecision(plan, result);

    return NextResponse.json({ plan, result, composite, generatedBy: input.provider, jevPayload: payload });
  } catch (error) {
    const message = error instanceof ZodError
      ? "The decision engine returned an unexpected structured response. Please try the analysis again."
      : error instanceof Error ? error.message : "Unable to complete the JEV evaluation.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
