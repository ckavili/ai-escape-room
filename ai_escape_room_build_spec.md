# AI Escape Room — Build Specification

## 1. Purpose

Build a mobile-first, multi-user **AI Escape Room** experience for conference audiences.

The audience is assumed to have normal end-user AI experience (for example, using ChatGPT), but no technical background.

The core lesson is:

> **Good AI usage is not about always choosing the strongest model. It is about using the right intelligence, in the right way, at the right time.**

A second layer demonstrates the platform value:

> When hundreds of users make different AI choices simultaneously, a platform is needed to provide model access, observability, usage control, routing, and governance at scale.

All model requests should go through **OpenShift AI Models-as-a-Service (MaaS)**. Assume multiple models are already exposed through MaaS.

A later phase should support **Semantic Router**, allowing automated model-selection decisions to be compared with human choices.

---

# 2. Experience Summary

Each player:

1. Scans a QR code.
2. Opens the game in a mobile browser.
3. Receives the same starting budget.
4. Encounters the same sequence of escape-room puzzles.
5. Decides when and how to use AI assistance.
6. Sees the immediate effect of each choice on puzzle progress, remaining budget, elapsed time, and score.
7. Attempts to escape all rooms with the best balance of success, spend, and speed.

The big screen shows the collective system behavior in real time:

- active players,
- rooms completed,
- model-selection distribution,
- requests per model,
- tokens consumed per model,
- local vs external model usage,
- game-budget spent,
- real token usage,
- average latency,
- leaderboard,
- selected interesting traces.

The participant experience should feel like a game.

The big-screen experience should make the infrastructure and AI platform visible.

---

# 3. Design Principles

## 3.1 Audience assumptions

Players may not know what tokens, inference endpoints, or model IDs are.

Expose choices in plain language.

Bad:

`granite-8b-instruct`

Better:

**Fast Local Model**  
Cheap and quick. Good for simple tasks.  
Cost: 2 coins

The real backing model name can appear as secondary information.

## 3.2 Equal starting conditions

All players start with the same:

- rooms,
- budget,
- available AI capabilities,
- scoring rules.

## 3.3 Meaningful decisions

The game must not reduce to:

- always choose the cheapest model, or
- always choose the strongest model.

Some rooms should reward cheap models. Some should justify stronger models. Some should reward hints. Some should reward selective context. Some should make verification worthwhile.

## 3.4 Immediate consequence

Every decision must visibly affect something:

- budget,
- score,
- time,
- puzzle difficulty,
- correctness,
- leaderboard position.

## 3.5 Mobile-first

Avoid code editing, dense tables, large forms, and complex drag-and-drop.

Prefer large tap targets, short text, cards, 2–4 options at a time, and simple chat-style input only where useful.

---

# 4. Core Gameplay

## 4.1 Starting state

Each player starts with:

- 40 coins,
- 0 points,
- Room 1 unlocked,
- a visible timer.

Example:

```text
AI ESCAPE ROOM

Budget: 40 coins
Rooms escaped: 0 / 5
Time: 00:00

Your goal:
Escape all five rooms without wasting your AI budget.
```

## 4.2 Assistance choices

### A. Solve myself
Cost: 0 coins.

### B. Get a hint
Low cost. The backend asks a model for one useful hint without revealing the final answer.

### C. Ask a model

Suggested player-facing options:

**Fast Local**
- 2 coins
- low latency
- suitable for simple tasks

**Balanced**
- 5 coins
- stronger reasoning
- moderate cost

**Premium**
- 9 coins
- highest capability
- highest game cost

Actual backing models are deployment-configurable.

### D. Add context

Some puzzles expose optional notes/documents/images.

Players decide what to send.

This teaches:

> More context can help, but sending everything is not always efficient.

### E. Verify answer

After an AI answer, the player can pay to verify it.

Verification may use:
- another model,
- the same model with a verification prompt,
- a deterministic tool,
- a stronger model.

### F. Retry

Retries cost budget.

---

# 5. Game Economy

