import { afterEach, describe, expect, it, vi } from "vitest";
import { buildJevPayload, composeDecision, evaluateWithJev, normalizePlan, validateJevResult } from "@/lib/jev";
import type { JevPlan, JevResult, ScoreAnswer } from "@/lib/types";

const plan: JevPlan = {
  title: "Portal delivery model",
  decisionQuestion: "Which delivery model best fits the confirmed constraints?",
  stateSummary: "A fictional portal must launch on schedule.",
  options: [
    { key: "agency", label: "Agency", description: "External agency" },
    { key: "in house", label: "In-house", description: "Internal team" },
  ],
  criteria: [
    { key: "speed", label: "Delivery speed", description: "Ability to launch quickly", weight: 3 },
    { key: "control", label: "Control", description: "Long-term operating control", weight: 1 },
  ],
  hardConstraints: [
    { key: "deadline", label: "Launch deadline", description: "Can launch within the required deadline" },
  ],
  questions: [
    {
      id: "agency speed",
      label: "Agency delivery speed",
      type: "score",
      instructions: "How strongly does the agency option support the required launch speed?",
      options: [],
      levels: ["Cannot meet the launch window", "May meet it with material risk", "Clearly supports the launch window"],
      positiveMeaning: "",
      negativeMeaning: "",
      optionKey: "agency",
      criterionKey: "speed",
      constraintKey: "",
      hardConstraint: false,
    },
    {
      id: "in_house_speed",
      label: "In-house delivery speed",
      type: "score",
      instructions: "How strongly does the in-house option support the required launch speed?",
      options: [],
      levels: ["Cannot meet the launch window", "May meet it with material risk", "Clearly supports the launch window"],
      positiveMeaning: "",
      negativeMeaning: "",
      optionKey: "in house",
      criterionKey: "speed",
      constraintKey: "",
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
      constraintKey: "deadline",
      hardConstraint: true,
    },
  ],
};

function score(score: number, confidence = 0.8): ScoreAnswer {
  return {
    type: "score",
    score,
    legend: { "0": "Poor", "1": "Partial", "2": "Strong" },
    probabilities: score === 2 ? { "0": 0, "1": 0, "2": 1 } : { "0": 0, "1": 1, "2": 0 },
    confidence,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TYPESAFE_API_KEY;
});

describe("JEV plan normalization", () => {
  it("normalizes keys and weights, fills the score matrix, and guarantees a candidate Choice", () => {
    const normalized = normalizePlan(plan);
    expect(normalized.options[1].key).toBe("in_house");
    expect(normalized.questions[0].id).toBe("agency_speed");
    expect(normalized.criteria.reduce((sum, criterion) => sum + criterion.weight, 0)).toBeCloseTo(1);

    const scores = normalized.questions.filter((question) => question.type === "score");
    expect(scores).toHaveLength(normalized.options.length * normalized.criteria.length);
    expect(scores.some((question) => question.optionKey === "in_house" && question.criterionKey === "control")).toBe(true);
    const constraints = normalized.questions.filter((question) => question.type === "noul" && question.hardConstraint);
    expect(constraints).toHaveLength(normalized.options.length * normalized.hardConstraints.length);

    const overallChoice = normalized.questions.find((question) => question.type === "choice");
    expect(overallChoice?.options.map((option) => option.key)).toEqual(["agency", "in_house"]);
  });

  it("replaces vague Score labels with self-contained situations", () => {
    const vague: JevPlan = {
      ...plan,
      questions: plan.questions.map((question) => question.type === "score"
        ? { ...question, levels: ["Very poor", "Fair", "Excellent"] }
        : question),
    };
    const normalized = normalizePlan(vague);
    const firstScore = normalized.questions.find((question) => question.type === "score");
    expect(firstScore?.levels[0]).toContain("Does not satisfy");
    expect(firstScore?.levels).toHaveLength(5);
  });

  it("builds the documented state + model + questions HTTP contract with exact state paths", () => {
    const normalized = normalizePlan(plan);
    const body = buildJevPayload(normalized, [{ key: "timeline", label: "Timeline", value: "Six weeks" }], "jev-test");

    expect(body.model).toBe("jev-test");
    expect(body.state.decision.confirmed_summary).toContain("fictional portal");
    expect(body.state.confirmed_requirements.timeline).toEqual({ label: "Timeline", value: "Six weeks" });
    expect(body.state.candidates.in_house.label).toBe("In-house");
    expect(body.state.evaluation_policy.criteria.speed.weight).toBeCloseTo(0.75);
    expect(body.state.evaluation_policy.hard_constraints.deadline.pass_condition).toContain("required deadline");
    expect(body.questions.agency_speed.type).toBe("score");
    expect(body.questions.agency_speed.instructions.inspect).toContain("`candidates.agency`");
    expect((body.questions.agency_deadline.criteria as { true: string }).true).toContain("deadline");
    expect(Object.values(body.questions).find((question) => question.type === "choice")?.criteria).toEqual({
      agency: "External agency",
      in_house: "Internal team",
    });
  });
});

