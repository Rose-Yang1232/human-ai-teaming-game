import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

const dir = mkdtempSync(join(tmpdir(), 'collab-assignments-'));
process.env.EXPERIMENT_DB = join(dir, 'test.db');
const store = await import('../../server/db.js');
const { conditions, getAssignment } = await import('../../server/assignments.js');
const clientSource = readFileSync(new URL('../../js/api-client.js', import.meta.url), 'utf8');
const engine = readFileSync(new URL('../../js/new-interface-all-agents.js', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
let idCounter = 0;

function browser(href, storage = new Map(), options = {}) {
    const location = new URL(href);
    const links = (options.links || []).map(href => ({ href, getAttribute() { return this.href; } }));
    const ready = [];
    const sent = [];
    const window = {
        location, crypto: { randomUUID: () => `browser-${++idCounter}` },
        sessionStorage: {
            getItem(key) { if (options.blocked) throw Error('Blocked'); return storage.get(key) ?? null; },
            setItem(key, value) { if (options.blocked) throw Error('Blocked'); storage.set(key, value); },
            removeItem(key) { if (options.blocked) throw Error('Blocked'); storage.delete(key); }
        },
        history: { replaceState(_state, _unused, url) { location.href = url; } }
    };
    const context = vm.createContext({
        window, URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
        console: { log() {}, warn() {}, error() {} },
        document: { querySelectorAll: () => links, addEventListener: (_event, fn) => ready.push(fn) },
        fetch: async (url, options) => {
            const body = JSON.parse(options.body);
            sent.push({ url, body });
            if (options.signal.aborted) throw Error('Aborted');
            if (url.endsWith('/api/assignment')) {
                if (browser.offline) throw Error('Offline');
                try { return { ok: true, json: async () => getAssignment(body) }; }
                catch (error) { return { ok: false, json: async () => ({ error: error.message, code: error.code }) }; }
            }
            return { ok: true, json: async () => ({ ok: true }) };
        }
    });
    vm.runInContext(clientSource, context);
    return { api: window.ExperimentAPI, location, sent, links, ready, context };
}

try {
    // Recover the known design for every treatment and both target orders. This
    // exercises the additive migration without guessing across participant IDs.
    for (let n = 1; n <= 8; n++) {
        for (const first of [5, 15]) {
            const id = `p-legacy-${n}-${first}`;
            store.insertRound({ participantId: id, session: 1, ...conditions[n - 1], maxTargets: first });
            const second = getAssignment({ participantId: id, session: 2 });
            assert.equal(second.condition, n);
            assert.deepEqual(second.targetSizeOrder, [first, 20 - first]);
            assert.equal(second.source, 'recovered');
            assert.equal(getAssignment({ participantId: id, session: 1 }).source, 'existing');
        }
    }
    for (let condition = 1; condition <= 8; condition++) {
        const participantId = `p-new-${condition}`;
        const first = getAssignment({ participantId, session: 1, condition });
        const { source, ...plan } = first;
        assert.equal(source, 'created');
        assert.deepEqual([...first.targetSizeOrder].sort((a, b) => a - b), [5, 15]);
        for (const session of [1, 2, 2]) {
            const { source, ...reused } = getAssignment({ participantId, session });
            assert.equal(source, 'existing');
            assert.deepEqual(reused, plan);
        }
    }
    const count = store.stats().assignments;
    assert.throws(() => getAssignment({ participantId: 'p-unknown', session: 2 }), { code: 'ASSIGNMENT_MISSING' });
    assert.throws(() => getAssignment({ participantId: 'p-new-6', session: 2, condition: 7 }), { code: 'ASSIGNMENT_CONFLICT' });
    assert.throws(() => getAssignment({ participantId: 'p-invalid', session: 3 }), { code: 'ASSIGNMENT_INVALID' });
    assert.throws(() => getAssignment({ participantId: 'p-invalid', session: 1, condition: 9 }), { code: 'ASSIGNMENT_INVALID' });
    assert.equal(store.stats().assignments, count);
    assert.equal(store.allRows('participants').some(p => p.id === 'p-unknown'), false);

    store.insertRound({ participantId: 'p-ambiguous', session: 1, ...conditions[5], maxTargets: 15 });
    store.insertRound({ participantId: 'p-ambiguous', session: 1, ...conditions[6], maxTargets: 15 });
    assert.throws(() => getAssignment({ participantId: 'p-ambiguous', session: 2 }), { code: 'ASSIGNMENT_AMBIGUOUS' });
    store.insertInteraction({ participantId: 'p-start-only', session: 1, runId: 'legacy-start',
        event: { sequence: 1, type: 'round_start', occurredAt: new Date().toISOString(),
            settings: { ...conditions[5], maxTargets: 15 } } });
    assert.equal(getAssignment({ participantId: 'p-start-only', session: 2 }).condition, 6);

    // A separate SQLite connection sees the committed assignment. No browser
    // cache or in-process JS map is needed to retrieve it.
    const other = new DatabaseSync(process.env.EXPERIMENT_DB, { readOnly: true });
    assert.equal(other.prepare('SELECT condition_number FROM assignments WHERE id=?').get('p-new-6').condition_number, 6);
    other.close();

    // Exact report regression: condition 6 / 15 targets in Game 1. Every later
    // page gets a fresh context with unavailable storage and only the study URL.
    const first = browser('https://lab.example/study/html/game-main-exp.html?session=1&participant=p-legacy-6-15', new Map(), { blocked: true });
    const plan = await first.api.loadAssignment(1);
    assert.equal(plan.condition, 6);
    assert.equal(plan.targetSizeOrder[0], 15);
    let nextUrl = first.api.withParticipant('game-summary-round1.html?session=1');
    for (const next of ['post-survey-game.html?session=1', 'game-round2-transition.html', 'game-main-exp.html?session=2']) {
        const page = browser(nextUrl, new Map(), { blocked: true, links: [next] });
        page.ready.forEach(fn => fn());
        assert.equal(page.api.participantId(), plan.participantId);
        nextUrl = page.links[0].href;
    }
    const second = browser(nextUrl, new Map(), { blocked: true });
    const continued = await second.api.loadAssignment(2);
    assert.equal(continued.condition, 6);
    assert.equal(continued.targetSizeOrder[1], 5);
    await second.api.saveSurvey({ session: 2 });
    assert.equal(second.sent.at(-1).body.participantId, plan.participantId);
    assert.equal(second.sent[0].url, 'https://lab.example/study/api/assignment');
    assert.equal(second.api.withParticipant('https://app.prolific.com/complete'), 'https://app.prolific.com/complete');

    const noIdentity = browser('https://lab.example/study/html/game-main-exp.html?session=2');
    await assert.rejects(noIdentity.api.loadAssignment(2), /Game 1/);
    assert.equal(noIdentity.sent.length, 0);
    const unknown = browser('https://lab.example/study/html/game-main-exp.html?session=2&participant=p-missing');
    await assert.rejects(unknown.api.loadAssignment(2), { code: 'ASSIGNMENT_MISSING' });
    const conflict = browser(nextUrl + '&condition=7');
    await assert.rejects(conflict.api.loadAssignment(2), { code: 'ASSIGNMENT_CONFLICT' });

    // New study entry intentionally starts a fresh ID; refreshing that URL does
    // not do so again. An explicit URL also wins over unrelated stale tab data.
    const saved = new Map([['experimentParticipantId', plan.participantId], ['lastGameSummary', '{}']]);
    const fresh = browser('https://lab.example/study/html/game-main-exp.html?session=1&newParticipant=1&condition=4', saved);
    const newPlan = await fresh.api.loadAssignment(1);
    assert.notEqual(newPlan.participantId, plan.participantId);
    assert.equal(newPlan.condition, 4);
    assert.equal(fresh.location.searchParams.has('newParticipant'), false);
    assert.equal(saved.has('lastGameSummary'), false);
    const reloaded = browser(fresh.location.href, new Map(), { blocked: true });
    assert.equal((await reloaded.api.loadAssignment(1)).assignedAt, newPlan.assignedAt);
    assert.equal(browser(nextUrl, saved).api.participantId(), plan.participantId);

    browser.offline = true;
    await assert.rejects(reloaded.api.loadAssignment(2), /could not load/);
    browser.offline = false;
    assert.equal((await reloaded.api.loadAssignment(2)).condition, 4);

    // Exercise the actual setting application at startGame: hidden controls and
    // the legacy difficulty table must not override the saved participant plan.
    const gameStart = engine.indexOf('async function startGame(');
    const settingsEnd = engine.indexOf('    // Change to the next seed.', gameStart);
    assert.ok(gameStart >= 0 && settingsEnd > gameStart);
    const settingsSource = engine.slice(gameStart, settingsEnd) + '\nreturn settings;\n}';
    for (const session of [1, 2]) {
        for (const admin of [false, true]) {
            const values = { constraintSelect: 'may-harm', objectiveSelect: 'team',
                awarenessSelect: 'oblivious', densityRange: '10' };
            const c = vm.createContext({ URLSearchParams, WALKTHROUGH_MODE: false, SESSION_ID: session,
                currentRound: 1, roundSettings: null, settings: {}, AIplayer: {}, experimentAssignment: plan,
                difficultySettings: { 1: { 0: { 1: { maxTargets: 5 } } } },
                window: { location: { search: admin ? '?admin=true' : '' } },
                document: { getElementById: id => ({ value: values[id] }) } });
            vm.runInContext(settingsSource, c);
            const actual = await vm.runInContext('startGame(1, 1, 0, [])', c);
            assert.equal(actual.maxTargets, admin ? 10 : plan.targetSizeOrder[session - 1]);
            assert.equal(actual.aiObjective, admin ? 'team' : plan.aiObjective);
        }
    }

    // Execute the live startup block to prove no game starts before the server
    // response and no game starts at all when assignment loading fails.
    const applyStart = engine.indexOf('async function applyExperimentCondition(');
    const applySource = engine.slice(applyStart, engine.indexOf('\n}', applyStart) + 2);
    const startupStart = engine.indexOf('if (noAssignment){');
    const startup = engine.slice(startupStart, engine.indexOf('\n}', startupStart) + 2);
    for (const rejected of [false, true]) {
        let resolve, reject;
        const pending = new Promise((a, b) => { resolve = a; reject = b; });
        let starts = 0, errors = 0;
        const c = vm.createContext({
            noAssignment: true, DEBUG: false, WALKTHROUGH_MODE: false, SESSION_ID: 2,
            experimentAssignment: null, settings: {}, currentRound: 1, currentCondition: 1,
            currentBlock: 0, curSeeds: [], currentTeamingCondition: 1,
            window: { ExperimentAPI: { loadAssignment: () => pending, showStudyError: () => errors++ } },
            document: { getElementById: () => null }, console: { log() {} },
            $: () => ({ attr() {} }), startGame: () => starts++
        });
        vm.runInContext(applySource + '\nasync function initExperimentSettings() { await applyExperimentCondition(); }', c);
        const running = vm.runInContext('(async () => {' + startup + '})()', c);
        await Promise.resolve();
        assert.equal(starts, 0);
        if (rejected) {
            reject(Error('Unavailable'));
            await assert.rejects(running, /Unavailable/);
            assert.equal(starts, 0);
            assert.equal(errors, 1);
        } else {
            resolve(plan);
            await running;
            assert.equal(starts, 1);
            assert.equal(c.settings.maxTargets, 5);
        }
    }
    // Balanced assignment: 32 Prolific participants fill all 16 groups exactly
    // twice. Test runs without a Prolific ID do not count toward balance.
    const { IN_PROGRESS_MINUTES } = await import('../../server/assignments.js');
    const balanceStore = (await import('../../server/db.js'));
    for (let i = 0; i < 10; i++) getAssignment({ participantId: `p-tester-${i}`, session: 1 });
    const groups = new Map();
    for (let i = 0; i < 32; i++) {
        const id = `p-balanced-${i}`;
        balanceStore.startParticipant({ participantId: id, prolific: { pid: `PID${i}` } });
        const a = getAssignment({ participantId: id, session: 1 });
        groups.set(`${a.condition}:${a.targetSizeOrder[0]}`, (groups.get(`${a.condition}:${a.targetSizeOrder[0]}`) ?? 0) + 1);
    }
    assert.equal(groups.size, 16);
    assert.ok([...groups.values()].every(n => n === 2));
    // A stale start (dropout) stops counting; a finished participant keeps counting.
    const db2 = new DatabaseSync(process.env.EXPERIMENT_DB);
    const old = new Date(Date.now() - (IN_PROGRESS_MINUTES + 5) * 60000).toISOString();
    db2.prepare(`UPDATE assignments SET created_at = ? WHERE id IN ('p-balanced-0', 'p-balanced-1')`).run(old);
    const [g0, g1] = ['p-balanced-0', 'p-balanced-1'].map(id => getAssignment({ participantId: id, session: 1 }));
    balanceStore.insertRound({ participantId: 'p-balanced-1', session: 2, ...conditions[g1.condition - 1], maxTargets: g1.targetSizeOrder[1] });
    db2.close();
    balanceStore.startParticipant({ participantId: 'p-balanced-next', prolific: { pid: 'PIDnext' } });
    const refill = getAssignment({ participantId: 'p-balanced-next', session: 1 });
    assert.deepEqual([refill.condition, refill.targetSizeOrder[0]], [g0.condition, g0.targetSizeOrder[0]]);

    console.log('Assignment checks passed: 16 legacy plans, 8 new treatments, persistence, recovery, URL identity through the funnel without storage, conflicts, startup gating, and balanced groups with dropout refill.');
} finally {
    store.default.close();
    rmSync(dir, { recursive: true, force: true });
}