Use **game coins**, not actual provider billing, for gameplay.

Suggested defaults:

| Action | Cost |
|---|---:|
| Solve yourself | 0 |
| Hint | 1 |
| Fast Local Model | 2 |
| Balanced Model | 5 |
| Premium Model | 9 |
| Add small context set | +1 |
| Add large context set | +3 |
| Verify answer | +3 |
| Retry | normal request cost again |

All values must be configuration-driven.

Separately record real usage:

- input tokens,
- output tokens,
- total tokens,
- latency,
- model ID,
- request status.

Game coins and real model cost are separate concepts.

---

# 6. Scoring

The score rewards both success and efficiency.

Suggested formula:

```text
room_score =
  base_completion_points
  - coins_spent_penalty
  - time_penalty
  - wrong_attempt_penalty
  + optional_efficiency_bonus
```

Example:

```text
Base completion:       +1000
Coins spent:           -20 per coin
Wrong answer:          -100
Verification catch:    +100
Fast completion bonus: +0 to +200
```

Final score:

```text
sum(room_scores) + remaining_budget_bonus
```

Tie-breakers:

1. more rooms completed,
2. lower game spend,
3. faster completion time.

Do not rank solely by lowest cost.

---

# 7. Five-Room MVP Game Design

## Room 1 — Do I need AI?

Purpose: teach that not every task requires AI.

Use a simple visual or logic puzzle.

Optimal route: solve manually.

AI still works, but using Premium is obviously wasteful.

## Room 2 — How much help do I need?

Purpose: teach that partial assistance may be enough.

Use a moderately difficult clue or word puzzle.

Options:
- manual,
- hint,
- full solution.

A hint should often be enough.

## Room 3 — Which model is appropriate?

Purpose: teach model-selection trade-offs.

Use a task where Fast Local has a meaningful chance of failure or ambiguity and stronger models perform better.

Possible categories:
- multi-step logic,
- tricky language interpretation,
- image reasoning,
- combining several clues.

Here, spending more should be rational.

## Room 4 — How much context should I provide?

Purpose: teach context efficiency.

Present several notes, images, or clues. Only some are relevant.

- too little context -> incomplete answer,
- right subset -> good answer cheaply,
- send everything -> succeeds but costs more.

## Room 5 — Should I verify?

Purpose: teach that verification is sometimes worth paying for.

The first answer should be plausible but not always trustworthy.

Player chooses whether to trust or verify.

This should be the most consequential room.

---

# 8. Player UI

## Landing screen

```text
AI ESCAPE ROOM

5 rooms.
40 coins.
Use AI wisely.

The strongest model is not always the best choice.

[ Choose nickname ]
[ START ]
```

## Main game header

```text
ROOM 3 / 5       🪙 22       ⏱ 04:12
```

## Assistance panel

```text
How do you want help?

[ Hint — 1 coin ]

[ Fast Local — 2 coins ]
Quick and cheap

[ Balanced — 5 coins ]
Better for harder tasks

[ Premium — 9 coins ]
Most capable

[ Cancel ]
```

## Result card

```text
AI RESULT

"The correct path is the blue door."

Spent: 5 coins
Tokens: 842
Latency: 1.3 s

[ TRUST THIS ANSWER ]
[ VERIFY — 3 coins ]
```

Tokens should be secondary UI for nontechnical players.

## Room completion

```text
ROOM ESCAPED

+760 points

You spent: 7 coins
Room average: 11 coins

Budget remaining: 21

[ NEXT ROOM ]
```

This comparison helps each player see their relation to the wider audience.

---

# 9. Big-Screen Dashboard

Keep the dashboard visually simple enough to understand in 3–5 seconds.

## Always visible

- Active players
- Rooms escaped
- Total AI requests
- Total tokens
- Total game coins spent

## Model choices

```text
Fast Local     48%
Balanced       34%
Premium        18%
```

## Tokens by model

```text
Fast Local    2.1M
Balanced      3.7M
Premium       4.8M
```

