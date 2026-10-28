import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';

const recorderSource = readFileSync(new URL('../../js/interaction-recorder.js', import.meta.url), 'utf8');
const { captureBoard, createInteractionRecorder } = await import('data:text/javascript;base64,' + Buffer.from(recorderSource).toString('base64'));
const state = {
    canvas: { width: 800, height: 800 }, center: { x: 400, y: 400 }, observableRadius: 390,
    settings: { animationSpeedFactor: 0.5 }, totalScore: 12,
    player: { x: 200, y: 400, width: 30, height: 30, color: 'red', moving: true, velocity: 1.5, targetObjID: 1, targetX: 450, targetY: 300, score: 3 },
    AIplayer: { x: 450, y: 500, width: 30, height: 30, color: 'blue', moving: true, velocity: 1.5, ID: 2, targetX: 520, targetY: 400, score: 6 },
    lastSelectedTargetByActor: { Human: 1, Bot: 2 },
    objects: Array.from({ length: 15 }, (_, i) => ({
        ID: i + 1, active: true, intercepted: false, shape: ['square', 'triangle', 'circle'][i % 3],
        value: i % 3 + 1, urgency: i % 3 + 1, x: 150.123456789 + i * 30.987654321,
        y: 180.123456789 + i * 20.987654321, dx: 1.23456789, dy: -0.987654321,
        size: 15, fill: [4, 7, 10][i % 3], marked: i === 0, AImarked: i === 1
    }))
};
const sent = [];
const recorder = createInteractionRecorder({ api: { saveInteraction: p => sent.push(p) }, session: 1,
    makeId: () => 'test-run', getContext: () => ({ frame: 30, elapsedMs: 2500, phase: 'confirm', trigger: 'start' }),
    getBoard: () => captureBoard(state) });
recorder.record('selection', { actor: 'Human', status: 'proposed', targetId: 1, decisionId: 'test-run:human:1' }, true);
const snapshot = sent[0].event.board;
assert.equal(snapshot.targets.length, 15);
assert.equal(snapshot.targets[0].dx, state.objects[0].dx * 0.5);
state.objects[0].x = 999;
state.player.x = 999;
state.lastSelectedTargetByActor.Human = 9;
assert.notEqual(snapshot.targets[0].x, 999);
assert.equal(snapshot.human.x, 200);
assert.equal(snapshot.communicatedTargets.Human, 1);
for (let i = 0; i < 125; i++) recorder.record('panel_history', { actor: 'Human', description: `message ${i}` });
assert.equal(sent.length, 126, 'History must not inherit the UI 100-row cap');
assert.equal(sent.at(-1).event.sequence, 126);
state.objects[0].intercepted = true;
state.objects[1].active = false;
assert.equal(captureBoard(state).targets.length, 13);

