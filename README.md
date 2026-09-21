# Verdict Decision Studio

A guided decision application built with Next.js. Verdict turns an ambiguous request into a confirmed, structured brief, converts that brief into typed JEV questions, and visualizes JEV's probabilistic result.

## Flow

1. **Discover** — Ollama Cloud (`gpt-oss:120b`) or OpenAI (`gpt-5.6-luna`) asks adaptive follow-up questions.
2. **Structure** — stable facts become a live decision brief; material gaps stay visible.
3. **Confirm** — the customer approves the complete understanding or enters the “What did I miss?” revision loop.
4. **Architect** — the selected LLM turns the confirmed brief into structured candidates, weighted criteria, explicit hard constraints, and atomic Choice, Score, and Noul questions.
5. **Decide** — JEV evaluates every option × criterion and option × constraint independently; application code composes the typed answers and uses one overall Choice only as a disagreement check.

## Setup

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

Required server-side variables:

- `OLLAMA_API_KEY` for the default interviewer
- `TYPESAFE_API_KEY` for the JEV decision engine
- `OPENAI_API_KEY` to enable the optional Luna interviewer

No provider key is exposed to browser code. `.env.local` is ignored by Git.

## Verification

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

The JEV contract tests verify request normalization, complete score/constraint matrices, diagnostic Choice coverage, response distributions, and the official `state + model + questions` payload without sending test data to an external service.

## Key files

- `app/page.tsx` — guided interview, settings, confirmation, and decision report UI
- `app/api/interview/route.ts` — dynamic interview endpoint
- `app/api/decision/route.ts` — JEV plan generation and evaluation orchestration
- `lib/prompts.ts` — interviewer and JEV architect behavior
- `lib/llm.ts` — Ollama Cloud and OpenAI Responses integrations
- `lib/jev.ts` — typed JEV request normalization and HTTP client