This allows insights such as:

> Only 18% chose Premium, but it consumed 43% of all tokens.

## Local vs external

```text
Local models      67%
External models   33%
```

Derived from model configuration metadata.

## Leaderboard

Show top 5–10 players.

Optional rotating categories:
- most efficient,
- fastest escape,
- best small-model-only run,
- biggest spender (anonymous or opt-in).

## Live insights

Examples:

> 71% of players used Premium on Room 1. Only 8% actually needed AI.

> Players who requested a hint in Room 2 spent 42% fewer coins than players who requested a full solution.

Prefer deterministic analytics over LLM-generated commentary.

---

# 10. MLflow Tracing

Every AI interaction should create a trace.

Suggested hierarchy:

```text
player_session
└── room_attempt
    ├── assistance_choice
    ├── prompt_construction
    ├── maas_request
    │   ├── model
    │   ├── input_tokens
    │   ├── output_tokens
    │   └── latency
    ├── response
    ├── verification
    └── scoring
```

Recommended metadata:

- session_id
- anonymous_player_id
- room_id
- assistance_type
- model_alias
- backing_model_id
- local_or_external
- game_cost
- input_tokens
- output_tokens
- latency_ms
- success
- answer_correct
- verification_used
- retry_number
- timestamp

Use MLflow for:
- debugging,
- puzzle/model comparison,
- selected presentation traces,
- pre-event evaluation.

Do not display arbitrary user prompt content publicly.

---

# 11. OpenShift AI MaaS Integration

Assume MaaS exposes OpenAI-compatible model APIs.

Use configuration, not hard-coded models.

Example:

```yaml
models:
  fast:
    display_name: "Fast Local"
    endpoint_model_name: "granite-small"
    type: "local"
    game_cost: 2

  balanced:
    display_name: "Balanced"
    endpoint_model_name: "qwen-balanced"
    type: "local"
    game_cost: 5

  premium:
    display_name: "Premium"
    endpoint_model_name: "gpt-5"
    type: "external"
    game_cost: 9
```

Suggested environment variables:

```text
MAAS_BASE_URL=
MAAS_API_KEY=
MLFLOW_TRACKING_URI=
DATABASE_URL=
GAME_ADMIN_SECRET=
```

All inference calls go through the backend.

Never expose the MaaS credential to the browser.

---

# 12. Backend Responsibilities

The backend owns:

- session creation,
- player state,
- room state,
- scoring,
- budget accounting,
- prompt templates,
- MaaS requests,
- token accounting,
- tracing,
- leaderboard updates,
- dashboard aggregation,
- answer validation.

Do not trust the frontend for score, budget, room completion, or answer correctness.

---

# 13. Suggested API

## POST `/api/session`

Creates anonymous player session.

Example response:

```json
{
  "session_id": "abc123",
  "nickname": "PixelFox",
  "budget": 40,
  "score": 0,
  "current_room": 1
}
```

## GET `/api/session/{id}`

Returns current player state.

## GET `/api/rooms/{room_id}`

Returns player-visible puzzle data. Never return hidden answers.

## POST `/api/rooms/{room_id}/assist`

Example request:

```json
{
  "session_id": "abc123",
  "assistance_type": "model",
  "model_alias": "balanced",
  "selected_context_ids": ["note_2", "note_5"]
}
```

Example response:

```json
{
  "response": "Look closely at the symbols...",
  "game_cost": 6,
  "remaining_budget": 18,
  "usage": {
    "input_tokens": 540,
    "output_tokens": 92
  }
}
```

## POST `/api/rooms/{room_id}/answer`

```json
{
  "session_id": "abc123",
  "answer": "BLUE"
}
```

Response:

```json
{
  "correct": true,
  "score_delta": 760,
  "total_score": 3310,
  "next_room": 4
}
```

## POST `/api/rooms/{room_id}/verify`

Runs configured verification path.

## GET `/api/dashboard/summary`

Aggregate event metrics.

## GET `/api/dashboard/models`

