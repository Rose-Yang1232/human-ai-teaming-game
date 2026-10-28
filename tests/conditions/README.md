# Deterministic condition checks

From the project root, with Node 18 or newer:

```sh
node tests/conditions/run.mjs
```

No package installation, Firebase, local experiment server, or participant data is needed.
Open `tests/conditions/results/report.html` in a browser afterward (directly or using
Live Server). It is a self-contained report; it does not send any data.
Use the board and result filters, then **Inspect** to see the board, eligible target
IDs, selected target, predicted route collisions, checks, and observations. The
human-switch board has a second decision available in its Decision selector.

To refresh the report after editing the game or the fixtures, rerun the command.
Opening an old report does not rerun tests. The report includes the generation time
and SHA-256 hashes of the production source files used.

## Coverage

`boards.mjs` defines 10 fixed boards. Each runs against all 12 combinations of
constraint, objective, and awareness, twice in fresh isolated contexts. The suite
compares both runs for identical decisions, plans, checks, and observations.

The cases cover objective tradeoffs, a square blocking an AI route, human commitment,
region avoidance, only-squares/hold behavior, a human switching targets, unavailable
targets, the sole-human-target exception, moving targets, and unreachable targets.

Checks include expected choices for selected fixtures, objective reward weighting,
distance discounting, legal candidates, finite interception points, motion scaling,
hold behavior, coordinating exclusions (human's half and selected target), and
fresh-run determinism. Thirty-nine
additional checks exercise the planner, game, and tutorial interception solvers
against mathematical reference answers: equal and near-equal speeds, co-location,
stationary actors, impossible meetings, field bounds, earliest roots, and pixel units.

Exit code 1 indicates a failed check; it does not mean the harness failed to create
a report. The original four equal-speed failures have been fixed in production and
remain covered by the expanded regression checks.

## Requirements versus observations

The default no-harm requirement is **never select a square**. The harness separately
reports when the route to an allowed target touches a square. To treat route
avoidance as a required no-harm behavior:

```sh
node tests/conditions/run.mjs --strict-no-harm --out tests/conditions/results/strict
```

This stricter contract currently exposes additional failures. No-harm is shape-only:
with oblivious awareness, an available human-selected non-square must remain a
candidate, including when alternatives exist. Coordinating awareness independently
excludes the human selection.

## How it uses production code

`live-code.mjs` loads the entire current `js/AIplannerv1.5.2.js` and extracts five
named functions from `js/new-interface-all-agents.js`: the actual candidate filter,
commitment resolver, half-field calculation, collision geometry, and interception
solver. It also extracts the tutorial's local interception solver. It evaluates
them in a new Node VM for each case. It does not import
the whole browser engine or duplicate its condition rules. Route prediction
(`routeTouches`) is test-owned: the game no longer filters on routes, so it is used
only for observations, such as a route passing over a square or the human's target.

The adapter depends on the current top-level function layout (unindented closing
braces). Missing functions or invalid extraction fail visibly. If those functions
are eventually moved into an importable shared module, replace extraction with
normal imports. Never run this harness against untrusted JavaScript: Node VM is
used for state isolation here, not as a security boundary.

## Scope and limits

These are **decision and route-prediction tests**, not a full game simulation.
They do not execute the animation loop, dialogs, scoring, save requests, or actual
catch events. The diagram shows a planned route, not a gameplay replay. A predicted
route collision is evidence to investigate in the game, not a recorded catch.

The human-switch case makes two decisions on an unchanged paused board, retaining
the first planner solution for the stability filter. It does not claim to test
frame-triggered switching during animation. Human commitments use static targets;
the moving-target board has no human commitment. Spawning and all randomness are
disabled; accidental `Math.random()` use throws.

Continue manual browser checks for pause/resume, incidental catches, simultaneous
catches, target expiration during animation, and end-of-round saving. These are
outside this harness's coverage.

## Editing and interpreting fixtures

- Add boards in `boards.mjs`; use unique numeric target IDs. Coordinates are pixels
  in an 800-by-800 field with center `(400, 400)` and radius `390`.
- For moving targets keep `dx = vx * speed` and `dy = vy * speed`, as in production.
- Shared constants match current defaults: alpha 0.7, stability 1.2, speed 3,
  animation factor 0.5, and participant individual bonuses 3.
- Some expected-choice checks intentionally assume those values and fixture
  positions. If changing them, reassess the intended result rather than blindly
  accepting the new output.
- Shared choices across conditions are allowed. The objective-tradeoff board
  distinguishes team-first from the other objectives; the single moving-target
  reward check additionally distinguishes their numerical utilities.

`results.json` preserves full outputs for comparison or analysis. Non-finite
numbers are encoded as strings such as `"Infinity"` and `"NaN"` for diagnostics.
Default generated outputs are ignored by Git. `--out DIRECTORY` selects another
location and overwrites that directory's `report.html` and `results.json`.

## AI pause regression

Run `node tests/conditions/replan.mjs` to exercise the production animation
replan block with the real planner and history function. It checks debouncing,
committing the announced target and finite waypoint, acknowledgment/resume, and
no repeated 1-to-2 alert on an unchanged board, for both coordinating constraints.
DOM rendering is stubbed; this is not a full browser or moving-board test.
