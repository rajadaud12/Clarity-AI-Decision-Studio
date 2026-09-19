import { jevResultSchema } from "@/lib/schemas";
import type {
  CompositeDecision,
  DecisionParameter,
  JevPlan,
  JevQuestionPlan,
  JevResult,
} from "@/lib/types";

function safeId(value: string, index: number) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return normalized || `item_${index + 1}`;
}

export function normalizePlan(plan: JevPlan): JevPlan {
  const optionKeys = new Set<string>();
  const options = plan.options.map((option, index) => {
    let key = safeId(option.key, index);
    while (optionKeys.has(key)) key = `${key}_${index + 1}`.slice(0, 64);
    optionKeys.add(key);
    return { ...option, key };
  });

  const criterionKeys = new Set<string>();
  const rawCriteria = plan.criteria.map((criterion, index) => {
    let key = safeId(criterion.key, index);
    while (criterionKeys.has(key)) key = `${key}_${index + 1}`.slice(0, 64);
    criterionKeys.add(key);
    return { ...criterion, key, weight: Math.max(0, criterion.weight) };
  });
  const weightTotal = rawCriteria.reduce((total, criterion) => total + criterion.weight, 0);
  const criteria = rawCriteria.map((criterion) => ({
    ...criterion,
    weight: weightTotal > 0 ? criterion.weight / weightTotal : 1 / rawCriteria.length,
  }));

  const seen = new Set<string>();
  const questions = plan.questions.reduce<JevQuestionPlan[]>((normalized, question, index) => {
    let id = safeId(question.id, index);
    while (seen.has(id)) id = `${id}_${index + 1}`.slice(0, 64);
    seen.add(id);
    const optionKey = question.optionKey ? safeId(question.optionKey, index) : "";
    const criterionKey = question.criterionKey ? safeId(question.criterionKey, index) : "";

    if (question.type === "choice") {
      const choiceOptions = question.options.slice(0, 255);
      if (choiceOptions.length >= 2) {
        normalized.push({ ...question, id, optionKey: "", criterionKey: "", hardConstraint: false, options: choiceOptions, levels: [], positiveMeaning: "", negativeMeaning: "" });
      }
      return normalized;
    }
    if (question.type === "score") {
      const levels = question.levels.slice(0, 10);
      if (levels.length >= 2 && optionKeys.has(optionKey) && criterionKeys.has(criterionKey)) {
        normalized.push({ ...question, id, optionKey, criterionKey, hardConstraint: false, options: [], levels, positiveMeaning: "", negativeMeaning: "" });
      }
      return normalized;
    }
    if (optionKeys.has(optionKey)) {
      normalized.push({ ...question, id, optionKey, criterionKey, options: [], levels: [] });
    }
    return normalized;
  }, []);

  if (!questions.length) throw new Error("The generated JEV plan did not contain a valid atomic question.");
  return { ...plan, options, criteria, questions };
}

