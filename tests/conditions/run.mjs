import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { boards, conditions, defaults } from './boards.mjs';
import { createRuntime, sourceHashes } from './live-code.mjs';

const args = process.argv.slice(2);
if (args.some(arg => !['--strict-no-harm', '--out'].includes(arg) && args[args.indexOf(arg) - 1] !== '--out') ||
    (args.includes('--out') && !args[args.indexOf('--out') + 1])) {
    throw new Error('Usage: node tests/conditions/run.mjs [--strict-no-harm] [--out DIRECTORY]');
}
const out = resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : 'tests/conditions/results');
const strictNoHarm = args.includes('--strict-no-harm');
const clone = value => structuredClone(value);

function runCase(board, condition) {
    const runtime = createRuntime(board, { ...defaults, ...condition });
    runtime.commit(board.humanTarget);
    const checks = [];
    const observations = [];
    const steps = [];
    const check = (name, ok) => checks.push({ name, pass: Boolean(ok) });

    function decision(label, previous, frame) {
        const result = runtime.decide(previous, frame);
        const { first, plan, eligible } = result;
        const picked = runtime.context.objects.find(obj => obj.ID === first.ID);
        const humanId = runtime.context.player.targetObjID;
        const hold = first.ID === -2;
        check(`${label}: finite waypoint`, Number.isFinite(first.x) && Number.isFinite(first.y));
        check(`${label}: selected eligible target or hold`, hold || eligible.includes(first.ID));
        check(`${label}: first step matches plan`, first.ID === plan.ID);
        check(`${label}: caught/inactive targets excluded`, eligible.every(id => {
            const obj = runtime.context.objects.find(obj => obj.ID === id);
            return obj.active && !obj.intercepted && !obj.AIintercepted;
        }));
        if (!eligible.length) check(`${label}: empty candidates hold`, hold);
        if (condition.aiConstraint === 'no-harm') {
            check(`${label}: no square selection`, !picked || picked.shape !== 'square');
            check(`${label}: squares excluded from candidates`, eligible.every(id =>
                runtime.context.objects.find(obj => obj.ID === id).shape !== 'square'));
        }
        if (condition.aiAwareness === 'coordinating') {
            check(`${label}: human commitment excluded`, !eligible.includes(humanId));
            check(`${label}: human half excluded`, eligible.every(id =>
                !runtime.context.objects.find(obj => obj.ID === id).inPlayerRegion));
        }
        const routeHits = [];
        if (picked) {
            runtime.context.candidate = picked;
            for (const obj of runtime.context.objects.filter(obj =>
                obj.ID !== picked.ID && obj.active && !obj.intercepted && !obj.AIintercepted)) {
                runtime.context.protectedObject = obj;
                if (runtime.evaluate('routeTouches(candidate, protectedObject)')) routeHits.push(obj.ID);
            }
            check(`${label}: intercept time is valid`, Number.isFinite(first.interceptTime) && first.interceptTime >= 0);
            check(`${label}: waypoint meets moving target`,
                Math.hypot(first.x - (picked.x + picked.dx * defaults.animationSpeedFactor * first.interceptTime),
                    first.y - (picked.y + picked.dy * defaults.animationSpeedFactor * first.interceptTime)) < 1e-6);
        }
        if (condition.aiAwareness === 'coordinating' && routeHits.includes(humanId)) {
            observations.push(`${label}: route passes over the human's target ${humanId}; coordinating avoids selecting it, not catching it in passing.`);
        }
        const squareHits = routeHits.filter(id => board.objects.find(obj => obj.ID === id).shape === 'square');
        if (condition.aiConstraint === 'no-harm' && squareHits.length) {
            observations.push(`${label}: no-harm route touches square(s) ${squareHits.join(', ')}; selection avoidance does not enforce catch avoidance.`);
        }
        if (strictNoHarm && condition.aiConstraint === 'no-harm') {
            check(`${label}: strict no-harm route avoids every square`, squareHits.length === 0);
        }
        if (condition.aiConstraint === 'no-harm' && condition.aiAwareness === 'oblivious' && humanId != null) {
            const humanTarget = runtime.context.objects.find(obj => obj.ID === humanId);
            if (humanTarget?.active && !humanTarget.intercepted && !humanTarget.AIintercepted && humanTarget.shape !== 'square') {
                check(`${label}: no-harm permits the human-selected non-square`, eligible.includes(humanId));
            }
        }
        if (board.id === 'only-squares' && condition.aiConstraint === 'no-harm') check('Only squares: hold', hold);
        if (board.id === 'unreachable-target') check('Unreachable target: hold', hold);
        if (board.id === 'unavailable-targets') check('Only available target: choose 4', first.ID === 4);
        if (board.id === 'moving-target') check('Reachable moving target: choose 1', first.ID === 1);
        if (board.id === 'moving-target' && picked) {
            // Independent single-reward oracle: no sequence search or human filter involved.
            const reward = { 'self-bonus': 3, 'self-urgency-bonus': 5, team: 2 }[condition.aiObjective];
            const distanceInRadii = Math.hypot(first.x - board.ai.x, first.y - board.ai.y) / 390;
            check('Single reward uses objective and distance discount',
                Math.abs(plan.maxValue - reward * defaults.alpha ** distanceInRadii) < 1e-9);
        }
        if (board.id === 'objective-tradeoff') {
            // For these fixed distances and rewards, team-first prefers the square;
            // own-bonus and combined-reward prefer the triangle. No-harm removes the square.
            const expected = condition.aiConstraint === 'may-harm' && condition.aiObjective === 'team' ? 2 : 1;
            check('Objective tradeoff: expected first target', first.ID === expected);
        }
        if (board.id === 'human-region' && condition.aiAwareness === 'coordinating') check('Human half: choose 2', first.ID === 2);
        if (board.id === 'human-switch' && condition.aiAwareness === 'coordinating') {
            check(`${label}: choose uncommitted triangle`, first.ID === (humanId === 1 ? 2 : 1));
        }
        steps.push(clone({ label, humanTarget: humanId, ...result, routeHits,
            flags: runtime.context.objects.map(obj => ({ ID: obj.ID, inPlayerRegion: obj.inPlayerRegion })) }));
        return plan;
    }

    const firstPlan = decision('Initial decision', null, 0);
    if (board.switchTo != null) {
        runtime.commit(board.switchTo);
        decision('After human switch (paused board)', firstPlan, 1);
    }
    return { boardId: board.id, condition, checks, observations, steps };
}

