import { describe, expect, it } from "vitest";
import { coerceInterviewTurn, interviewTurnSchema } from "@/lib/schemas";

describe("interview response normalization", () => {
  it("caps oversized missing-topic arrays instead of failing the request", () => {
    const raw = {
      stage: "interviewing",
      assistantMessage: "Let’s clarify the remaining details.",
      completionScore: 42,
      parameters: [],
      missingTopics: Array.from({ length: 20 }, (_, index) => `topic_${index + 1}`),
      summary: "",
      question: {
        label: "Priority",
        prompt: "Which outcome matters most?",
        helpText: "Choose the result that would define success.",
        suggestions: ["Speed", "Cost", "Quality"],
      },
    };

    const turn = interviewTurnSchema.parse(coerceInterviewTurn(raw));
    expect(turn.missingTopics).toHaveLength(12);
    expect(turn.question.prompt).toBe("Which outcome matters most?");
  });

  it("repairs loose model output into the UI contract", () => {
    const turn = interviewTurnSchema.parse(coerceInterviewTurn({
      stage: "question",
      message: "What is your target budget?",
      completion_score: 30,
      parameters: { timeline: "Four months" },
      missing_parameters: { budget: true, risk: true },
    }));

    expect(turn.stage).toBe("interviewing");
    expect(turn.parameters[0]).toMatchObject({ key: "timeline", value: "Four months" });
    expect(turn.question.prompt).toBe("What is your target budget?");
    expect(turn.missingTopics).toEqual(["budget", "risk"]);
  });

  it("uses the confirmed understanding when the model leaves summary empty", () => {
    const turn = interviewTurnSchema.parse(coerceInterviewTurn({
      stage: "confirmation",
      assistantMessage: "Here’s what I understood: a complete fictional brief. Is this correct?",
      completionScore: 95,
      parameters: [{ key: "decision", label: "Decision", value: "Choose a vendor" }],
      missingTopics: [],
      summary: "",
      question: { label: "", prompt: "", helpText: "", suggestions: [] },
    }));

    expect(turn.summary).toContain("complete fictional brief");
  });
});
