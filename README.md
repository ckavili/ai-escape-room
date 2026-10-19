# Keynote challenge-board prototype

The `keynote` branch also includes a separate 4×4 challenge-board experience. Run `npm run keynote`, then open http://localhost:3001 (players) or http://localhost:3001/stage (presenters). See [keynote/README.md](keynote/README.md) for demo/live modes and scope.

# AI Escape Room — first playable slice

Four short mobile-first puzzles, three configurable generic AI choices, a persistent 40-coin budget, server-side answer checking and scoring, and a live aggregate dashboard. Extends the Section 25 slice with sequential rooms and a hint mechanic. Section 26 remains the baseline for verification.

## Run locally

Requires Node.js 24.2 or newer (uses built-in SQLite).

```sh
npm ci
cp .env.example .env
npm start
```

Open http://127.0.0.1:3000 and http://127.0.0.1:3000/dashboard. The supplied example enables **demo mode**: all three choices return a labelled simulated answer, spend game coins, and report no real token usage. Demo mode does not demonstrate differences in model capability.

Use another browser profile or a private window for a second independent player. Tabs in the same browser profile share one session. Sessions survive refreshes and server restarts, using an HttpOnly cookie and SQLite in `data/game.sqlite`.

## Connect MaaS

In `.env`, set `DEMO_MODE=false`, `MAAS_BASE_URL` to the OpenAI-compatible API root (including `/v1` if required), and `MAAS_API_KEY`. Set actual deployed model names in `models.yaml`, or override with `MAAS_MODEL_FAST`, `MAAS_MODEL_BALANCED`, and `MAAS_MODEL_PREMIUM`. All model calls use the backend's `/chat/completions` adapter. The API key never goes to the browser. No automatic fallback to simulated answers occurs on live failures.

`models.yaml` controls labels, descriptions, models, coin costs and scoring. Restart after configuration changes. Keep pricing fixed during a play session. All aliases share the configured MaaS endpoint and credential. Missing provider token usage is recorded as unknown rather than estimated.

Optional environment variables: `PORT`, `HOST`, `MODELS_CONFIG`, `DATABASE_PATH`, `MAAS_TIMEOUT_MS` (default 30000), and `COOKIE_SECURE=true` for HTTPS deployments. To test from a phone on a trusted local network, bind `HOST=0.0.0.0` and use the computer's LAN address. QR generation is outside this slice.

## Rules and scope

The vault's three digits are consecutive and ascending, with sum 12. The accepted code is `345`, with surrounding whitespace ignored. It is validated only on the server. Players may solve manually without spending any coins.

Room 2, **The broken transmission**, hides NORTH in the initial letters of five short lines. Players tap a direction, request a one-coin hint, or ask any of the three generic models for a full answer. `game.hint_cost` and `game.hint_model` configure the hint price and backing model. Live hints go through MaaS with a dedicated instruction to avoid revealing the solution; model compliance should be checked before an event. Demo hints are deterministic.

Room 3, **The unreliable doors**, asks players to reconcile three signs when exactly one is true. It offers three answer buttons and the same three generic models. The unique solution is RED. Model accuracy differences are not scripted; test the real endpoints before claiming a larger model is better at this puzzle.

Room 4, **The missing symbol**, shows `2 → 6`, `3 → 12`, `4 → 20`, then `5 → ?`. The intended answer is 30, using n × (n + 1). Players choose between sending only the question or including all examples for one extra coin (`game.context_cost_per_record`). Without that selection, examples never enter the MaaS prompt. Prices and selected context are recorded server-side. Demo mode asks for examples when omitted; real model behavior needs evaluation. As with finite pattern puzzles, this is the intended simple rule, not a mathematically unique extrapolation. Existing completed Room 4 saves stay completed; use a private window for a fresh run.

Budget carries across all rooms. Each completed room has a short explanation and a Next Room button. Existing one-room saves migrate automatically: players who already opened the vault can continue to Room 2. Existing Room 2 completions can now continue to Room 3; completed Room 3 saves can continue to Room 4.

Per-room completion score: `max(0, completion_points − coin_penalty × coins_spent − wrong_attempt_penalty × wrong_answers)`. Defaults: 1000 points, 20 per coin, 100 per wrong answer. Each room awards once; total score sums the room scores. Costs and wrong attempts from earlier rooms are not deducted again. No time bonus in this slice.

Successful AI responses cost the configured amount. Errors, timeouts and empty responses cost nothing. A session may have only one in-flight AI request; answer submission is blocked while it is pending. Requests have a 1.5-second cooldown. Mutation requests require idempotency keys; committed results survive restarts. Frontend retries reuse the same key after a transport failure. Dashboard polling runs every three seconds and queries SQL aggregates; live and demo usage are separate. Player count means total joined, not currently connected.