function toJevQuestion(question: JevQuestionPlan) {
  const instructions = {
    question: question.instructions,
    inspect: ["`decision_brief`", "`parameters`", "`options`"],
    focus: question.optionKey
      ? `Evaluate only option \`${question.optionKey}\`${question.criterionKey ? ` on criterion \`${question.criterionKey}\`` : ""}. Do not compare unrelated factors.`
      : "Evaluate only the single judgment stated in the question.",
  };

  if (question.type === "choice") {
    return {
      type: "choice",
      instructions,
      criteria: Object.fromEntries(question.options.map((option, index) => [safeId(option.key, index), { option: option.description }])),
    };
  }
  if (question.type === "score") {
    return { type: "score", instructions, criteria: question.levels };
  }
  return {
    type: "noul",
    instructions,
    ...(question.positiveMeaning || question.negativeMeaning
      ? {
          criteria: {
            true: question.positiveMeaning || "The proposition is true",
            false: question.negativeMeaning || "The proposition is false",
          },
        }
      : {}),
  };
}

const retryable = new Set([429, 529]);

export async function evaluateWithJev(plan: JevPlan, parameters: DecisionParameter[]): Promise<JevResult> {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw new Error("TYPESAFE_API_KEY is not configured.");

  const questions = Object.fromEntries(plan.questions.map((question) => [question.id, toJevQuestion(question)]));
  const payload = {
    model: process.env.TYPESAFE_MODEL || "jev-latest",
    state: {
      decision_question: plan.decisionQuestion,
      decision_brief: plan.stateSummary,
      parameters: Object.fromEntries(parameters.map((parameter) => [safeId(parameter.key, 0), parameter.value])),
      options: Object.fromEntries(plan.options.map((option) => [option.key, { label: option.label, description: option.description }])),
    },
    questions,
  };

  const endpoint = process.env.TYPESAFE_BASE_URL || "https://api.typesafe.ai/v1/systemone";

  console.log("\n==================== [JEV] OUTGOING API REQUEST ====================");
  console.log("Timestamp:", new Date().toISOString());
  console.log("Endpoint:", endpoint);
  console.log("Model:", payload.model);
  console.log("State Decision Question:", payload.state.decision_question);
  console.log("Parameters Count:", Object.keys(payload.state.parameters).length);
  console.log("Options Count:", Object.keys(payload.state.options).length);
  console.log("Questions Count:", Object.keys(payload.questions).length);
  console.log("FULL PAYLOAD SENT TO JEV:\n", JSON.stringify(payload, null, 2));
  console.log("====================================================================\n");

  let lastStatus = 500;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45_000),
    });
    lastStatus = response.status;

    if (response.ok) return jevResultSchema.parse(await response.json());

    const body = (await response.json().catch(() => null)) as { error?: { message?: string } | string } | null;
    if (!retryable.has(response.status) || attempt === 2) {
      const detail = typeof body?.error === "string" ? body.error : body?.error?.message;
      throw new Error(detail || `JEV returned ${response.status}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
  }
  throw new Error(`JEV returned ${lastStatus}.`);
}

export function composeDecision(plan: JevPlan, result: JevResult): CompositeDecision {
  const criteria = new Map(plan.criteria.map((criterion) => [criterion.key, criterion]));
  const rankings = plan.options.map((option) => {
    let weightedScore = 0;
    let coveredWeight = 0;
    let confidenceTotal = 0;
    let confidenceWeight = 0;
    const constraints: number[] = [];

    plan.questions.forEach((question) => {
      if (question.optionKey !== option.key) return;
      const answer = result.answers[question.id];
      if (!answer) return;
      if (question.type === "score" && answer.type === "score") {
        const criterion = criteria.get(question.criterionKey);
        if (!criterion || question.levels.length < 2) return;
        const normalized = Math.max(0, Math.min(1, answer.score / (question.levels.length - 1)));
        weightedScore += normalized * criterion.weight;
        coveredWeight += criterion.weight;
        confidenceTotal += answer.confidence * criterion.weight;
        confidenceWeight += criterion.weight;
      }
      if (question.type === "noul" && question.hardConstraint && answer.type === "noul") {
        constraints.push(answer.noul);
      }
    });

    return {
      optionKey: option.key,
      label: option.label,
      score: coveredWeight > 0 ? weightedScore / coveredWeight : 0,
      confidence: confidenceWeight > 0 ? confidenceTotal / confidenceWeight : 0,
      coverage: Math.min(1, coveredWeight),
      eligible: constraints.every((probability) => probability >= 0.7),
      constraintProbability: constraints.length ? Math.min(...constraints) : null,
    };
  });

  if (!rankings.some((ranking) => ranking.coverage > 0)) {
    const choice = Object.values(result.answers).find((answer) => answer.type === "choice");
    if (choice?.type === "choice") {
      rankings.forEach((ranking) => {
        ranking.score = choice.probabilities[ranking.optionKey] || 0;
        ranking.confidence = choice.confidence;
        ranking.coverage = 1;
      });
    }
  }

  rankings.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score);
  const top = rankings[0];
  const second = rankings.slice(1).find((ranking) => ranking.eligible === top?.eligible);
  const margin = second ? top.score - second.score : 1;
  let reviewReason = "";
  if (!rankings.some((ranking) => ranking.eligible)) reviewReason = "No option clears every hard constraint with sufficient probability.";
  else if (top.coverage < 0.75) reviewReason = "Too little of the weighted criteria was evaluated.";
  else if (top.confidence < 0.55) reviewReason = "JEV confidence is low; gather more evidence before acting.";
  else if (margin < 0.05) reviewReason = "The leading options are too close to distinguish reliably.";

  return {
    recommendedOption: top?.optionKey || "",
    rankings,
    confidence: top?.confidence || 0,
    needsReview: Boolean(reviewReason),
    reviewReason,
  };
}
