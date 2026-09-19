import { z } from "zod";

export const providerSchema = z.enum(["ollama", "openai"]);

export const interviewQuestionSchema = z.object({
  label: z.string().max(80),
  prompt: z.string().max(600),
  helpText: z.string().max(800),
  suggestions: z.array(z.string().min(1).max(240)).max(5),
});

export const chatMessageSchema = z.object({
  id: z.string().max(120),
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(20_000),
  createdAt: z.string().optional(),
  question: interviewQuestionSchema.optional(),
});

export const parameterSchema = z.object({
  key: z.string().min(1).max(80),
  label: z.string().min(1).max(120),
  value: z.string().min(1).max(1_000),
});

export const interviewTurnSchema = z.object({
  stage: z.enum(["interviewing", "confirmation"]),
  assistantMessage: z.string().min(1).max(4_000),
  completionScore: z.number().min(0).max(100),
  parameters: z.array(parameterSchema).max(24),
  missingTopics: z.array(z.string().max(160)).max(12),
  summary: z.string().max(6_000),
  question: interviewQuestionSchema,
});

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function labelFromKey(value: string) {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stringList(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => text(item)).filter(Boolean);
  }
  if (value !== null && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>);
  }
  return [];
}

export function coerceInterviewTurn(value: unknown) {
  const source = record(value);
  const rawStage = text(source.stage).toLowerCase();
  const stage = rawStage.includes("confirm") || rawStage.includes("review")
    ? "confirmation"
    : "interviewing";

  const rawParameters = source.parameters;
  const parameterCandidates: Array<{ key: string; label: string; value: string }> = [];
  const misplacedTopics: string[] = [];

  if (Array.isArray(rawParameters)) {
    rawParameters.forEach((item, index) => {
      if (typeof item === "string") {
        misplacedTopics.push(item);
        return;
      }
      const entry = record(item);
      const key = text(entry.key, `parameter_${index + 1}`);
      const valueText = text(entry.value);
      if (!valueText) return;
      parameterCandidates.push({
        key,
        label: text(entry.label, labelFromKey(key)),
        value: valueText,
      });
    });
  } else {
    Object.entries(record(rawParameters)).forEach(([key, item]) => {
      const entry = record(item);
      const valueText = text(entry.value, text(item));
      if (!valueText) return;
      parameterCandidates.push({ key, label: text(entry.label, labelFromKey(key)), value: valueText });
    });
  }

  const parameterKeys = new Set<string>();
  const parameters = parameterCandidates.filter((item) => {
    const key = item.key.toLowerCase();
    if (parameterKeys.has(key)) return false;
    parameterKeys.add(key);
    return true;
  }).slice(0, 24);

  const rawMissing = source.missingTopics ?? source.missing_topics ?? source.missingParameters ?? source.missing_parameters;
  const topicKeys = new Set<string>();
  const missingTopics = [...stringList(rawMissing), ...misplacedTopics].filter((item) => {
    const key = item.toLowerCase();
    if (topicKeys.has(key)) return false;
    topicKeys.add(key);
    return true;
  }).slice(0, 12);

  const rawQuestion = source.question;
  const questionSource = record(rawQuestion);
  const assistantMessage = text(
    source.assistantMessage ?? source.assistant_message ?? source.message,
    stage === "confirmation" ? "Here’s what I understood. Is this correct?" : "Let’s make the decision more precise.",
  );
  const suggestions = stringList(
    questionSource.suggestions ?? questionSource.examples ?? questionSource.options ?? source.suggestions,
  ).slice(0, 5);
  const prompt = stage === "confirmation"
    ? ""
    : text(questionSource.prompt ?? source.questionPrompt ?? source.question_prompt, typeof rawQuestion === "string" ? rawQuestion : assistantMessage);

  const numericScore = Number(source.completionScore ?? source.completion_score ?? 0);
  const rawSummary = text(source.summary);

  return {
    stage,
    assistantMessage,
    completionScore: Number.isFinite(numericScore) ? Math.max(0, Math.min(100, numericScore)) : 0,
    parameters,
    missingTopics,
    summary: stage === "confirmation" && !rawSummary ? assistantMessage : rawSummary,
    question: {
      label: stage === "confirmation" ? "" : text(questionSource.label, "Next question"),
      prompt,
      helpText: stage === "confirmation"
        ? ""
        : text(questionSource.helpText ?? questionSource.help_text, suggestions.length ? "Choose an example or write your own answer." : "Answer in your own words."),
      suggestions,
    },
  };
}

export const interviewBriefSchema = z.object({
  completionScore: z.number().min(0).max(100).default(0),
  parameters: z.array(parameterSchema).max(24).default([]),
  missingTopics: z.array(z.string().max(160)).max(12).default([]),
  summary: z.string().max(6_000).default(""),
});

export const interviewRequestSchema = z.object({
  provider: providerSchema.default("ollama"),
  messages: z.array(chatMessageSchema).min(1).max(80),
  brief: interviewBriefSchema.optional(),
});

const optionSchema = z.object({
  key: z.string().min(1).max(80),
  description: z.string().min(1).max(600),
});

const decisionOptionSchema = z.object({
  key: z.string().min(1).max(80),
  label: z.string().min(1).max(120),
  description: z.string().min(1).max(800),
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.array(z.string()), z.boolean()])).default({}),
  evidence: z.string().max(2000).default(""),
});