Model usage statistics.

## GET `/api/dashboard/leaderboard`

Current leaderboard.

For live dashboard updates use Server-Sent Events, WebSockets, or short polling. SSE is sufficient for the first version.

---

# 14. Minimal Data Model

## PlayerSession

```text
id
nickname
created_at
started_at
finished_at
budget_initial
budget_remaining
score
current_room
```

## RoomAttempt

```text
id
session_id
room_id
started_at
completed_at
correct
wrong_attempts
coins_spent
score
```

## AIRequest

```text
id
session_id
room_id
assistance_type
model_alias
backing_model_id
game_cost
input_tokens
output_tokens
latency_ms
status
created_at
trace_id
```

## PlayerAnswer

```text
id
session_id
room_id
answer
correct
created_at
```

---

# 15. Minimal Admin Interface

Admin should be able to:

- open/close registration,
- reset event state,
- see player count,
- see model health,
- enable/disable a model,
- adjust game coin costs,
- pause the game,
- start Round 2,
- moderate nicknames,
- inspect errors.

Do not overbuild this initially.

---

# 16. Semantic Router — Phase 2

## Round 1: Human routing

The player decides:

- whether AI is needed,
- which model to use,
- hint vs full answer,
- amount of context,
- whether to verify.

Concept:

> **You are the router.**

## Round 2: Automated routing

The player selects an objective:

```text
[ SAVE BUDGET ]
[ GO FAST ]
[ MAXIMIZE SUCCESS ]
[ BALANCED ]
```

The system automatically chooses the model.

Example:

```text
simple task        -> Fast Local
moderate reasoning -> Balanced
high complexity    -> Premium
```

Initially, Semantic Router should automate **model selection only**.

Do not conflate model routing with:
- context selection,
- hint/full-solution strategy,
- verification strategy.

Those can later be automated with orchestration logic.

---

# 17. Humans vs Router

After Round 2, compare aggregate results.

Example:

```text
HUMANS vs ROUTER

                     Humans     Router
Success rate          84%        91%
Avg coins / room      6.8        5.2
Premium usage         31%        17%
Avg latency           2.9s       2.4s
```

Do not design the system so the router must always win.

A useful result may show:
- humans outperform on one room,
- router is more consistent,
- router is cheaper overall,
- humans occasionally make unusually good decisions.

Teaching point:

> Routing can automate repeated model-selection decisions at scale, but routing policies themselves need evaluation.

---

# 18. Puzzle Evaluation Before Events

Test every room against every available model.

Capture:

- success rate,
- average input tokens,
- average output tokens,
- latency,
- variance,
- common failure modes.

Example:

| Room | Fast | Balanced | Premium |
|---|---:|---:|---:|
| 1 | 98% | 99% | 100% |
| 2 | 82% | 94% | 98% |
| 3 | 51% | 83% | 96% |
| 4 | context-dependent | context-dependent | context-dependent |
| 5 | 65% | 81% | 95% |

Tune game pricing based on observed behavior rather than assumptions.

MLflow can store evaluation runs.

---

# 19. Scale Expectations

Target:

- approximately 500 concurrent players,
- burst traffic after QR scan,
- synchronized puzzle progression,
- potentially high inference concurrency.

Design for:

- async/nonblocking inference calls,
- connection pooling,
- one active AI request per player,
- request cooldown,
- prevention of duplicate submissions,
- graceful model timeout handling,
- persistent game state,
- aggregated dashboard metrics.

The dashboard should query aggregates, not raw events.

---

# 20. Public Event Safety

- filter/moderate nicknames,
- limit prompt length,
- rate-limit AI requests,
- never expose MaaS credentials,
- never display arbitrary user prompt text on the big screen,
- avoid leaking trace payloads containing user-entered sensitive information,
- scope free-form prompts to puzzle context where possible.

---

# 21. Recommended MVP

Build only:

