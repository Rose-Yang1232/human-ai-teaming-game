# Local experiment server

Records **timing**, **performance** and **post-survey answers** to a local
SQLite file. No install, no npm dependencies, no database daemon — it uses
`node:http` and `node:sqlite`, both built into Node 22.

```bash
node server/app.js          # http://localhost:3000
```

Port already in use? Either it is already running in another terminal
(`pkill -f "server/app.js"` to stop it) or something else has :3000 — use
`PORT=3001 node server/app.js`.

Then play at <http://localhost:3000/index.html>.

Already using VS Code Live Server on :5500? Keep doing that — the page will
still post to `localhost:3000`, and cross-origin requests from any localhost
port are allowed. Just make sure this server is running too.

## Where the data goes

`data/experiment.db` — one file, gitignored. Copy it, back it up, email it.

| table | one row per | holds |
| --- | --- | --- |
| `participants` | study participation | id, first seen, user agent |
| `assignments` | study participation | fixed agent condition and the target counts for games 1 and 2 |
| `rounds` | completed round | timing, the agent faced, scores, per-shape/level breakdown |
| `surveys` | submitted post-survey | all 22 Likert items + the free text, time on page |

`rounds` records what the participant actually faced (`ai_constraint`,
`ai_objective`, `ai_awareness`, `max_targets`). Compare it to `assignments` when
auditing the experiment. Explicit `admin=true` testing can override the settings;
participant gameplay always uses the saved assignment.

Rounds and surveys join on `participant_id`. The ID is included as `participant=`
in study URLs, and cached in `sessionStorage`. Copy the full generated link when
resuming in another tab; a bare Game 2 link cannot recover a lost identity.

## Assignment persistence and deployment

Game 1 calls `POST /api/assignment` and waits for the database record before
starting. Game 2 retrieves that same record. The record contains one of the eight
agent conditions and either `[5, 15]` or `[15, 5]`. Creation is transactional, with
one row per participation; retries and concurrent starts reuse the existing row.
There is no browser randomization fallback. An unavailable server, unknown Game 2
participation, or conflicting `condition=` override shows a recovery message.

Study URLs retain the opaque participation ID through the summary, survey,
transition, and next game. This continues to work with browser storage blocked or
cleared, provided the full study link is retained. Surveys never create new IDs.
If both the original link and stored ID are lost, the study team must recover the
participation; the app does not infer identity from browser type or timestamps.

Entering Game 1 from the qualification page uses `newParticipant=1` to start a
new participation. For a fresh test, use
`html/game-main-exp.html?session=1&newParticipant=1&condition=6`.
The flag is consumed and replaced by `participant=` before any API request, so
refreshing reuses the assignment. `condition=1..8` can choose an initial test
condition; it cannot change an existing assignment. Use a new participation to
test another condition. The separate walkthrough still works without the API.

Deploy the changed HTML, `js/api-client.js`, game engine, and `server/` together,
including the new `server/assignments.js`, then restart the Node server. Keep the
existing database and its configured `EXPERIMENT_DB` path. The `assignments` table
is added automatically; existing data is retained. For legacy IDs without an
assignment row, the server can recover the plan from agreeing Game 1 round/start
records. Conflicting records stop recovery. Different participant IDs are never
automatically merged, including the previously observed split-session case.

The server logs `[assignment]` with participation ID, game, and whether the plan
was created, reused, or recovered. New `round_start` events include the database
assignment and the identity source (`url`, `sessionStorage`, or `created`). Export
assignments via `assignments.csv` from the CLI or the protected API export.

Regression checks (all databases are disposable):

```sh
node tests/storage/assignments.mjs
node tests/storage/run.mjs
node tests/storage/http.mjs
```

After deployment, start a test participation, follow the first-game flow, and
open the generated Game 2 link in a new tab. Confirm the same condition and the
opposite target count. Also verify that a Game 2 link without an ID in a fresh
browser context stops with a recovery message.

## Prolific IDs, consent and qualification

The landing page (`index.html`) creates the participant ID. It calls
`POST /api/participant` with the `PROLIFIC_PID`, `STUDY_ID` and `SESSION_ID` from
the study link, which are saved as `prolific_pid`, `prolific_study_id` and
`prolific_session_id` on the `participants` row. If the same `PROLIFIC_PID`
arrives again, the server returns that participant's first ID, so reopening the
Prolific link never draws a second assignment. The ID is then carried in the URL
through the walkthrough, qualification and both games.

Set the Prolific study URL to
`https://<host><BASE_PATH>/index.html?PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}`.

`study_events` holds one row per funnel event (`payload` is JSON):

