import { jevResultSchema } from "@/lib/schemas";
import type {
  CompositeDecision,
  DecisionParameter,
  JevAnswer,
  JevPlan,
  JevQuestionPlan,
  JevResult,
} from "@/lib/types";

const HARD_CONSTRAINT_PASS = 0.7;
const LOW_CONFIDENCE = 0.55;
const CLOSE_MARGIN = 0.05;

function safeId(value: string, index: number) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return normalized || `item_${index + 1}`;
}

function uniqueId(preferred: string, used: Set<string>, index: number) {
  const base = safeId(preferred, index);
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base.slice(0, Math.max(1, 63 - String(suffix).length))}_${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function defaultLevels(criterion: JevPlan["criteria"][number]) {
  const target = criterion.description || criterion.label;
  return [
    `Does not satisfy ${target}.`,
    `Satisfies only a small part of ${target}; major gaps remain.`,
    `Partially satisfies ${target}; material tradeoffs or unknowns remain.`,
    `Satisfies most of ${target}; remaining gaps are manageable.`,
    `Strongly satisfies ${target} with clear supporting evidence.`,
  ];
}

function hasConcreteLevels(levels: string[]) {
  const vague = /^(?:very\s+)?(?:poor|fair|good|excellent|low|medium|high|weak|strong|average|neutral)$/i;
  const numeric = /^\d+(?:\.\d+)?$/;
  return levels.length >= 2 && levels.every((level) => {
    const value = level.trim();
    return value.length >= 12 && !vague.test(value) && !numeric.test(value);
  });
}

export function normalizePlan(plan: JevPlan): JevPlan {
  const optionKeys = new Set<string>();
  const optionAliases = new Map<string, string>();
  const options = plan.options.map((option, index) => {
    const key = uniqueId(option.key || option.label, optionKeys, index);
    if (!optionAliases.has(option.key)) optionAliases.set(option.key, key);
    if (!optionAliases.has(safeId(option.key, index))) optionAliases.set(safeId(option.key, index), key);
    return { ...option, key };
  });

  const criterionKeys = new Set<string>();
  const criterionAliases = new Map<string, string>();
  const rawCriteria = plan.criteria.map((criterion, index) => {
    const key = uniqueId(criterion.key || criterion.label, criterionKeys, index);
    if (!criterionAliases.has(criterion.key)) criterionAliases.set(criterion.key, key);
    if (!criterionAliases.has(safeId(criterion.key, index))) criterionAliases.set(safeId(criterion.key, index), key);
    return { ...criterion, key, weight: Math.max(0, criterion.weight) };
  });
  const weightTotal = rawCriteria.reduce((total, criterion) => total + criterion.weight, 0);
  const criteria = rawCriteria.map((criterion) => ({
    ...criterion,
    weight: weightTotal > 0 ? criterion.weight / weightTotal : 1 / rawCriteria.length,
  }));

  const constraintKeys = new Set<string>();
  const constraintAliases = new Map<string, string>();
  const hardConstraints = plan.hardConstraints.map((constraint, index) => {
    const key = uniqueId(constraint.key || constraint.label, constraintKeys, index);
    if (!constraintAliases.has(constraint.key)) constraintAliases.set(constraint.key, key);
    if (!constraintAliases.has(safeId(constraint.key, index))) constraintAliases.set(safeId(constraint.key, index), key);
    return { ...constraint, key };
  });

  const resolveOption = (value: string) => optionAliases.get(value) || optionAliases.get(safeId(value, 0)) || "";
  const resolveCriterion = (value: string) => criterionAliases.get(value) || criterionAliases.get(safeId(value, 0)) || "";
  const resolveConstraint = (value: string) => constraintAliases.get(value) || constraintAliases.get(safeId(value, 0)) || "";
  const ids = new Set<string>();
  const scorePairs = new Set<string>();
  const constraintPairs = new Set<string>();
  const questions = plan.questions.reduce<JevQuestionPlan[]>((normalized, question, index) => {
    const id = uniqueId(question.id || question.label, ids, index);
    const optionKey = question.optionKey ? resolveOption(question.optionKey) : "";
    const criterionKey = question.criterionKey ? resolveCriterion(question.criterionKey) : "";
    const constraintKey = question.constraintKey ? resolveConstraint(question.constraintKey) : "";

    if (question.type === "choice") {
      const choiceKeys = new Set<string>();
      const choiceOptions = question.options.reduce<Array<{ key: string; description: string }>>((items, option, optionIndex) => {
        const key = resolveOption(option.key) || safeId(option.key, optionIndex);
        if (choiceKeys.has(key)) return items;
        choiceKeys.add(key);
        items.push({ key, description: option.description });
        return items;
      }, []).slice(0, 255);
      if (choiceOptions.length >= 2) {
        normalized.push({ ...question, id, optionKey: "", criterionKey: "", constraintKey: "", hardConstraint: false, options: choiceOptions, levels: [], positiveMeaning: "", negativeMeaning: "" });
      }
      return normalized;
    }

    if (question.type === "score") {
      const criterion = criteria.find((item) => item.key === criterionKey);
      const proposedLevels = question.levels.slice(0, 10);
      const levels = criterion && !hasConcreteLevels(proposedLevels) ? defaultLevels(criterion) : proposedLevels;
      const pair = `${optionKey}:${criterionKey}`;
      if (levels.length >= 2 && optionKeys.has(optionKey) && criterionKeys.has(criterionKey) && !scorePairs.has(pair)) {
        scorePairs.add(pair);
        normalized.push({ ...question, id, optionKey, criterionKey, constraintKey: "", hardConstraint: false, options: [], levels, positiveMeaning: "", negativeMeaning: "" });
      }
      return normalized;
    }

    if (optionKeys.has(optionKey) && (!question.hardConstraint || constraintKeys.has(constraintKey))) {
      const pair = `${optionKey}:${constraintKey}`;
      if (question.hardConstraint && constraintPairs.has(pair)) return normalized;
      if (question.hardConstraint) constraintPairs.add(pair);
      normalized.push({ ...question, id, optionKey, criterionKey, constraintKey, options: [], levels: [] });
    }
    return normalized;
  }, []);

  // A complete matrix is a code-level invariant. Repair plan-model omissions with
  // conservative criterion-specific questions instead of hiding partial coverage.
  options.forEach((option, optionIndex) => {
    criteria.forEach((criterion, criterionIndex) => {
      const pair = `${option.key}:${criterion.key}`;
      if (scorePairs.has(pair)) return;
      scorePairs.add(pair);
      questions.push({
        id: uniqueId(`${option.key}_${criterion.key}`, ids, optionIndex * criteria.length + criterionIndex),
        label: `${option.label} · ${criterion.label}`,
        type: "score",
        instructions: `How well does ${option.label} satisfy ${criterion.label}, based only on the supplied evidence? Preserve uncertainty when evidence is missing.`,
        options: [],
        levels: defaultLevels(criterion),
        positiveMeaning: "",
        negativeMeaning: "",
        optionKey: option.key,
        criterionKey: criterion.key,
        constraintKey: "",
        hardConstraint: false,
      });
    });
  });

  // Hard constraints are also a complete matrix. Each Noul stays atomic: one
  // candidate, one pass condition, one probability.
  options.forEach((option, optionIndex) => {
    hardConstraints.forEach((constraint, constraintIndex) => {
      const pair = `${option.key}:${constraint.key}`;
      if (constraintPairs.has(pair)) return;
      constraintPairs.add(pair);
      questions.push({
        id: uniqueId(`${option.key}_${constraint.key}`, ids, optionIndex * Math.max(1, hardConstraints.length) + constraintIndex),
        label: `${option.label} · ${constraint.label}`,
        type: "noul",
        instructions: `Does ${option.label} satisfy this non-negotiable: ${constraint.description}? Use only supplied evidence; missing evidence should remain uncertain.`,
        options: [],
        levels: [],
        positiveMeaning: `${option.label} satisfies ${constraint.description}`,
        negativeMeaning: `${option.label} does not satisfy ${constraint.description}`,
        optionKey: option.key,
        criterionKey: "",
        constraintKey: constraint.key,
        hardConstraint: true,
      });
    });
  });

  const candidateKeys = new Set(options.map((option) => option.key));
  const hasCandidateChoice = questions.some((question) =>
    question.type === "choice"
    && question.options.length === candidateKeys.size
    && question.options.every((option) => candidateKeys.has(option.key)),
  );
  if (!hasCandidateChoice) {
    questions.push({
      id: uniqueId("diagnostic_best_option", ids, questions.length),
      label: "Independent overall cross-check",
      type: "choice",
      instructions: "Which candidate best satisfies the confirmed decision, requirements, priorities, and constraints? Use only supplied evidence and treat missing evidence as uncertainty. This is an independent cross-check; do not invent current facts.",
      options: options.map((option) => ({ key: option.key, description: option.description })),
      levels: [],
      positiveMeaning: "",
      negativeMeaning: "",
      optionKey: "",
      criterionKey: "",
      constraintKey: "",
      hardConstraint: false,
    });
  }

  if (!questions.length) throw new Error("The generated JEV plan did not contain a valid atomic question.");
  return { ...plan, options, criteria, hardConstraints, questions };
}

function toJevQuestion(question: JevQuestionPlan) {
  const optionPath = question.optionKey ? `\`candidates.${question.optionKey}\`` : "`candidates`";
  const criterionPath = question.criterionKey ? `\`evaluation_policy.criteria.${question.criterionKey}\`` : "`evaluation_policy`";
  const constraintPath = question.constraintKey ? `\`evaluation_policy.hard_constraints.${question.constraintKey}\`` : "";
  const instructions = {
    question: question.instructions,
    inspect: question.type === "choice"
      ? ["`decision`", "`confirmed_requirements`", "`candidates`", "`evaluation_policy`"]
      : [optionPath, ...(constraintPath ? [constraintPath] : [criterionPath]), "`confirmed_requirements`", "`decision`"],
    focus: question.type === "choice"
      ? "Compare only the supplied candidates against the confirmed policy. Missing evidence should lower certainty, not be filled with assumed facts."
      : `Evaluate only ${optionPath}${constraintPath ? ` against ${constraintPath}` : question.criterionKey ? ` against ${criterionPath}` : ""}. Do not compare unrelated factors or assume facts absent from the state.`,
  };

  if (question.type === "choice") {
    return {
      type: "choice" as const,
      instructions,
      criteria: Object.fromEntries(question.options.map((option) => [option.key, option.description])),
    };
  }
  if (question.type === "score") {
    return { type: "score" as const, instructions, criteria: question.levels };
  }
  return {
    type: "noul" as const,
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

export function buildJevPayload(plan: JevPlan, parameters: DecisionParameter[], model = process.env.TYPESAFE_MODEL || "jev-latest") {
  return {
    model,
    state: {
      decision: {
        question: plan.decisionQuestion,
        confirmed_summary: plan.stateSummary,
      },
      confirmed_requirements: Object.fromEntries(parameters.map((parameter, index) => [
        safeId(parameter.key, index),
        { label: parameter.label, value: parameter.value },
      ])),
      candidates: Object.fromEntries(plan.options.map((option) => [
        option.key,
        { label: option.label, description: option.description },
      ])),
      evaluation_policy: {
        composition: "Weighted scores determine fit. Hard constraints gate eligibility. The overall Choice is diagnostic only.",
        criteria: Object.fromEntries(plan.criteria.map((criterion) => [
          criterion.key,
          { label: criterion.label, description: criterion.description, weight: criterion.weight },
        ])),
        hard_constraints: Object.fromEntries(plan.hardConstraints.map((constraint) => [
          constraint.key,
          { label: constraint.label, pass_condition: constraint.description },
        ])),
      },
    },
    questions: Object.fromEntries(plan.questions.map((question) => [question.id, toJevQuestion(question)])),
  };
}

function assertDistribution(probabilities: Record<string, number>, expectedKeys: string[], answerId: string) {
  const actualKeys = Object.keys(probabilities);
  if (actualKeys.length !== expectedKeys.length || expectedKeys.some((key) => !(key in probabilities))) {
    throw new Error(`JEV returned an invalid probability distribution for ${answerId}.`);
  }
  const total = Object.values(probabilities).reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 1) > 0.02) {
    throw new Error(`JEV probabilities for ${answerId} do not sum to 1.`);
  }
}

export function validateJevResult(plan: JevPlan, value: unknown): JevResult {
  const result = jevResultSchema.parse(value);
  plan.questions.forEach((question) => {
    const answer = result.answers[question.id];
    if (!answer) throw new Error(`JEV omitted the answer for ${question.id}.`);
    if (answer.type !== question.type) throw new Error(`JEV returned the wrong answer type for ${question.id}.`);
    if (answer.type === "choice") {
      const keys = question.options.map((option) => option.key);
      if (!keys.includes(answer.choice)) throw new Error(`JEV selected an unknown option for ${question.id}.`);
      assertDistribution(answer.probabilities, keys, question.id);
    }
    if (answer.type === "score") {
      const keys = question.levels.map((_, index) => String(index));
      if (answer.score < 0 || answer.score > question.levels.length - 1) {
        throw new Error(`JEV returned an out-of-range score for ${question.id}.`);
      }
      assertDistribution(answer.probabilities, keys, question.id);
    }
  });
  return result;
}

const retryable = new Set([429, 529]);

function errorDetail(body: unknown, status: number) {
  if (typeof body === "string" && body.trim()) return body.slice(0, 500);
  if (body && typeof body === "object") {
    const source = body as { detail?: unknown; message?: unknown; error?: unknown };
    if (typeof source.detail === "string") return source.detail;
    if (typeof source.message === "string") return source.message;
    if (typeof source.error === "string") return source.error;
    if (source.error && typeof source.error === "object" && "message" in source.error && typeof source.error.message === "string") return source.error.message;
  }
  return `JEV returned ${status}.`;
}

function retryDelay(response: Response, attempt: number) {
  const retryAfter = response.headers.get("retry-after");
  const seconds = retryAfter ? Number(retryAfter) : Number.NaN;
  return Number.isFinite(seconds) ? Math.min(5_000, Math.max(0, seconds * 1_000)) : 400 * 2 ** attempt;
}

export async function evaluateWithJev(plan: JevPlan, parameters: DecisionParameter[]): Promise<JevResult> {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw new Error("TYPESAFE_API_KEY is not configured.");

  const payload = buildJevPayload(plan, parameters);
  const endpoint = process.env.TYPESAFE_BASE_URL || "https://api.typesafe.ai/v1/systemone";

  console.log("\n==================== [JEV API OUTGOING PAYLOAD] ====================");
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Endpoint: ${endpoint}`);
  console.log(`Model: ${payload.model}`);
  console.log(`Decision Question: ${payload.state.decision.question}`);
  console.log(`Candidates: ${Object.keys(payload.state.candidates).join(", ")}`);
  console.log(`Questions Count: ${Object.keys(payload.questions).length}`);
  console.log("FULL PAYLOAD SENT TO JEV API:\n" + JSON.stringify(payload, null, 2));
  console.log("====================================================================\n");

  let lastError: Error = new Error("JEV evaluation failed.");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(45_000),
      });

      if (response.ok) {
        const body = await response.json().catch(() => {
          throw new Error("JEV returned a non-JSON success response.");
        });
        return validateJevResult(plan, body);
      }

      const raw = await response.text();
      let body: unknown = raw;
      try { body = JSON.parse(raw); } catch { /* keep the text error */ }
      lastError = new Error(errorDetail(body, response.status));
      if (!retryable.has(response.status) || attempt === 2) throw lastError;
      await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("JEV evaluation failed.");
      if (attempt === 2 || (lastError.name !== "TimeoutError" && lastError.name !== "AbortError" && !(lastError instanceof TypeError))) {
        throw lastError;
      }
      await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
    }
  }
  throw lastError;
}

function candidateChoice(plan: JevPlan, answers: Record<string, JevAnswer>) {
  const candidateKeys = new Set(plan.options.map((option) => option.key));
  const question = plan.questions.find((item) =>
    item.type === "choice"
    && item.options.length === candidateKeys.size
    && item.options.every((option) => candidateKeys.has(option.key)),
  );
  const answer = question ? answers[question.id] : undefined;
  return answer?.type === "choice" ? answer : undefined;
}

export function composeDecision(plan: JevPlan, result: JevResult): CompositeDecision {
  const criteria = new Map(plan.criteria.map((criterion) => [criterion.key, criterion]));
  const diagnostic = candidateChoice(plan, result.answers);
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

    const scoreConfidence = confidenceWeight > 0 ? confidenceTotal / confidenceWeight : 0;
    const constraintCertainty = constraints.length
      ? Math.min(...constraints.map((probability) => Math.abs(probability - 0.5) * 2))
      : 1;
    return {
      optionKey: option.key,
      label: option.label,
      score: coveredWeight > 0 ? weightedScore / coveredWeight : diagnostic?.probabilities[option.key] || 0,
      confidence: coveredWeight > 0 ? Math.min(scoreConfidence, constraintCertainty) : diagnostic?.confidence || 0,
      coverage: Math.min(1, coveredWeight || (diagnostic ? 1 : 0)),
      eligible: constraints.every((probability) => probability >= HARD_CONSTRAINT_PASS),
      constraintProbability: constraints.length ? Math.min(...constraints) : null,
    };
  });

  rankings.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score);
  const top = rankings[0];
  const second = rankings.slice(1).find((ranking) => ranking.eligible === top?.eligible);
  const margin = second ? top.score - second.score : 1;
  const reviewReasons: string[] = [];
  if (!rankings.some((ranking) => ranking.eligible)) reviewReasons.push("No option clears every hard constraint with sufficient probability.");
  if (top && top.coverage < 0.95) reviewReasons.push("Some weighted criteria were not evaluated for the leading option.");
  if (top && top.confidence < LOW_CONFIDENCE) reviewReasons.push("JEV reports low confidence; gather more evidence before acting.");
  if (second && margin < CLOSE_MARGIN) reviewReasons.push("The leading options are too close to distinguish reliably.");
  if (top && diagnostic && diagnostic.choice !== top.optionKey && diagnostic.confidence >= 0.65) {
    reviewReasons.push("The independent overall cross-check disagrees with the weighted result.");
  }

  return {
    recommendedOption: top?.optionKey || "",
    rankings,
    confidence: top?.confidence || 0,
    needsReview: reviewReasons.length > 0,
    reviewReason: reviewReasons.join(" "),
    ...(diagnostic && top ? {
      diagnosticChoice: {
        optionKey: diagnostic.choice,
        confidence: diagnostic.confidence,
        agreesWithComposite: diagnostic.choice === top.optionKey,
      },
    } : {}),
  };
}