describe("JEV response handling", () => {
  it("accepts a complete response and sends no conversation transcript", async () => {
    process.env.TYPESAFE_API_KEY = "test-key";
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body)) as {
        questions: Record<string, { type: "choice" | "score" | "noul"; criteria?: string[] | Record<string, string> }>;
      };
      const answers = Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
        if (question.type === "noul") return [id, { type: "noul", noul: 0.9 }];
        if (question.type === "choice") {
          const keys = Object.keys(question.criteria as Record<string, string>);
          return [id, {
            type: "choice",
            choice: keys[0],
            probabilities: Object.fromEntries(keys.map((key, index) => [key, index === 0 ? 1 : 0])),
            confidence: 1,
          }];
        }
        const levels = question.criteria as string[];
        return [id, {
          type: "score",
          score: levels.length - 1,
          legend: Object.fromEntries(levels.map((level, index) => [String(index), level])),
          probabilities: Object.fromEntries(levels.map((_, index) => [String(index), index === levels.length - 1 ? 1 : 0])),
          confidence: 1,
        }];
      }));
      return new Response(JSON.stringify({ model: "jev-test", answers, usage: { input_tokens: 20, output_tokens: 4 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const normalized = normalizePlan(plan);
    const result = await evaluateWithJev(normalized, [{ key: "timeline", label: "Timeline", value: "Six weeks" }]);
    expect(result.model).toBe("jev-test");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.state.source_conversation).toBeUndefined();
    expect(body.state.decision.confirmed_summary).toContain("fictional portal");
  });

  it("rejects missing answers instead of presenting a partial recommendation", () => {
    const normalized = normalizePlan(plan);
    expect(() => validateJevResult(normalized, {
      model: "jev-test",
      answers: { agency_deadline: { type: "noul", noul: 0.9 } },
      usage: { input_tokens: 1, output_tokens: 1 },
    })).toThrow(/omitted the answer/i);
  });

  it("rejects malformed probability distributions", () => {
    const normalized = normalizePlan(plan);
    const complete = Object.fromEntries(normalized.questions.map((question) => {
      if (question.type === "noul") return [question.id, { type: "noul", noul: 0.9 }];
      if (question.type === "choice") return [question.id, {
        type: "choice",
        choice: question.options[0].key,
        probabilities: { [question.options[0].key]: 1 },
        confidence: 1,
      }];
      return [question.id, {
        type: "score",
        score: 0,
        legend: Object.fromEntries(question.levels.map((level, index) => [String(index), level])),
        probabilities: Object.fromEntries(question.levels.map((_, index) => [String(index), index === 0 ? 1 : 0])),
        confidence: 1,
      }];
    }));
    expect(() => validateJevResult(normalized, { model: "jev-test", answers: complete })).toThrow(/probability distribution/i);
  });
});

describe("deterministic decision composition", () => {
  it("uses weighted Scores, blocks failed hard constraints, and retains Choice as a cross-check", () => {
    const normalized = normalizePlan(plan);
    const result: JevResult = {
      model: "jev-test",
      answers: {
        agency_speed: score(2, 0.75),
        in_house_speed: score(1, 0.65),
        agency_deadline: { type: "noul", noul: 0.42 },
        in_house_deadline: { type: "noul", noul: 0.9 },
        agency_control: score(1, 0.8),
        in_house_control: score(2, 0.8),
        diagnostic_best_option: {
          type: "choice",
          choice: "in_house",
          probabilities: { agency: 0.3, in_house: 0.7 },
          confidence: 0.7,
        },
      },
    };

    const composite = composeDecision(normalized, result);
    expect(composite.rankings.find((ranking) => ranking.optionKey === "agency")?.eligible).toBe(false);
    expect(composite.recommendedOption).toBe("in_house");
    expect(composite.needsReview).toBe(false);
    expect(composite.diagnosticChoice?.agreesWithComposite).toBe(true);
  });

  it("flags a confident diagnostic disagreement for review without letting Choice override code", () => {
    const normalized = normalizePlan(plan);
    const result: JevResult = {
      model: "jev-test",
      answers: {
        agency_speed: score(2),
        in_house_speed: score(1),
        agency_deadline: { type: "noul", noul: 0.95 },
        in_house_deadline: { type: "noul", noul: 0.95 },
        agency_control: score(2),
        in_house_control: score(1),
        diagnostic_best_option: {
          type: "choice",
          choice: "in_house",
          probabilities: { agency: 0.1, in_house: 0.9 },
          confidence: 0.9,
        },
      },
    };
    const composite = composeDecision(normalized, result);
    expect(composite.recommendedOption).toBe("agency");
    expect(composite.needsReview).toBe(true);
    expect(composite.reviewReason).toMatch(/cross-check disagrees/i);
  });

  it("does not mislabel a 50/50 Noul as zero Score confidence", () => {
    const normalized = normalizePlan(plan);
    const result: JevResult = {
      model: "jev-test",
      answers: {
        agency_speed: score(2, 0.8),
        in_house_speed: score(1, 0.8),
        agency_deadline: { type: "noul", noul: 0.5 },
        in_house_deadline: { type: "noul", noul: 0.5 },
        agency_control: score(2, 0.8),
        in_house_control: score(1, 0.8),
        diagnostic_best_option: {
          type: "choice",
          choice: "agency",
          probabilities: { agency: 0.7, in_house: 0.3 },
          confidence: 0.7,
        },
      },
    };
    const composite = composeDecision(normalized, result);
    expect(composite.confidence).toBeCloseTo(0.8);
    expect(composite.rankings[0].constraintCertainty).toBe(0);
    expect(composite.needsReview).toBe(true);
  });
});
