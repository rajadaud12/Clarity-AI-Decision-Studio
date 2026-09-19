import { afterEach, describe, expect, it, vi } from "vitest";
import { composeDecision, evaluateWithJev, normalizePlan } from "@/lib/jev";
import type { JevPlan, JevResult } from "@/lib/types";

const plan: JevPlan = {
  title: "Portal delivery model",
  decisionQuestion: "Which delivery model best fits the confirmed constraints?",
  stateSummary: "A fictional portal must launch on schedule.",
  options: [
    { key: "agency", label: "Agency", description: "External agency" },
    { key: "in house", label: "In-house", description: "Internal hire" },
  ],
  criteria: [
    { key: "speed", label: "Delivery speed", description: "Ability to launch quickly", weight: 3 },
    { key: "control", label: "Control", description: "Long-term operating control", weight: 1 },
  ],
  questions: [
    {
      id: "agency speed",
      label: "Agency delivery speed",
      type: "score",
      instructions: "How strongly does the agency option support the required launch speed?",
      options: [],
      levels: ["Poor fit", "Partial fit", "Strong fit"],
      positiveMeaning: "",
      negativeMeaning: "",
      optionKey: "agency",
      criterionKey: "speed",
      hardConstraint: false,
    },
    {
      id: "in_house_speed",
      label: "In-house delivery speed",
      type: "score",
      instructions: "How strongly does the in-house option support the required launch speed?",
      options: [],
      levels: ["Poor fit", "Partial fit", "Strong fit"],
      positiveMeaning: "",
      negativeMeaning: "",
      optionKey: "in house",
      criterionKey: "speed",
      hardConstraint: false,
    },
    {
      id: "agency_deadline",
      label: "Agency deadline constraint",
      type: "noul",
      instructions: "Is the agency likely to meet the hard launch deadline?",
      options: [],
      levels: [],
      positiveMeaning: "The deadline is likely to be met",
      negativeMeaning: "The deadline is unlikely to be met",
      optionKey: "agency",
      criterionKey: "speed",
      hardConstraint: true,
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("JEV request preparation", () => {
  it("normalizes keys, weights, and valid atomic questions", () => {
    const normalized = normalizePlan(plan);
    expect(normalized.options[1].key).toBe("in_house");
    expect(normalized.questions[0].id).toBe("agency_speed");
    expect(normalized.criteria.reduce((sum, criterion) => sum + criterion.weight, 0)).toBeCloseTo(1);
  });

  it("maps only structured confirmed state to the official state + questions contract", async () => {
    process.env.TYPESAFE_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "jev-test",
          answers: {
            agency_speed: {
              type: "score",
              score: 2,
              legend: { "0": "Poor fit", "1": "Partial fit", "2": "Strong fit" },
              probabilities: { "0": 0.1, "1": 0.2, "2": 0.7 },
              confidence: 0.6,
            },
          },
          usage: { input_tokens: 20, output_tokens: 4 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const normalized = normalizePlan(plan);
    const result = await evaluateWithJev(normalized, [{ key: "timeline", label: "Timeline", value: "Six weeks" }]);
    expect(result.model).toBe("jev-test");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("jev-latest");
    expect(body.state.decision_brief).toContain("fictional portal");
    expect(body.state.parameters.timeline).toBe("Six weeks");
    expect(body.state.source_conversation).toBeUndefined();
    expect(body.questions.agency_speed.type).toBe("score");
    expect(body.questions.agency_speed.instructions.inspect).toContain("`decision_brief`");
    expect(body.questions.agency_deadline.criteria.true).toContain("deadline");
  });

  it("composes weighted scores and blocks options that fail hard constraints", () => {
    const normalized = normalizePlan(plan);
    const result: JevResult = {
      model: "jev-test",
      answers: {
        agency_speed: {
          type: "score",
          score: 2,
          legend: { "0": "Poor", "1": "Partial", "2": "Strong" },
          probabilities: { "0": 0.05, "1": 0.15, "2": 0.8 },
          confidence: 0.75,
        },
        in_house_speed: {
          type: "score",
          score: 1,
          legend: { "0": "Poor", "1": "Partial", "2": "Strong" },
          probabilities: { "0": 0.1, "1": 0.7, "2": 0.2 },
          confidence: 0.65,
        },
        agency_deadline: { type: "noul", noul: 0.42 },
      },
    };

    const composite = composeDecision(normalized, result);
    expect(composite.rankings.find((ranking) => ranking.optionKey === "agency")?.eligible).toBe(false);
    expect(composite.recommendedOption).toBe("in_house");
    expect(composite.needsReview).toBe(false);
  });
});