The prototype uses one Node process and SQLite. It is not yet a 500-player deployment. A process crash after provider inference but before the database commit can incur provider usage without a recorded game charge; durable request jobs and reconciliation belong in an event-ready version. Successful AI response text is retained in the idempotency log. Do not put sensitive information into nicknames.

Deferred: Room 5, verification, MLflow, admin controls, leaderboard, event resets, nickname moderation, router integration, distributed request locks, and load testing. The dashboard publishes aggregates only, not nicknames or prompts. It includes completions per room and hint/full-answer request counts.

## Direction for the next iterations

Keep the original vault as the difficulty baseline: short clues, phone-friendly answers, and roughly 30–60 seconds per room. Use the available generic models for now. A small specialist is a future idea, not a current requirement. Do not fabricate model mistakes or assume model size predicts success.

The next increment is the verification room; evaluate all puzzles against actual MaaS models. Round 2 should use equivalent puzzles with different answers and Semantic Router for model selection. Hint/context/verification choices remain separate mechanics. Compare actual quality, spend and latency without assuming the router must win.

Message: **Use the right intelligence, in the right way, at the right time—and automate those decisions when you need to do it at scale.**

## Verify

```sh
npm test
```

Integration tests exercise independent players, session isolation, duplicate charges, concurrent requests, scoring, failed inference, insufficient funds, cooldown, origin checks, persistence, and an HTTP fixture implementing the MaaS response contract. This fixture verifies the adapter, **not connectivity to a real MaaS deployment**.

Browser smoke check (requires locally installed Google Chrome):

```sh
npm run test:ui
```

Before a real demo, configure MaaS and repeat the two-player flow with actual models. Check reported token totals and answer quality. Model access and actual phone-browser rendering must be verified in the target environment.

## Wire real models and evaluate puzzle candidates

1. Copy `.env.example` to `.env`. Set the MaaS API root and key, then set `MAAS_MODEL_FAST`, `MAAS_MODEL_BALANCED`, and `MAAS_MODEL_PREMIUM` to actual deployed model IDs. Keep the key in `.env`, not in YAML or chat.
2. If MaaS gives each model its own API root, use `MAAS_BASE_URL_FAST`, `MAAS_BASE_URL_BALANCED`, and `MAAS_BASE_URL_PREMIUM`. Optional `MAAS_API_KEY_FAST` (and corresponding aliases) overrides the common key. All destinations must be your MaaS endpoints.
3. Run `npm run maas:check`. This makes one small **real inference request per model**, regardless of `DEMO_MODE`; it does not require a `/models` discovery API.
4. Run `npm run eval:puzzles -- --repeats 3`. The default runs 72 real requests: eight candidates × three models × three attempts. Use `--case count-strawberry --models fast --repeats 1` for one request. `--list` lists candidates without network access.
5. Inspect `data/evaluations/*.json` for prompts, responses, expected answers, token usage, latency, model IDs, finish reasons and correctness. These local files are ignored by git. Output is saved after each request. Format errors are separate from incorrect answers and request failures. Missing token usage stays null; no usage is invented.
6. Set `DEMO_MODE=false` and restart the game to serve real responses. The evaluator never modifies player budgets or dashboard statistics.

The game and evaluator share `maas.js`. `MAAS_MAX_TOKENS` defaults to 512; increase it for models that need a larger generation budget, and check `finish_reason` for truncation. The evaluator requests a JSON answer for deterministic grading, so its prompts differ from the game's short explanations. Validate promising candidates in the game too. Three trials are an initial screen, not a reliable accuracy estimate. Game coins are not provider billing.

### Current workshop configuration