const results = [];
for (const board of boards) {
    for (const condition of conditions) {
        try {
            const first = runCase(board, condition);
            const repeated = runCase(board, condition);
            first.checks.push({ name: 'Identical fresh runs give identical results', pass: isDeepStrictEqual(first, repeated) });
            results.push(first);
        } catch (error) {
            results.push({ boardId: board.id, condition, steps: [], observations: [],
                checks: [{ name: `Execution error: ${error.stack}`, pass: false }] });
        }
    }
}

// Mathematical oracles: equal-speed interception is a linear equation, t = -C/B.
// Include impossible meetings so the linear branch cannot simply return success.
const diagnostics = [];
const runtime = createRuntime(boards[0], { ...defaults, ...conditions[0] });
for (const solver of ['attemptIntercept', 'attemptInterceptLocal', 'attemptInterceptWalkthrough']) {
    for (const [name, args, expected] of [
        ['unequal-speed control', [0, 0, 1, 0.5, 0, -0.5, 0, 1], 1 / 3],
        ['equal-speed approaching target', [0, 0, 1, 0.5, 0, -1, 0, 1], 0.25],
        ['equal-speed co-located target', [0, 0, 1, 0, 0, 1, 0, 1], 0],
        ['stationary co-located target', [0, 0, 0, 0, 0, 0, 0, 1], 0],
        ['stationary separated target and player', [0, 0, 0, 0.5, 0, 0, 0, 1], null],
        ['equal-speed receding target', [0, 0, 1, 0.5, 0, 1, 0, 1], null],
        ['equal-speed perpendicular target', [0, 0, 1, 0.5, 0, 0, 1, 1], null],
        ['meeting outside field', [0, 0, 1, 0.9, 0, -0.1, Math.sqrt(0.99), 1], null],
        ['target starts outside field', [0, 0, 1, 1.1, 0, -1, 0, 1], null],
        ['near-equal-speed approach', [0, 0, 1, 0.5, 0, -(1 - 1e-12), 0, 1], 0.5 / (2 - 1e-12)],
        ['two positive roots: earliest meeting', [0, 0, 1, 0.5, 0, -2, 0, 1], 1 / 6],
        ['no real roots', [0, 0, 1, 0.5, 0, 0, 2, 1], null],
        ['pixel-scale equal-speed approach', [0, 0, 1.5, 195, 0, -1.5, 0, 390], 65]
    ]) {
        const result = runtime.evaluate(`${solver}(${args.join(',')})`);
        const [px, py, speed, ox, oy, vx, vy, radius] = args;
        const pass = expected === null ? result[0] === false :
            result[0] && result.slice(1).every(Number.isFinite) &&
            Math.abs(result[1] - expected) < 1e-9 &&
            Math.hypot(result[2] - (ox + vx * expected), result[3] - (oy + vy * expected)) < 1e-9 &&
            Math.abs(Math.hypot(result[2] - px, result[3] - py) - speed * expected) < 1e-9 &&
            Math.abs(result[4] - speed * expected) < 1e-9 && Math.hypot(result[2], result[3]) <= radius;
        diagnostics.push({ name: `${solver}: ${name}`, expectedTime: expected ?? 'no interception',
            actual: clone(result), pass });
    }
}

