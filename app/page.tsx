"use client";

import {
  ArrowRight,
  Award,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Copy,
  Gauge,
  Menu,
  MessageSquareText,
  Plus,
  RotateCcw,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import Image from "next/image";
import { FormEvent, useEffect, useRef, useState } from "react";
import botLogo from "@/lib/BotLogo.webp";
import type {
  ChatMessage,
  DecisionParameter,
  DecisionResponse,
  InterviewTurn,
  Provider,
} from "@/lib/types";

type Config = {
  providers: Record<Provider, { configured: boolean; model: string }>;
  jev: { configured: boolean; model: string };
};

type SavedChat = {
  id: string;
  title: string;
  updatedAt: string;
  provider: Provider;
  messages: ChatMessage[];
  turn: InterviewTurn | null;
  decision: DecisionResponse | null;
};

const RECENT_CHATS_KEY = "askjev-recent-chats";

const starters = [
  {
    icon: Target,
    title: "Choose a direction",
    prompt: "I need to choose the right growth strategy for my business.",
  },
  {
    icon: BarChart3,
    title: "Compare options",
    prompt: "Help me compare several options and decide which one fits best.",
  },
  {
    icon: ShieldCheck,
    title: "Evaluate a risk",
    prompt: "I need to make a high-stakes decision and understand the tradeoffs.",
  },
];

function uid() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

function titleCase(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function percent(value: number) {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function BotLogo({ className = "" }: { className?: string }) {
  return <Image className={className} src={botLogo} alt="" priority />;
}

function ModelMark({ provider }: { provider: Provider }) {
  return provider === "ollama" ? (
    <span className="model-mark model-mark--ollama">O</span>
  ) : (
    <span className="model-mark model-mark--openai">✦</span>
  );
}

function SettingsModal({
  open,
  onClose,
  provider,
  setProvider,
  config,
}: {
  open: boolean;
  onClose: () => void;
  provider: Provider;
  setProvider: (provider: Provider) => void;
  config: Config | null;
}) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-heading">
          <div>
            <span className="eyebrow">Settings</span>
            <h2 id="settings-title">Choose your AI guide</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close settings"><X size={18} /></button>
        </div>
        <p className="modal-copy">The selected model clarifies your decision and prepares the structured JEV analysis.</p>
        <div className="provider-options">
          {(["ollama", "openai"] as Provider[]).map((item) => {
            const info = config?.providers[item];
            const active = item === provider;
            return (
              <button
                className={`provider-card ${active ? "provider-card--active" : ""}`}
                key={item}
                onClick={() => setProvider(item)}
                disabled={info ? !info.configured : false}
              >
                <ModelMark provider={item} />
                <span className="provider-card__body">
                  <strong>{item === "ollama" ? "Ollama Cloud" : "OpenAI"}</strong>
                  <span>{info?.model || (item === "ollama" ? "gpt-oss:120b" : "gpt-5.6-luna")}</span>
                </span>
                {active ? <CheckCircle2 size={20} /> : <span className={`status-dot ${info?.configured ? "" : "status-dot--off"}`} />}
              </button>
            );
          })}
        </div>
        {config?.providers.openai && !config.providers.openai.configured && (
          <div className="notice"><CircleAlert size={16} /><span>Add <code>OPENAI_API_KEY</code> to <code>.env.local</code> to enable Luna.</span></div>
        )}
        <div className="jev-status">
          <div className="jev-orb"><BotLogo /></div>
          <div><strong>JEV decision engine</strong><span>{config?.jev.model || "jev-latest"}</span></div>
          <span className={`connection-pill ${config?.jev.configured ? "" : "connection-pill--off"}`}>{config?.jev.configured ? "Connected" : "Not configured"}</span>
        </div>
        <button className="primary-button primary-button--full" onClick={onClose}>Save preference</button>
      </section>
    </div>
  );
}

function MessageBubble({
  message,
  onSuggestion,
  onCancelRevision,
}: {
  message: ChatMessage;
  onSuggestion?: (suggestion: string) => void;
  onCancelRevision?: () => void;
}) {
  const assistant = message.role === "assistant";
  const question = assistant ? message.question : undefined;
  const isCorrection = question?.label === "Correction" || question?.prompt === "What did I miss?";
  const [customOpen, setCustomOpen] = useState(Boolean(question && question.suggestions.length === 0));
  const [customAnswer, setCustomAnswer] = useState("");

  function submitCustom(event: FormEvent) {
    event.preventDefault();
    if (customAnswer.trim() && onSuggestion) onSuggestion(customAnswer.trim());
  }

  return (
    <div className={`message-row ${assistant ? "message-row--assistant" : "message-row--user"}`}>
      {assistant && <div className="assistant-avatar"><BotLogo /></div>}
      <div className="message-wrap">
        {assistant && <span className="message-author">AskJev</span>}
        {question?.prompt ? (
          <div className="message-bubble message-bubble--question">
            {message.intro && <p className="question-intro">{message.intro}</p>}
            <span className="question-label"><Target size={13} /> {question.label || "Next question"}</span>
            <h3>{question.prompt}</h3>
            {question.helpText && <p className="question-help">{question.helpText}</p>}
            {question.suggestions.length > 0 && (
              <div className="question-suggestions" aria-label="Suggested answers">
                {question.suggestions.map((suggestion) => (
                  <button type="button" key={suggestion} onClick={() => onSuggestion?.(suggestion)} disabled={!onSuggestion}>
                    <span>{suggestion}</span><ArrowRight size={14} />
                  </button>
                ))}
                {onSuggestion && <button type="button" className="question-other" onClick={() => setCustomOpen(true)}><span>Other — specify</span><Plus size={14} /></button>}
              </div>
            )}
            {onSuggestion && question.suggestions.length === 0 && !customOpen && (
              <button type="button" className="question-other question-other--standalone" onClick={() => setCustomOpen(true)}><span>Write your answer</span><ArrowRight size={14} /></button>
            )}
            {onSuggestion && customOpen && (
              <form className="custom-answer" onSubmit={submitCustom}>
                <input autoFocus value={customAnswer} onChange={(event) => setCustomAnswer(event.target.value)} placeholder="Type your answer…" aria-label="Specify your answer" />
                <button type="submit" disabled={!customAnswer.trim()} aria-label="Submit answer"><Send size={15} /></button>
              </form>
            )}
            {onCancelRevision && isCorrection && (
              <div className="revision-cancel-bar">
                <button type="button" className="revision-back-button" onClick={onCancelRevision} title="Go back to the review step">
                  <RotateCcw size={14} />
                  <span>Back to review (everything is good)</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="message-bubble">{message.content}</div>
        )}
      </div>
    </div>
  );
}

function ConfirmationCard({ turn, onConfirm, onRevise, loading }: { turn: InterviewTurn; onConfirm: () => void; onRevise: () => void; loading: boolean }) {
  return (
    <section className="confirmation-card">
      <div className="confirmation-card__heading"><div className="check-badge"><Check size={17} /></div><div><span className="eyebrow">Review</span><h3>What I understood</h3></div></div>
      <p>{turn.summary}</p>
      <div className="confirmation-parameters">
        {turn.parameters.map((parameter) => (
          <div key={parameter.key}><span>{parameter.label}</span><strong>{parameter.value}</strong></div>
        ))}
      </div>
      <div className="confirmation-actions">
        <button className="primary-button" onClick={onConfirm} disabled={loading}>{loading ? <><span className="spinner" /> Analyzing options…</> : <>This is correct <ArrowRight size={17} /></>}</button>
        <button className="secondary-button" onClick={onRevise} disabled={loading}>No, something’s missing</button>
      </div>
    </section>
  );
}

function DecisionReport({ decision, parameters, onReset }: { decision: DecisionResponse; parameters: DecisionParameter[]; onReset: () => void }) {
  const [copied, setCopied] = useState(false);
  const choiceEntry = Object.entries(decision.result.answers).find(([, answer]) => answer.type === "choice");
  const choiceAnswer = choiceEntry?.[1]?.type === "choice" ? choiceEntry[1] : null;
  const primaryQuestion = decision.plan.questions.find((question) => question.id === choiceEntry?.[0]);
  const composedOption = decision.plan.options.find((option) => option.key === decision.composite?.recommendedOption);
  const recommendation = composedOption?.label || (choiceAnswer ? titleCase(choiceAnswer.choice) : "Decision evaluated");
  const recommendationDescription = composedOption?.description || primaryQuestion?.options.find((option) => option.key.replace(/[^a-z0-9]/gi, "_").toLowerCase() === choiceAnswer?.choice)?.description;
  const confidence = decision.composite?.confidence ?? choiceAnswer?.confidence;
  const rankings = decision.composite?.rankings || [];
  const needsReview = Boolean(decision.composite?.needsReview);
  const hardConstraints = decision.plan.questions.filter((question) => question.type === "noul" && question.hardConstraint);

  function criterionScore(optionKey: string, criterionKey: string) {
    const question = decision.plan.questions.find((item) => item.type === "score" && item.optionKey === optionKey && item.criterionKey === criterionKey);
    if (!question) return null;
    const answer = decision.result.answers[question.id];
    if (answer?.type !== "score") return null;
    return Math.max(0, Math.min(1, answer.score / Math.max(1, question.levels.length - 1)));
  }

  const topRanking = rankings[0];
  const runnerUp = rankings[1];
  const leadMargin = topRanking && runnerUp ? Math.round((topRanking.score - runnerUp.score) * 100) : null;

  const criterionWinners = (() => {
    const winners = new Map<string, string>();
    decision.plan.criteria.forEach((criterion) => {
      let maxScore = -1;
      let winningOption = "";
      decision.plan.options.forEach((option) => {
        const score = criterionScore(option.key, criterion.key);
        if (score !== null && score > maxScore) {
          maxScore = score;
          winningOption = option.key;
        }
      });
      if (winningOption && maxScore > 0) {
        winners.set(criterion.key, winningOption);
      }
    });
    return winners;
  })();

  function copySummary() {
    const text = [
      `DECISION EVALUATION: ${decision.plan.title}`,
      `Question: ${decision.plan.decisionQuestion}`,
      `\n${needsReview ? "LEADING PATH — REVIEW REQUIRED" : "RECOMMENDED PATH"}: ${recommendation} (${confidence !== undefined ? percent(confidence) : ""} confidence)`,
      `${recommendationDescription || ""}`,
      `\nRANKED OPTIONS:`,
      ...rankings.map((r, i) => `${i + 1}. ${r.label} — ${percent(r.score)} fit (${percent(r.confidence)} confidence)`),
      parameters.length > 0 ? `\nCONFIRMED PARAMETERS:\n` + parameters.map((p) => `- ${p.label}: ${p.value}`).join("\n") : "",
    ].filter(Boolean).join("\n");

    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    });
  }

  return (
    <div className="report-shell">
      <div className="report-intro">
        <div>
          <span className="eyebrow eyebrow--accent"><BotLogo className="report-eyebrow-logo" /> JEV Decision Evaluation</span>
          <h1>{decision.plan.title}</h1>
          <p className="report-intro-question">{decision.plan.decisionQuestion}</p>
        </div>
        <div className="report-header-actions">
          <button className="secondary-button" onClick={copySummary} title="Copy decision summary to clipboard">
            {copied ? <Check size={16} /> : <Copy size={16} />}
            <span>{copied ? "Copied to clipboard" : "Copy summary"}</span>
          </button>
          <button className="primary-button" onClick={onReset}>
            <Plus size={16} />
            <span>New decision</span>
          </button>
        </div>
      </div>

      <section className="recommendation-card">
        <div className="recommendation-copy">
          <span className="card-kicker">{needsReview ? "Leading path · Review before deciding" : "Recommended path · Top evaluated fit"}</span>
          <h2>{recommendation}</h2>
          <p>{recommendationDescription || "JEV evaluated the confirmed brief against the typed decision criteria."}</p>
          <div className="recommendation-meta">
            <span className="meta-badge meta-badge--highlight"><Award size={15} /> {topRanking ? `${percent(topRanking.score)} overall fit` : "Top overall fit"}</span>
            <span className="meta-badge"><Gauge size={15} /> {confidence !== undefined ? `${percent(confidence)} engine confidence` : "Typed evaluation"}</span>
            {leadMargin !== null && leadMargin > 0 && (
              <span className="meta-badge"><CheckCircle2 size={15} /> +{leadMargin}% ahead of 2nd option</span>
            )}
            {decision.composite?.diagnosticChoice && (
              <span className="meta-badge">
                {decision.composite.diagnosticChoice.agreesWithComposite ? <CheckCircle2 size={15} /> : <CircleAlert size={15} />}
                Overall cross-check {decision.composite.diagnosticChoice.agreesWithComposite ? "agrees" : "differs"}
              </span>
            )}
          </div>
        </div>
        {confidence !== undefined && (
          <div className="confidence-orbit" style={{ "--score": `${confidence * 360}deg` } as React.CSSProperties}>
            <div>
              <strong>{percent(confidence)}</strong>
              <span>confidence</span>
            </div>
          </div>
        )}
      </section>

      {/* Executive Decision Takeaway */}
      <section className="report-takeaway-card">
        <div className="takeaway-header">
          <Award size={18} />
          <h3>{needsReview ? "Why this option currently leads" : "Why this option won"}</h3>
        </div>
        <div className="takeaway-grid">
          <div className="takeaway-item">
            <strong>Strongest overall fit</strong>
            <p><strong>{recommendation}</strong> ranked #1 with an overall fit score of <strong>{topRanking ? percent(topRanking.score) : "highest"}</strong> based on your weighted criteria.</p>
          </div>
          {runnerUp && (
            <div className="takeaway-item">
              <strong>Comparison with alternatives</strong>
              <p>Ranked ahead of <strong>{runnerUp.label}</strong> ({percent(runnerUp.score)} fit){leadMargin !== null && leadMargin > 0 ? ` by a clear +${leadMargin}% margin` : ""}.</p>
            </div>
          )}
          <div className="takeaway-item">
            <strong>Recommended next step</strong>
            <p>{needsReview
              ? <>Validate the flagged uncertainty before committing to <strong>{recommendation}</strong>.</>
              : <>Proceed with planning around <strong>{recommendation}</strong>, addressing any specific risks outlined below.</>}
            </p>
          </div>
        </div>
      </section>

      {decision.composite?.needsReview && (
        <div className="review-notice">
          <CircleAlert size={20} />
          <div>
            <strong>Review note</strong>
            <span>{decision.composite.reviewReason}</span>
          </div>
        </div>
      )}

      {/* Minimal Fit Score Histogram */}
      {rankings.length > 0 && (
        <section className="report-histogram-section">
          <div className="report-section__heading">
            <div>
              <span className="eyebrow eyebrow--coral"><BarChart3 size={13} /> Fit distribution</span>
              <h2>Option fit comparison</h2>
            </div>
            <span className="histogram-subtag">Normalized fit score</span>
          </div>
          <div className="minimal-histogram">
            <div className="histogram-gridlines">
              <span className="gridline" style={{ bottom: "100%" }}><i>100%</i></span>
              <span className="gridline" style={{ bottom: "75%" }}><i>75%</i></span>
              <span className="gridline" style={{ bottom: "50%" }}><i>50%</i></span>
              <span className="gridline" style={{ bottom: "25%" }}><i>25%</i></span>
            </div>
            <div className="histogram-bars">
              {rankings.map((ranking, index) => {
                const isLead = index === 0;
                const scorePct = Math.round(ranking.score * 100);
                return (
                  <div className={`histogram-column ${isLead ? "histogram-column--lead" : ""}`} key={ranking.optionKey}>
                    <div className="histogram-bar-shell">
                      <span className="histogram-val">{scorePct}%</span>
                      <div className="histogram-track">
                        <div
                          className={`histogram-fill ${isLead ? "histogram-fill--lead" : ""}`}
                          style={{ height: `${Math.max(8, scorePct)}%` }}
                        />
                      </div>
                    </div>
                    <div className="histogram-label-wrap">
                      <span className="histogram-rank-tag">{isLead ? "#1 Pick" : `#${index + 1}`}</span>
                      <strong className="histogram-option-name" title={ranking.label}>{ranking.label}</strong>
                      <small className="histogram-conf">{percent(ranking.confidence)} conf</small>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <div className="report-stats">
        <div>
          <span>Options compared</span>
          <strong>{decision.plan.options.length}</strong>
        </div>
        <div>
          <span>Weighted criteria</span>
          <strong>{decision.plan.criteria.length}</strong>
        </div>
        <div>
          <span>Signals evaluated</span>
          <strong>{Object.keys(decision.result.answers).length}</strong>
        </div>
        <div>
          <span>Decision confidence</span>
          <strong>{confidence !== undefined ? percent(confidence) : "—"}</strong>
        </div>
      </div>

      {rankings.length > 0 && (
        <section className="report-section report-section--ranking">
          <div className="report-section__heading">
            <div>
              <span className="eyebrow">Option comparison</span>
              <h2>How each path ranked</h2>
            </div>
            <span className="engine-badge">{decision.result.model}</span>
          </div>
          <div className="option-rank-list">
            {rankings.map((ranking, index) => {
              const option = decision.plan.options.find((item) => item.key === ranking.optionKey);
              const isLead = index === 0;
              return (
                <article
                  className={`option-rank-card ${isLead ? "option-rank-card--lead" : ""} ${!ranking.eligible ? "option-rank-card--blocked" : ""}`}
                  key={ranking.optionKey}
                >
                  <span className="option-rank-number">#{String(index + 1).padStart(2, "0")}</span>
                  <div className="option-rank-copy">
                    <div className="option-rank-title-row">
                      <h3>{ranking.label}</h3>
                      {isLead ? (
                        <span className="recommended-pill">{needsReview ? "Leading option" : "Recommended"}</span>
                      ) : (
                        <span className="alternative-pill">Alternative {index + 1}</span>
                      )}
                    </div>
                    <p>{option?.description}</p>
                    <div className="option-tags">
                      <span>{percent(ranking.confidence)} confidence</span>
                      <span>{percent(ranking.coverage)} criteria coverage</span>
                      {!ranking.eligible && <span className="constraint-pill">Constraint risk</span>}
                    </div>
                  </div>
                  <div className="option-score">
                    <strong>{percent(ranking.score)}</strong>
                    <span>overall fit</span>
                    <i><b style={{ width: percent(ranking.score) }} /></i>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <section className="report-section">
        <div className="report-section__heading">
          <div>
            <span className="eyebrow">Criteria breakdown</span>
            <h2>Detailed criteria matrix</h2>
          </div>
          <span className="matrix-scroll-hint">Swipe sideways to compare options →</span>
        </div>
        <div className="matrix-scroll">
          <div className="decision-matrix" style={{ gridTemplateColumns: `minmax(220px, 1.4fr) repeat(${decision.plan.options.length}, minmax(140px, 1fr))` }}>
            <div className="matrix-corner">Criterion · weight</div>
            {decision.plan.options.map((option) => (
              <div className="matrix-option" key={option.key}>
                <strong>{option.label}</strong>
                {option.key === topRanking?.optionKey && <span className="matrix-winner-tag">#1 Pick</span>}
              </div>
            ))}
            {decision.plan.criteria.flatMap((criterion) => {
              const winningOptionKey = criterionWinners.get(criterion.key);
              return [
                <div className="matrix-criterion" key={`${criterion.key}-label`}>
                  <strong>{criterion.label}</strong>
                  <span>{Math.round(criterion.weight * 100)}% weight</span>
                </div>,
                ...decision.plan.options.map((option) => {
                  const score = criterionScore(option.key, criterion.key);
                  const isWinner = option.key === winningOptionKey;
                  return (
                    <div className={`matrix-score ${isWinner ? "matrix-score--winner" : ""}`} key={`${criterion.key}-${option.key}`}>
                      <div className="matrix-score-value">
                        <span>{score === null ? "—" : percent(score)}</span>
                        {isWinner && <span className="best-tag">Top</span>}
                      </div>
                      {score !== null && <i><b style={{ width: percent(score) }} /></i>}
                    </div>
                  );
                }),
              ];
            })}
          </div>
        </div>
      </section>

      {hardConstraints.length > 0 && (
        <section className="report-section">
          <div className="report-section__heading">
            <div>
              <span className="eyebrow">Non-negotiables</span>
              <h2>Hard-constraint check</h2>
            </div>
          </div>
          <div className="constraint-grid">
            {hardConstraints.map((question) => {
              const answer = decision.result.answers[question.id];
              const probability = answer?.type === "noul" ? answer.noul : 0;
              const passed = probability >= 0.7;
              return (
                <article className={passed ? "constraint-card constraint-card--pass" : "constraint-card"} key={question.id}>
                  <div>
                    <span>{passed ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}{question.label}</span>
                    <strong>{percent(probability)} {passed ? "Pass" : "Risk"}</strong>
                  </div>
                  <p>{question.positiveMeaning}</p>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <section className="report-section report-section--split">
        <div className="report-inputs">
          <span className="eyebrow">Confirmed inputs</span>
          <h2>What the analysis used</h2>
          <div className="report-parameters">
            {parameters.map((parameter) => (
              <div key={parameter.key}>
                <span>{parameter.label}</span>
                <strong>{parameter.value}</strong>
              </div>
            ))}
          </div>
        </div>
        <details className="blueprint-details">
          <summary>
            <span><Sparkles size={16} /> Analysis method details</span>
            <ChevronDown size={17} />
          </summary>
          <div className="blueprint-body">
            <p>{decision.plan.stateSummary}</p>
            <p>{decision.plan.options.length} options were evaluated independently across {decision.plan.criteria.length} weighted criteria using {Object.keys(decision.result.answers).length} typed JEV questions.</p>
          </div>
        </details>
      </section>

      <div className="report-footnote">
        <ShieldCheck size={16} />
        <span>Use this as decision support, not certainty. Revisit the result when assumptions or evidence change.</span>
      </div>
    </div>
  );
}

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [provider, setProviderState] = useState<Provider>("ollama");
  const [turn, setTurn] = useState<InterviewTurn | null>(null);
  const [decision, setDecision] = useState<DecisionResponse | null>(null);
  const [confirmationBackup, setConfirmationBackup] = useState<{
    turn: InterviewTurn;
    messages: ChatMessage[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatId, setChatId] = useState("");
  const [recentChats, setRecentChats] = useState<SavedChat[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const hasConversation = messages.length > 0;
  const parameters = turn?.parameters || [];

  useEffect(() => {
    const saved = (window.localStorage.getItem("askjev-provider") || window.localStorage.getItem("clarity-provider")) as Provider | null;
    const storedChats = window.localStorage.getItem(RECENT_CHATS_KEY) || window.localStorage.getItem("clarity-recent-chats");
    queueMicrotask(() => {
      setMounted(true);
      setChatId(uid());
      if (saved === "ollama" || saved === "openai") setProviderState(saved);
      if (storedChats) {
        try {
          setRecentChats((JSON.parse(storedChats) as SavedChat[]).slice(0, 12));
        } catch {
          window.localStorage.removeItem(RECENT_CHATS_KEY);
        }
      }
    });
    fetch("/api/config").then((response) => response.json()).then(setConfig).catch(() => null);
  }, []);

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy, turn]);

  useEffect(() => {
    if (!mounted || !chatId || messages.length === 0) return;
    const firstPrompt = messages.find((message) => message.role === "user")?.content || "Untitled decision";
    const savedChat: SavedChat = {
      id: chatId,
      title: firstPrompt.length > 42 ? `${firstPrompt.slice(0, 42).trim()}…` : firstPrompt,
      updatedAt: new Date().toISOString(),
      provider,
      messages,
      turn,
      decision,
    };
    queueMicrotask(() => {
      setRecentChats((current) => {
        const next = [savedChat, ...current.filter((chat) => chat.id !== chatId)].slice(0, 12);
        window.localStorage.setItem(RECENT_CHATS_KEY, JSON.stringify(next));
        return next;
      });
    });
  }, [chatId, decision, messages, mounted, provider, turn]);

  function setProvider(next: Provider) {
    setProviderState(next);
    window.localStorage.setItem("askjev-provider", next);
  }

  function reset() {
    setChatId(uid());
    setMessages([]);
    setTurn(null);
    setDecision(null);
    setConfirmationBackup(null);
    setInput("");
    setError("");
    setSidebarOpen(false);
  }

  function openSavedChat(chat: SavedChat) {
    setChatId(chat.id);
    setProviderState(chat.provider);
    setMessages(chat.messages);
    setTurn(chat.turn);
    setDecision(chat.decision);
    setConfirmationBackup(null);
    setInput("");
    setError("");
    setSidebarOpen(false);
  }

  async function requestInterview(nextMessages: ChatMessage[]) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          messages: nextMessages,
          brief: turn
            ? {
                completionScore: turn.completionScore,
                parameters: turn.parameters,
                missingTopics: turn.missingTopics,
                summary: turn.summary,
              }
            : undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The interview could not continue.");
      const nextTurn = body as InterviewTurn;
      setTurn(nextTurn);
      const hasQuestion = nextTurn.stage === "interviewing" && Boolean(nextTurn.question.prompt);
      const intro = hasQuestion && nextTurn.question.prompt !== nextTurn.assistantMessage
        ? nextTurn.assistantMessage
        : "";
      const content = hasQuestion
        ? [intro, nextTurn.question.prompt].filter(Boolean).join("\n\n")
        : nextTurn.assistantMessage;
      setMessages((current) => [...current, {
        id: uid(),
        role: "assistant",
        content,
        intro,
        question: hasQuestion ? nextTurn.question : undefined,
        createdAt: new Date().toISOString(),
      }]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function send(content: string) {
    const trimmed = content.trim();
    if (!trimmed || busy || turn?.stage === "confirmation") return;
    setConfirmationBackup(null);
    const userMessage: ChatMessage = { id: uid(), role: "user", content: trimmed, createdAt: new Date().toISOString() };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    await requestInterview(nextMessages);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await send(input);
  }

  function revise() {
    if (!turn) return;
    setConfirmationBackup({
      turn: { ...turn, stage: "confirmation" },
      messages: [...messages],
    });
    const userMessage: ChatMessage = { id: uid(), role: "user", content: "No — something is missing.", createdAt: new Date().toISOString() };
    const revisionQuestion = {
      label: "Correction",
      prompt: "What did I miss?",
      helpText: "Add or correct anything that would change the decision.",
      suggestions: [],
    };
    const assistantMessage: ChatMessage = { id: uid(), role: "assistant", content: "What did I miss?", question: revisionQuestion, createdAt: new Date().toISOString() };
    setMessages((current) => [...current, userMessage, assistantMessage]);
    setTurn({ ...turn, stage: "interviewing", assistantMessage: "What did I miss?", question: revisionQuestion });
  }

  function cancelRevision() {
    if (confirmationBackup) {
      setMessages(confirmationBackup.messages);
      setTurn(confirmationBackup.turn);
      setConfirmationBackup(null);
    }
  }

  async function confirm() {
    if (!turn || busy) return;
    setBusy(true);
    setError("");
    try {
      console.log(">>> [AskJev] Dispatched brief to /api/decision. Evaluating with JEV API...");
      const response = await fetch("/api/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, messages, parameters: turn.parameters, summary: turn.summary }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "JEV could not complete the evaluation.");
      if (body.jevPayload) {
        console.log("==================== [JEV API OUTGOING PAYLOAD] ====================");
        console.log("Exact payload evaluated by JEV API (https://api.typesafe.ai/v1/systemone):", body.jevPayload);
        console.log("Formatted JSON:\n" + JSON.stringify(body.jevPayload, null, 2));
        console.log("====================================================================");
      }
      setDecision(body as DecisionResponse);
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (!mounted) {
    return (
      <main className="app-shell app-shell--loading" suppressHydrationWarning>
        <div className="boot-mark"><BotLogo /></div>
      </main>
    );
  }

  return (
    <main className={`app-shell ${hasConversation || decision ? "app-shell--active" : "app-shell--landing"}`}>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} provider={provider} setProvider={setProvider} config={config} />
      <div className="app-layout">
        <aside className={`history-sidebar ${sidebarOpen ? "history-sidebar--open" : ""}`}>
          <div className="sidebar-brand-row">
            <button className="brand" onClick={reset} aria-label="AskJev home"><span className="brand-mark"><BotLogo /></span><span>AskJev</span></button>
            <button className="sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar"><X size={18} /></button>
          </div>
          <button className="new-chat-button" onClick={reset}><Plus size={16} /> New decision</button>
          <div className="chat-history">
            <span className="chat-history-label">Recent</span>
            {recentChats.length > 0 ? recentChats.map((chat) => (
              <button className={chat.id === chatId ? "chat-history-item chat-history-item--active" : "chat-history-item"} key={chat.id} onClick={() => openSavedChat(chat)}>
                <MessageSquareText size={15} /><span>{chat.title}</span>
              </button>
            )) : <p>Your recent decisions will appear here.</p>}
          </div>
          <button className="sidebar-settings" onClick={() => setSettingsOpen(true)}><Settings2 size={16} /><span>Settings</span></button>
        </aside>
        {sidebarOpen && <button className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar" />}

        <div className="main-column">
          <header className="topbar">
            <button className="mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open recent chats"><Menu size={19} /></button>
            <span className="topbar-title">{hasConversation ? recentChats.find((chat) => chat.id === chatId)?.title || "Current decision" : "AskJev"}</span>
          </header>

          <section className="workspace">
          <section className={`conversation-panel ${!hasConversation && !decision ? "conversation-panel--welcome" : ""}`}>
            {decision ? (
              <DecisionReport decision={decision} parameters={parameters} onReset={reset} />
            ) : !hasConversation ? (
              <div className="welcome">
                <span className="welcome-kicker"><BotLogo className="welcome-kicker-logo" /> Guided decisions</span>
                <h1>Move from uncertainty<br /><span>to a decision you trust.</span></h1>
                <p>Share the decision in your own words. AskJev asks only what matters, then evaluates your options with JEV.</p>
                <form className="hero-composer" onSubmit={handleSubmit}>
                  <div className="hero-input"><textarea ref={textareaRef} value={input} onChange={(event) => setInput(event.target.value)} placeholder="What are you trying to decide?" rows={3} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(input); } }} /></div>
                  <div className="composer-footer"><span>Start with the rough version—we’ll clarify it together.</span><button type="submit" disabled={!input.trim()} aria-label="Continue"><ArrowRight size={18} /></button></div>
                </form>
                <div className="starters">
                  <span>Try a starting point</span>
                  <div>{starters.map((starter) => <button key={starter.title} onClick={() => send(starter.prompt)}><starter.icon size={16} /><strong>{starter.title}</strong><ArrowRight size={14} /></button>)}</div>
                </div>
              </div>
            ) : (
              <>
                <div className="conversation-heading">
                  <div className="conversation-heading__copy">
                    <span className="eyebrow">Clarifying your decision</span>
                    <h1>Let’s find the clearest path.</h1>
                    <p>Choose an option or add your own answer.</p>
                  </div>
                  <div className="conversation-tools">
                    {turn && (
                      <span className="readiness-pill" title={`${Math.round(turn.completionScore)}% ready`}>
                        <i style={{ width: `${turn.completionScore}%` }} />
                        <b>{Math.round(turn.completionScore)}%</b>
                        <span className="readiness-label">ready</span>
                      </span>
                    )}
                    <button className="icon-button" onClick={reset} title="Start over" aria-label="Start over">
                      <RotateCcw size={17} />
                    </button>
                  </div>
                </div>
                <div className="messages">
                  {messages.map((message, index) => (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      onSuggestion={index === messages.length - 1 && message.role === "assistant" && !busy ? send : undefined}
                      onCancelRevision={confirmationBackup && index === messages.length - 1 ? cancelRevision : undefined}
                    />
                  ))}
                  {busy && turn?.stage !== "confirmation" && <div className="message-row message-row--assistant"><div className="assistant-avatar"><BotLogo /></div><div className="thinking"><i /><i /><i /><span>Preparing the next question</span></div></div>}
                  {turn?.stage === "confirmation" && <ConfirmationCard turn={turn} onConfirm={confirm} onRevise={revise} loading={busy} />}
                  {error && <div className="error-card"><CircleAlert size={18} /><div><strong>That didn’t go through</strong><span>{error}</span></div><button onClick={() => setError("")}><X size={16} /></button></div>}
                  <div ref={messagesEnd} />
                </div>
              </>
            )}
          </section>
          </section>
        </div>
      </div>
    </main>
  );
}