const decisionCriterionSchema = z.object({
  key: z.string().min(1).max(80),
  label: z.string().min(1).max(120),
  description: z.string().min(1).max(600),
  weight: z.number().min(0).max(1),
});

const decisionConstraintSchema = z.object({
  key: z.string().min(1).max(80),
  label: z.string().min(1).max(120),
  description: z.string().min(1).max(600),
});

export const jevQuestionPlanSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(160),
  type: z.enum(["choice", "score", "noul"]),
  instructions: z.string().min(1).max(1_200),
  options: z.array(optionSchema).max(20).default([]),
  levels: z.array(z.string().min(1).max(300)).max(10).default([]),
  positiveMeaning: z.string().max(500).default(""),
  negativeMeaning: z.string().max(500).default(""),
  optionKey: z.string().max(80).default(""),
  criterionKey: z.string().max(80).default(""),
  constraintKey: z.string().max(80).default(""),
  hardConstraint: z.boolean().default(false),
});

export const jevPlanSchema = z.object({
  title: z.string().min(1).max(180),
  decisionQuestion: z.string().min(1).max(600),
  stateSummary: z.string().min(1).max(8_000),
  options: z.array(decisionOptionSchema).min(2).max(6),
  criteria: z.array(decisionCriterionSchema).min(1).max(6),
  hardConstraints: z.array(decisionConstraintSchema).max(8).default([]),
  questions: z.array(jevQuestionPlanSchema).min(1).max(96),
});

const choiceAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  probabilities: z.record(z.string(), z.number().min(0).max(1)),
  confidence: z.number().min(0).max(1),
});

const scoreAnswerSchema = z.object({
  type: z.literal("score"),
  score: z.number().min(0),
  legend: z.record(z.string(), z.string()),
  probabilities: z.record(z.string(), z.number().min(0).max(1)),
  confidence: z.number().min(0).max(1),
});

const noulAnswerSchema = z.object({
  type: z.literal("noul"),
  noul: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1).optional(),
});

export const jevResultSchema = z.object({
  model: z.string().min(1),
  answers: z.record(z.string(), z.discriminatedUnion("type", [choiceAnswerSchema, scoreAnswerSchema, noulAnswerSchema])),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).optional(),
});

export const decisionRequestSchema = z.object({
  provider: providerSchema.default("ollama"),
  messages: z.array(chatMessageSchema).min(2).max(80),
  parameters: z.array(parameterSchema).min(1).max(24),
  summary: z.string().min(1).max(8_000),
});

export const INTERVIEW_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["stage", "assistantMessage", "completionScore", "parameters", "missingTopics", "summary", "question"],
  properties: {
    stage: { type: "string", enum: ["interviewing", "confirmation"] },
    assistantMessage: { type: "string" },
    completionScore: { type: "number", minimum: 0, maximum: 100 },
    parameters: {
      type: "array",
      maxItems: 24,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "label", "value"],
        properties: {
          key: { type: "string" },
          label: { type: "string" },
          value: { type: "string" },
        },
      },
    },
    missingTopics: { type: "array", maxItems: 12, items: { type: "string", maxLength: 160 } },
    summary: { type: "string" },
    question: {
      type: "object",
      additionalProperties: false,
      required: ["label", "prompt", "helpText", "suggestions"],
      properties: {
        label: { type: "string", maxLength: 80 },
        prompt: { type: "string", maxLength: 600 },
        helpText: { type: "string", maxLength: 800 },
        suggestions: { type: "array", maxItems: 5, items: { type: "string", maxLength: 240 } },
      },
    },
  },
} as const;

export const JEV_PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "decisionQuestion", "stateSummary", "options", "criteria", "hardConstraints", "questions"],
  properties: {
    title: { type: "string" },
    decisionQuestion: { type: "string" },
    stateSummary: { type: "string" },
    options: {
      type: "array",
      minItems: 2,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: true,
        required: ["key", "label", "description"],
        properties: {
          key: { type: "string" },
          label: { type: "string" },
          description: { type: "string" },
          attributes: {
            type: "object",
            description: "Concrete candidate data, specifications, pricing, benchmarks, ports, and evidence matching the brief",
          },
          evidence: { type: "string" },
        },
      },
    },
    criteria: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "label", "description", "weight"],
        properties: {
          key: { type: "string" }, label: { type: "string" }, description: { type: "string" },
          weight: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    hardConstraints: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "label", "description"],
        properties: {
          key: { type: "string" }, label: { type: "string" }, description: { type: "string" },
        },
      },
    },
    questions: {
      type: "array",
      minItems: 1,
      maxItems: 96,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "type", "instructions", "options", "levels", "positiveMeaning", "negativeMeaning", "optionKey", "criterionKey", "constraintKey", "hardConstraint"],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          type: { type: "string", enum: ["choice", "score", "noul"] },
          instructions: { type: "string" },
          options: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["key", "description"],
              properties: {
                key: { type: "string" },
                description: { type: "string" },
              },
            },
          },
          levels: { type: "array", items: { type: "string" } },
          positiveMeaning: { type: "string" },
          negativeMeaning: { type: "string" },
          optionKey: { type: "string" },
          criterionKey: { type: "string" },
          constraintKey: { type: "string" },
          hardConstraint: { type: "boolean" },
        },
      },
    },
  },
} as const;