| `event_type` | When | Payload |
| --- | --- | --- |
| `study_start` | Landing page opens | Prolific IDs, `returning`, referrer, screen and viewport size |
| `consent` | Participant agrees and continues | `agreed`, `form`, `timeOnPageMs` |
| `qualification_attempt` | Every click on "Check answers" | `attempt`, `outcome` (`incomplete`, `failed`, `passed`), `answers`, `missing`, `incorrect`, `elapsedMs` |
| `final_feedback` | "Submit and finish" on the final page, if the box is not empty | `feedback` (free text), `timeOnPageMs` |

Consent must be saved before the participant can continue. A passing
qualification attempt is awaited before leaving the page; failed attempts are
best effort. Final feedback is optional and best effort: an empty box saves
nothing, and a failed save never blocks the completion code. `attempt` restarts at 1 if the page is reloaded, so order attempts by
`occurred_at`. Remove the Prolific columns before sharing deidentified data.

## Completion, bonuses and balanced assignment

**Completion code.** Start the server with the code from the Prolific study's
"Completed" path, e.g. `PROLIFIC_COMPLETION_CODE=C1A2B3C4 ./run.sh`. The final
page loads it from `GET /api/completion?participant=<id>` and sends the
participant to `https://app.prolific.com/submissions/complete?cc=<code>`. If it is
not set, the server prints a warning at startup and the final page asks the
participant to contact the team instead of redirecting.

**Bonuses.** A game's official score is the participant's first completed round
of that game (`human_final`), so a replay after a reload cannot raise it. The
final page shows these server-side scores. `bonuses.csv` (also
`/api/export/bonuses.csv` with the export token) lists every Prolific participant
with at least one completed game, and `server/export.js` also writes
`prolific-bulk-bonus.txt` in the `PID,amount` format that Prolific's bulk bonus
box accepts. Rate: 100 points = $0.50 (`DOLLARS_PER_POINT` in `db.js`).

**Balanced assignment.** Each new participant joins whichever of the 16 groups
(8 treatments x 2 target orders) has the fewest Prolific participants who either
finished Game 2 or started within the last 90 minutes; ties are random. Dropouts
stop counting after 90 minutes, so their group is refilled. Runs without a
Prolific ID (testing) are assigned the same way but never counted.

## Getting the data out

```bash
node server/export.js                       # -> exports/*.csv
```

`survey_wide.csv` has one column per question, ready for R/pandas.
`rounds.csv` keeps `human_stats`/`ai_stats` as JSON strings — parse them if you
need the per-shape breakdown.

Or straight from the running server:

```
http://localhost:3000/api/export/rounds.csv
http://localhost:3000/api/export/surveys.json
http://localhost:3000/api/health          # row counts
```

## How it is wired in

- `js/api-client.js` — `window.ExperimentAPI`, loaded by the game page and the
  survey page. Mints the participant id and posts JSON.
- `endGame()` in `js/new-interface-all-agents.js` posts the round.
- The inline script in `html/post-survey-game.html` posts the survey.

Round and interaction logging remain best effort, with `keepalive` so requests
can survive navigation. Assignment retrieval must succeed before gameplay.
Survey submission waits for confirmation, with a ten-second timeout and a retry
message on failure; it never creates a replacement participant ID.

## Moving to the lab server later

`server/db.js` is the only file that touches the database. Swapping SQLite for
the lab server's MongoDB means rewriting that one file; `app.js`, the API shape
and the client stay as they are.

## Panel history and decision snapshots