Fast maps to `qwen3-14b`, Balanced to `gpt-oss-20b`, and Premium to `gpt-oss-120b`. The API root is configured privately in `.env`. Qwen uses `chat_template_kwargs.enable_thinking: false` for the short-response game, following [Qwen's vLLM configuration](https://qwen.readthedocs.io/en/v3.0/deployment/vllm.html). The first diagnostic with thinking enabled exhausted 512 output tokens before a final answer on some rooms; do not count that aborted diagnostic as a puzzle accuracy result. Results describe the configured model plus reasoning mode, not model size alone. The game rejects truncated or unfinished answers without charging coins, and removes completed `<think>` blocks from visible responses. The other models keep endpoint-default reasoning settings.

## Coins, tokens and money

Coins remain the equal game budget. AI results show input/output tokens and total tokens reported by MaaS; small estimated amounts are displayed in US cents (for example, $0.0032 becomes 0.32¢). The dashboard shows reported live tokens and estimated USD totals, with explicit counts of unpriced requests and missing usage. Simulated requests do not contribute to those totals.

To enable estimates, add `pricing` under each model in `models.yaml`, with numeric `input_usd_per_million` and `output_usd_per_million` rates for your deployment, then restart. Illustrative demo rates are now supplied: Fast $0.10/$0.30, Balanced $0.30/$0.90, Premium $1.00/$3.00 per million input/output tokens. These are not MaaS billing rates. Each mapping has `basis: demo`; use `basis: configured` when replacing them with your own rates. Missing pricing or usage means unknown, not zero. Explicit zero rates mean free. This estimate is input tokens × input rate / 1,000,000 plus output tokens × output rate / 1,000,000; provider-specific caching, tiers or infrastructure costs are not inferred.

Each successful request stores its estimate and rate snapshot so changing prices later cannot rewrite history. Previous requests remain unpriced. Failed/timed-out requests may still consume provider resources; their absent usage and costs are counted as missing, so dashboard totals are recorded estimates, not billing totals. The game's coins have no dollar exchange rate.


### Visible token consumption

Result cards put total tokens first, followed by input and output counts. When MaaS returns `usage.completion_tokens_details.reasoning_tokens`, it is retained in backend telemetry as a subset of output, never added again to total tokens or price. The UI shows only total, input and output tokens. Omitted breakdowns remain unknown. A live check on this deployment returned input/output counts but no reasoning breakdown. We do not infer reasoning tokens from response length or elapsed time.

The dashboard compares average reported tokens per request and input/output totals by model. This makes measured differences visible without assuming larger models always generate more tokens. Responses that hit a generation limit retain any reported usage and estimated cost, while game coins are not charged. Unknown usage on network timeouts remains unknown.

## Elapsed time and leaderboard

The elapsed clock starts at session creation. It keeps running during AI requests, room transitions, refreshes and time away from the tab, and stops when the final room is solved. There is no countdown, deadline or new time penalty. The server records completion times; clients cannot submit their own timing values. Each room completion also shows that room's solve duration.

The dashboard's top-ten leaderboard ranks by rooms escaped, then score, then shorter elapsed time to the latest solved room. For finished players this is total escape time; for others it is time to their current progress. Nicknames are shown publicly, escaped as text. Sessions with no completed room do not appear yet. Existing completion records have no historical timestamps and display an unknown time rather than an invented one. Active sessions keep their original join time, so use a new private-browser session for a fresh timed run.

## Live answer and reasoning streams

Live answers from Fast, Balanced and Premium, including AI hints, stream through the backend. A request starts with a waiting-for-model-output status, changes to “[Model] is reasoning…” only when reasoning arrives, and shows elapsed request time while the game clock keeps running. “View model reasoning” opens automatically when text arrives; it renders provider-emitted reasoning as plain text and automatically collapses when the final result arrives. Answer text also appears incrementally in an “Answer arriving…” card. A successful final result replaces the preview and supplies usage/cost; failed partial answers are discarded. No live token counter is inferred from chunks. Final reported usage powers the existing token card.

The MaaS client handles `reasoning_content` and `reasoning` deltas, UTF-8 chunk boundaries, late usage events, and non-streaming JSON fallback. Interrupted/truncated responses do not charge game coins. Successful requests commit once; retrying the same idempotency key returns the saved result. Closing the page does not cancel a model request already in flight; it may finish and charge once, with state available after refresh. Reasoning text is capped at 64,000 characters and is not stored in the game database or shown on the public dashboard. Simulated responses retain their existing request flow.

Streaming requests have a separate `MAAS_STREAM_TIMEOUT_MS` limit (default 120 seconds), while ordinary requests keep `MAAS_TIMEOUT_MS` (default 30 seconds). The game clock keeps running throughout. The client accepts clean EOF after an explicit finish event and stops reading once both the finish event and final usage have arrived; a separate `[DONE]` marker is not required in those cases. A deadline produces an explicit response-limit error instead of a generic interrupted-stream message. Reasoning text alone is never treated as the final answer.

The reasoning panel appears only after actual reasoning text arrives. Before then, the UI distinguishes waiting for model output and a non-streaming response. Both `reasoning_content` and `reasoning` fields are supported, including completed JSON fallback responses. Frontend assets use `Cache-Control: no-store` so a refresh picks up streaming-handler updates.

The upstream request asks for SSE without compression. This cannot force the provider to flush incremental output. Live Chrome checks observed 45–60 seconds before upstream headers, then all output within 0.3–0.5 seconds; buffering or delayed delivery upstream still needs investigation. To measure browser-visible event timings using a real Premium call and an isolated in-memory game, run `node --env-file=.env scripts/diagnose-stream.js` (requires installed Chrome). It prints timings/counts and selected transport headers, not credentials or model text.

### MaaS reasoning token accounting

The configured models use `reasoning_token_accounting: separate`: reported reasoning tokens are added to completion tokens once, and the combined output drives the input/output card, dashboard totals and output cost estimate. This is an explicit assumption for these deployments, not a verified billing convention. Use `included` (the default when omitted) for endpoints whose completion count already includes reasoning. When reasoning usage is absent, only reported completion tokens are counted; no count is inferred from text. Existing saved requests and cost snapshots are unchanged because discarded reasoning counts cannot be recovered from them.