const failedCases = results.filter(r => r.checks.some(check => !check.pass)).length;
const failedDiagnostics = diagnostics.filter(d => !d.pass).length;
const report = { generatedAt: new Date().toISOString(), defaults, sourceHashes, strictNoHarm,
    scope: 'Live planner/filter and route prediction checks. No full game-loop, UI, dialog, logging, or catch-event replay.',
    boards, results, diagnostics, summary: { cases: results.length, failedCases, failedDiagnostics,
        observationCases: results.filter(r => r.observations.length).length } };
mkdirSync(out, { recursive: true });
// Preserve non-finite numbers explicitly in JSON diagnostics rather than replacing them with null.
const json = JSON.stringify(report, (_, value) => typeof value === 'number' && !Number.isFinite(value) ? String(value) : value, 2);
writeFileSync(resolve(out, 'results.json'), json);
const template = readFileSync(new URL('./report.html', import.meta.url), 'utf8');
writeFileSync(resolve(out, 'report.html'), template.replace('/* REPORT_DATA */null', () => json.replaceAll('<', '\\u003c')));
console.log(`${results.length} board/condition cases: ${results.length - failedCases} passed, ${failedCases} failed.`);
console.log(`${diagnostics.length} solver edge checks: ${diagnostics.length - failedDiagnostics} passed, ${failedDiagnostics} failed.`);
console.log(`${report.summary.observationCases} cases have behavior observations (not failures unless --strict-no-harm applies).`);
for (const row of results.filter(r => r.checks.some(check => !check.pass))) {
    console.log(`FAIL ${row.boardId} ${Object.values(row.condition).join('/')} : ${row.checks.filter(c => !c.pass).map(c => c.name).join('; ')}`);
}
for (const row of diagnostics.filter(d => !d.pass)) console.log(`FAIL ${row.name}: expected t=${row.expectedTime}; got ${row.actual}`);
console.log(`Report: ${resolve(out, 'report.html')}`);
console.log(`Raw data: ${resolve(out, 'results.json')}`);
process.exitCode = failedCases || failedDiagnostics ? 1 : 0;