The main experiment now sends small `POST /api/interaction` records during play.
The `interactions` table retains the complete scrolling panel history (including
entries beyond the UI's 100-entry cap), action-panel messages, and structured board
snapshots. Practice/tutorial play is not included.

Event types:

- `round_start`: initial board, settings, simulation FPS, and admin flag.
- `selection`: human `proposed`, `confirmed`, `cancelled`, or `unreachable` choices;
  AI `chosen` targets, including automatic replans and hold (`targetId: -2`).
- `panel_history`: actor, description, displayed timestamp, and target label.
- `panel_message`: action-panel message, HTML flag, and alert/confirm/instruction kind.
- `round_end`: final board.

Every event has a schema version, sequence number, ISO timestamp, simulation frame,
wall-clock elapsed milliseconds, phase, and selection-cycle trigger. Order by
`participant_id, run_id, sequence` (network requests can arrive out of order).
Join to `rounds` on `participant_id` and `run_id`; `session` identifies game 1 or 2.
A reload or admin restart gets a new run ID. An interrupted run can have events
without a completed round row.

`payload` is JSON. For events with snapshots, `payload.board` contains the field
geometry, both players, communicated targets, scores, and every visible target's
ID, shape, value, urgency, position, size, fill, selection marks, and displacement
per simulation frame. Positions are canvas pixels; target `dx`/`dy` already include
`animationSpeedFactor`. The event's `targetId` and optional `waypoint` describe the
new decision; actor target fields may still describe the preceding commitment at
the instant a proposal is recorded. These snapshots support reconstruction of the
board at decisions, not a pixel-identical screenshot or continuous gameplay replay.
Human proposal and confirmation are separate snapshots, so snapshot count is
larger than the number of confirmed choices. Routine internal AI evaluations that
do not announce/commit a selection are not recorded.

A representative 15-target selection request measured about 4 KB of JSON. For
200 snapshots that is about 0.8 MB of raw JSON, plus panel text and SQLite/index
storage. Actual size depends on decision counts and target density.

On startup, the server creates `interactions` and adds nullable `rounds.run_id` if
missing. Existing rows are retained and have a null run ID. Deploy the updated
`server/`, `js/api-client.js`, `js/interaction-recorder.js`, and game engine together,
and restart the server. No manual database replacement is needed.

Events retry once on failure with the same run ID and sequence, which the database
deduplicates. Each attempt times out after five seconds. End-of-round navigation
waits for pending event attempts after the results prompt is acknowledged. This is
best-effort logging: sustained network failures or abrupt tab closure can still
lose events; there is no persistent offline outbox. It does not block gameplay.

Export with `node server/export.js` (adds `interactions.csv`), or use
`/api/export/interactions.json` / `/api/export/interactions.csv`. Deployed exports
use the existing `EXPORT_TOKEN` access check. Parse each row's `payload` for the
structured event and board.

Tests (use disposable databases only):

```sh
node tests/storage/run.mjs
node tests/storage/http.mjs
```

The second command opens a temporary localhost server to test ingestion and
protected exports under a deployment prefix. Browser gameplay is not covered by
these tests.

### Human-choice prediction (event schema version 2)

Each human selection opportunity now opens with a `decision_start`, before any
new click marks a target. Blocking OK prompts must be acknowledged first; a
button-free instruction does not delay the start. The canvas does not accept
selections while a blocking OK prompt is open.

A `decisionId` links that start to human `selection` events (`proposed`,
`unreachable`, `cancelled`, `confirmed`). Cancelling and trying again preserves the
same decision ID. A confirmed choice closes the opportunity; the next opportunity
gets a new ID. IDs include the run ID, so admin restarts cannot collide.

The start event contains:

- The immutable board snapshot at opportunity opening. Existing target marks and
  actor target fields describe earlier commitments, never the upcoming choice.
- `previousHumanTargetId` and `communicatedAITargetId`.
- `reason`: `initial`, `successful_catch`, `manual_pause`, `target_unavailable`, or
  `next_turn`.
- Remaining game time in simulation seconds, condition, target density, and bonuses.
- `alternatives`: every visible, uncaught target, with `selectable`/`interceptable`,
  predicted interception frames/seconds/point, team value, human bonus if caught by
  the human, and AI bonus if caught by the AI. Feasibility uses the exact production
  human click-validation solver, including its pursuit fallback. These are
  predictions, not guarantees that the target will eventually be caught. Simulation
  seconds exclude time paused for decisions and dialogs.

Human selection events include `proposalIndex` (counts both reachable proposals and
unreachable attempts) and `decisionElapsedMs`, measured with a monotonic clock from
opportunity opening. Proposal time includes deliberation before the click;
confirmation time additionally includes reading the confirmation dialog. Later
attempts include earlier cancelled attempts and any intervening prompts. These
measure elapsed time, not attention or time actively thinking.

Known interruptions emit `decision_end` with `status: "unfinished"` and a reason
(`round_end`, `restart`, or `page_exit`). Unexpected termination/network loss can
leave only a start: absence of a confirmed event must also be treated as unfinished
or missing data, never as a choice label. `pagehide` for a cached page does not close
an opportunity, allowing it to resume if restored.

The additive migration adds nullable `interactions.decision_id` and an index.
Existing schema-1 data remains readable with null decision IDs; clean historical
start snapshots cannot be retroactively reconstructed by this migration. New
schema-2 human decision events require a decision ID at ingestion. AI selections
remain separate events without human decision IDs.

For training, group by `participant_id`, `run_id`, `decision_id`, use only the
`decision_start` context as inputs, and take `targetId` from the `confirmed`
selection as the label. Do not use proposal/confirmation boards as features: they
can reveal the chosen target. Keep cancellations as intermediate events, not extra
independent choices. Exclude starts without confirmed labels, and split by
participant when evaluating generalization to new people.

Run `node tests/storage/decisions.mjs` for the live opportunity-opening hooks,
production feasibility calculation, prompt timing, immutable start snapshots,
multiple proposals, cancellation, confirmation, and unfinished-decision checks.