### Player app
- QR-accessible mobile web UI
- anonymous nickname
- 5 rooms
- 40-coin budget
- Solve Myself
- Hint
- 3 model choices
- optional context selection in one room
- verification in one room
- score
- leaderboard rank

### Backend
- session state
- PostgreSQL or SQLite for local prototype
- MaaS integration
- deterministic game economy
- server-side answer validation
- token and latency logging
- simple MLflow traces

### Big screen
One page showing:
- active players
- rooms escaped
- model-selection percentages
- tokens by model
- local vs external usage
- top 5 leaderboard

Do **not** build Semantic Router first.

First make the core game genuinely fun.

---

# 22. Suggested Technology Stack

One reasonable implementation:

### Frontend
- Next.js / React
- responsive mobile layout
- Tailwind CSS or equivalent

### Backend
- FastAPI, or Next.js server routes
- FastAPI is attractive for inference/tracing orchestration

### Storage
- SQLite for local prototype
- PostgreSQL for event deployment

### Live dashboard
- Server-Sent Events
- aggregated metrics endpoint

### AI
- OpenAI-compatible client pointed at OpenShift AI MaaS

### Tracing
- MLflow

### Deployment
- containers on OpenShift
- secrets via OpenShift Secrets

---

# 23. End-to-End Flow

```text
SCAN QR
   ↓
JOIN GAME
   ↓
40 COINS
   ↓
ROOM 1
"Do I even need AI?"
   ↓
ROOM 2
"Hint or full solution?"
   ↓
ROOM 3
"Which model is worth paying for?"
   ↓
ROOM 4
"How much context should I send?"
   ↓
ROOM 5
"Should I trust this or verify?"
   ↓
ESCAPE
   ↓
FINAL SCORE + RANK
```

Infrastructure:

```text
          ALL PLAYER REQUESTS
                  ↓
           Game Backend
                  ↓
        OpenShift AI MaaS
           ↙      ↓      ↘
      Small    Medium   External
      Local     Local    Premium
           ↘      ↓      ↙
             Telemetry
            ↙         ↘
       MLflow      Live Dashboard
```

---

# 24. Narrative

Player-facing:

> **You have 40 coins and five rooms. Escape using AI without wasting your budget.**

Technical:

> Hundreds of people are simultaneously deciding when, how, and which AI to use. All requests are served through a common AI platform that provides model choice, usage visibility, observability, and control.

Learning:

> **Efficiency does not mean using the cheapest model. It means using the right intelligence, in the right way, at the right time.**

Semantic Router follow-up:

> First, you make those decisions yourself. Then we show how the platform can automate model-selection decisions when the same problem exists at scale.

---

# 25. First Coding-Assistant Task

Start with the smallest playable vertical slice.

Implement:

1. Mobile-first landing page.
2. Anonymous session creation.
3. Visible 40-coin budget.
4. One puzzle room.
5. Three configurable model options: fast, balanced, premium.
6. An `Ask AI` backend route that:
   - checks budget,
   - constructs the puzzle prompt,
   - calls the OpenAI-compatible MaaS endpoint,
   - records token usage and latency,
   - deducts game coins,
   - returns the AI result.
7. Deterministic answer validation.
8. Room-completion score.
9. Minimal dashboard:
   - player count,
   - requests by model,
   - tokens by model.
10. Model configuration through YAML and environment variables.

Do not implement all five rooms first.

Prove this loop:

```text
player joins
→ puzzle displayed
→ player chooses model
→ MaaS inference
→ coins deducted
→ result displayed
→ answer submitted
→ score updated
→ dashboard changes
```

Then add the other mechanics incrementally.

---

# 26. Definition of Done for First Prototype

The prototype is successful when:

- at least two users can join independently,
- both start with identical budgets,
- they can choose different models,
- all calls go through MaaS,
- coin balances update correctly,
- real token usage is captured,
- puzzle results work on mobile,
- score is calculated server-side,
- dashboard updates with model/request/token statistics,
- no MaaS secret is exposed to the browser.

At that point, iterate mainly on **game design and puzzle quality**, not infrastructure.