// Real SQLite migration and inserts, using only a disposable database.
const dir = mkdtempSync(join(tmpdir(), 'collab-storage-'));
let store;
try {
    const dbPath = join(dir, 'experiment.db');
    const old = new DatabaseSync(dbPath);
    const dbSource = readFileSync(new URL('../../server/db.js', import.meta.url), 'utf8');
    old.exec(dbSource.match(/CREATE TABLE IF NOT EXISTS participants \([\s\S]*?\);/)[0]);
    old.exec(dbSource.match(/CREATE TABLE IF NOT EXISTS rounds \([\s\S]*?\);/)[0]);
    old.exec("INSERT INTO participants(id,created_at) VALUES ('legacy','2026-01-01'); INSERT INTO rounds(participant_id,team_score,created_at) VALUES ('legacy',42,'2026-01-01')");
    // Emulate the previously deployed interactions table with no decision_id.
    old.exec(dbSource.match(/CREATE TABLE IF NOT EXISTS interactions \([\s\S]*?\);/)[0]);
    old.exec(`INSERT INTO interactions(participant_id,run_id,sequence,event_type,occurred_at,payload,created_at)
        VALUES ('legacy','legacy-run',1,'panel_history','2026-01-01','{}','2026-01-01')`);
    old.close();
    process.env.EXPERIMENT_DB = dbPath;
    store = await import('../../server/db.js');
    assert.equal(store.allRows('rounds')[0].team_score, 42);
    assert.equal(store.allRows('rounds')[0].run_id, null);
    for (const payload of [...sent].reverse()) store.insertInteraction({ participantId: 'p-test', ...payload });
    assert.equal(store.insertInteraction({ participantId: 'p-test', ...sent[0] }).inserted, false);
    assert.equal(store.stats().interactions, 127);
    assert.equal(store.allRows('interactions').find(r => r.run_id === 'legacy-run').decision_id, null);
    const rows = store.allRows('interactions').filter(r => r.participant_id === 'p-test').sort((a, b) => a.sequence - b.sequence);
    assert.deepEqual(JSON.parse(rows[0].payload), sent[0].event);
    assert.equal(rows[0].decision_id, 'test-run:human:1');
    assert.equal(rows.at(-1).sequence, 126);
    store.insertRound({ participantId: 'p-test', runId: recorder.runId, session: 1, teamScore: 12 });
    assert.equal(store.allRows('rounds')[1].run_id, rows[0].run_id);
    assert.throws(() => store.insertInteraction({ participantId: 'p-test', runId: 'x', event: {} }), TypeError);
    // A restarted round uses a different run ID, even with the same session/sequence.
    store.insertInteraction({ participantId: 'p-test', ...sent[0], runId: 'restarted-run' });
    assert.equal(store.stats().interactions, 128);
    for (const [i, type] of ['decision_start', 'decision_end'].entries()) {
        const event = { ...sent[0].event, sequence: 200 + i, type, decisionId: 'test-run:human:2' };
        assert.equal(store.insertInteraction({ participantId: 'p-test', ...sent[0], event }).inserted, true);
    }
    const linked = store.allRows('interactions').filter(r => r.decision_id === 'test-run:human:2');
    assert.equal(linked.length, 2);
    assert.throws(() => store.insertInteraction({ participantId: 'p-test', ...sent[0],
        event: { ...sent[0].event, decisionId: null } }), /decisionId required/);
} finally {
    store?.default.close();
    rmSync(dir, { recursive: true, force: true });
}

// Client uses the school-server prefix, retries identically, and awaits sends.
const requests = [];
let attempts = 0;
const context = vm.createContext({
    URL, URLSearchParams,
    document: { addEventListener() {} },
    window: { location: { href: 'https://lab.example/study/html/game-main-exp.html?participant=p-test',
        pathname: '/study/html/game-main-exp.html', origin: 'https://lab.example', port: '' },
        history: { replaceState() {} },
        crypto: { randomUUID: () => 'participant-uuid' }, sessionStorage: { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } } },
    fetch: async (url, options) => {
        requests.push({ url, options });
        if (++attempts === 1) throw Error('temporary network error');
        return { ok: true, json: async () => ({ ok: true }) };
    }, console: { warn() {} }, setTimeout, clearTimeout, AbortController
});
vm.runInContext(readFileSync(new URL('../../js/api-client.js', import.meta.url), 'utf8'), context);
context.window.ExperimentAPI.saveInteraction(sent[0]);
await context.window.ExperimentAPI.flushInteractions();
assert.equal(requests.length, 2);
assert.equal(requests[0].url, 'https://lab.example/study/api/interaction');
assert.equal(requests[0].options.body, requests[1].options.body);
assert.equal(requests[1].options.keepalive, true);
const bytes = Buffer.byteLength(requests[0].options.body);
assert.ok(bytes < 16 * 1024);
console.log(`Storage checks passed: snapshots, complete history, migration, SQLite round-trip, deduplication, and client retry/prefix.\nRepresentative 15-target selection request: ${bytes} bytes (${(bytes / 1024).toFixed(1)} KiB).`);
