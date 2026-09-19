export type Provider = "ollama" | "openai";

export type InterviewQuestion = {
  label: string;
  prompt: string;
  helpText: string;
  suggestions: string[];
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  intro?: string;
  question?: InterviewQuestion;
};

export type DecisionParameter = {
  key: string;
  label: string;
  value: string;
};

export type InterviewTurn = {
  stage: "interviewing" | "confirmation";
  assistantMessage: string;
  completionScore: number;
  parameters: DecisionParameter[];
  missingTopics: string[];
  summary: string;
  question: InterviewQuestion;
};

export type JevQuestionPlan = {
  id: string;
  label: string;
  type: "choice" | "score" | "noul";
  instructions: string;
  options: Array<{ key: string; description: string }>;
  levels: string[];
  positiveMeaning: string;
  negativeMeaning: string;
  optionKey: string;
  criterionKey: string;
  constraintKey: string;
  hardConstraint: boolean;
};

export type DecisionOption = {
  key: string;
  label: string;
  description: string;
  attributes?: Record<string, string | number | string[] | boolean>;
  evidence?: string;
};

export type DecisionCriterion = {
  key: string;
  label: string;
  description: string;
  weight: number;
};

export type DecisionConstraint = {
  key: string;
  label: string;
  description: string;
};

export type JevPlan = {
  title: string;
  decisionQuestion: string;
  stateSummary: string;
  options: DecisionOption[];
  criteria: DecisionCriterion[];
  hardConstraints: DecisionConstraint[];
  questions: JevQuestionPlan[];
};

export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};

export type ScoreAnswer = {
  type: "score";
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
};

export type NoulAnswer = {
  type: "noul";
  noul: number;
  confidence?: number;
};

export type JevAnswer = ChoiceAnswer | ScoreAnswer | NoulAnswer;

export type JevResult = {
  model: string;
  answers: Record<string, JevAnswer>;
  usage?: { input_tokens: number; output_tokens: number };
};

export type CompositeRanking = {
  optionKey: string;
  label: string;
  score: number;
  confidence: number;
  coverage: number;
  eligible: boolean;
  constraintProbability: number | null;
  constraintCertainty: number | null;
};

export type CompositeDecision = {
  recommendedOption: string;
  rankings: CompositeRanking[];
  confidence: number;
  needsReview: boolean;
  reviewReason: string;
  diagnosticChoice?: {
    optionKey: string;
    confidence: number;
    agreesWithComposite: boolean;
  };
};

export type DecisionResponse = {
  plan: JevPlan;
  result: JevResult;
  composite: CompositeDecision;
  generatedBy: Provider;
};
