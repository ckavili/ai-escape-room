# The AI Challenge — keynote prototype

A shared 4×4 board with six playable challenges (two each for model choice, prompt writing, and context selection). The remaining tiles are explicitly unavailable. Tasks are designed for quick reading on a phone: sentiment classification, speaker extraction, finding lunch, a meeting end time, a six-word announcement, and choosing a snack from dietary needs and ingredients. Everyone gets the same tasks and can open them in any order.

## Run locally

From the repository root:

```sh
npm run keynote
```

Player experience: http://localhost:3001

Stage dashboard: http://localhost:3001/stage

The default is a **simulated interaction demo**, regardless of `.env`. Demo answers use simple, disclosed rules in `challenges.js`. They do not represent the models' capabilities. Demo token counts are randomly generated, with input length increasing as more text is sent and illustrative output overhead varying by model tier. Spending is calculated from these invented counts using the configured illustrative rates. Spending is displayed in microdollars (`µ$`): `$0.000028` becomes `28 µ$`. Stored amounts and ranking calculations remain in USD. All demo metrics are labelled simulated; they are not measurements or bills.

For real calls through the existing MaaS adapter:

```sh
npm run keynote:live
```

This loads `.env` and uses the existing `MAAS_*` configuration and `models.yaml`. Live mode makes billable calls when players submit. Set actual pricing in `models.yaml` and use `basis: configured`; supplied demo rates remain explicitly labelled as illustrative. `KEYNOTE_PORT` overrides port 3001. `HOST` defaults to loopback. Use a private browser window or another browser profile for each independent player.

## Rules and scope

- Each player has four minutes from joining. In-flight requests may finish after the deadline; new submissions are rejected after expiry. The stage has no global start/stop control yet.
- No spending cap. Players can retry unsolved tasks. Every attempt remains in the history and any reported cost counts, including failed AI calls when usage is available.
- Every challenge requires AI. Model challenges offer a choice of Fast, Balanced, and Premium. The chosen model's answer is graded automatically.
- Prompt and context challenges use Fast so one decision changes at a time. Prompts have a 1,000-character limit. The source note is supplied automatically; context tasks send only checked documents.
- Successful tasks count once. Ranking is by correct completions. Within a tied score group, spending is compared only if every competitor's AI attempts have known costs. Otherwise joining order determines display order, without implying an efficiency winner.
- Stage participants are selected from player dropdowns. Their gameplay is identical to the audience's. Stage selections are local to that browser.
- Stage updates every three seconds and shows cumulative activity for this local database, the latest 30 request traces, and up to 12 leaderboard entries. It contains no seeded players or fictional activity.
- Usage totals include available reported usage, with unknown usage/cost counts alongside. A partial cost total is not a complete bill.
- Post-success explanations identify useful candidate comparisons. **No benchmarks have been measured** and no optimal-model or savings claims are made. Real repeated evaluations are the next step.
- The reveal explains implemented controls and separates future routing/policy integration. Automatic routing is not active.

Player sessions and attempts are stored separately from the escape room in ignored `data/keynote-v2-demo.sqlite*` and `data/keynote-v2-live.sqlite*`. Refresh preserves progress. To rehearse another round, clear this app's `keynote_session` cookie or use a fresh private browser session; prior results remain in the dashboard. Stop the server and remove only the matching mode’s database files to reset prototype data completely. Earlier prototype data in `data/keynote.sqlite*` is preserved but is not loaded by this revision. Demo and live activity are kept in separate databases.

This is a local rehearsal prototype, not an event deployment. The stage dashboard is intentionally readable without authentication and includes submitted instructions, context, and answers. Use challenge content only. Event deployment needs stage access control, global round/session management, retention decisions, rate limiting, and load testing. Request timestamps and pricing snapshots would also be needed for a fuller audit system.

## Validation

```sh
npm test
node scripts/check-keynote-ui.js
```

The UI check uses the project's installed Chrome tooling, an in-memory database, and simulated responses. It exercises all six tasks, retry, refresh, two independent players, stage selection, and reveal. Phone checks cover 320, 360, 390, and 430px widths, touch targets, the sticky timer, scroll position on return, and result visibility in a reduced viewport approximating keyboard space. Browser emulation does not replace testing on physical iOS and Android devices. Screenshots are written to `/private/tmp/keynote-board-mobile.png` and `/private/tmp/keynote-stage-desktop.png`.

The original escape room remains available with `npm start`.
