import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

const dir = mkdtempSync(join(tmpdir(), 'collab-http-'));
const port = 42000 + Math.floor(Math.random() * 10000);
const server = spawn(process.execPath, ['server/app.js'], {
    cwd: new URL('../../', import.meta.url),
    env: { ...process.env, EXPERIMENT_DB: join(dir, 'experiment.db'), HOST: '127.0.0.1',
        PORT: String(port), BASE_PATH: '/study', EXPORT_TOKEN: 'test-export-token', PROLIFIC_COMPLETION_CODE: 'TESTCODE' },
    stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
server.stdout.on('data', chunk => { output += chunk; });
server.stderr.on('data', chunk => { output += chunk; });
try {
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Server startup timed out: ' + output)), 10000);
        server.once('error', error => { clearTimeout(timer); reject(error); });
        server.once('exit', () => { clearTimeout(timer); reject(Error(output)); });
        server.stdout.on('data', () => {
            if (output.includes('Experiment server running')) { clearTimeout(timer); resolve(); }
        });
    });
    const base = `http://127.0.0.1:${port}/study`;
    const payload = { participantId: 'p-http-test', runId: 'run-http-test', session: 1,
        event: { schemaVersion: 1, sequence: 1, type: 'selection', occurredAt: new Date().toISOString(),
            actor: 'Human', status: 'confirmed', targetId: 2, frame: 90, elapsedMs: 5000,
            board: { targets: [{ id: 2, shape: 'square', x: 123.5, y: 456.25 }] } } };
    const post = (path, body) => fetch(base + path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const assignmentRequests = await Promise.all(Array.from({ length: 8 }, () =>
        post('/api/assignment', { participantId: 'p-assignment-http', session: 1, condition: 6 })));
    const plans = await Promise.all(assignmentRequests.map(async res => {
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('cache-control'), 'no-store');
        return res.json();
    }));
    assert.equal(plans.filter(p => p.source === 'created').length, 1);
    for (const plan of plans) {
        assert.equal(plan.condition, 6);
        assert.deepEqual(plan.targetSizeOrder, plans[0].targetSizeOrder);
        assert.equal(plan.assignedAt, plans[0].assignedAt);
    }
    const continued = await (await post('/api/assignment', { participantId: 'p-assignment-http', session: 2 })).json();
    assert.deepEqual(continued.targetSizeOrder, plans[0].targetSizeOrder);
    assert.equal((await post('/api/assignment', { participantId: 'p-unknown-game2', session: 2 })).status, 409);
    assert.equal((await post('/api/assignment', { participantId: 'p-assignment-http', session: 2, condition: 7 })).status, 409);
    assert.equal((await post('/api/assignment', { participantId: 'p-invalid', session: 0 })).status, 400);
    assert.equal((await fetch(base + '/api/export/assignments.json')).status, 403);
    const assignments = await (await fetch(base + '/api/export/assignments.json?token=test-export-token')).json();
    assert.equal(assignments.length, 1);
    assert.equal(assignments[0].condition_number, 6);

    // Landing page: Prolific IDs are stored once; a returning participant keeps
    // their first ID; funnel events are validated and exported behind the token.
    const prolific = { pid: '5f1d0c0ffee0123456789abc', studyId: 'study-1', sessionId: 'session-1' };
    let started = await (await post('/api/participant', { participantId: 'p-landing-1', prolific })).json();
    assert.deepEqual(started, { participantId: 'p-landing-1', reused: false, prolific: true });
    started = await (await post('/api/participant', { participantId: 'p-landing-2', prolific })).json();
    assert.deepEqual(started, { participantId: 'p-landing-1', reused: true, prolific: true });
    assert.equal((await post('/api/participant', { participantId: 'not-an-id' })).status, 400);
    const event = (type, payload) => post('/api/study-event',
        { participantId: 'p-landing-1', type, occurredAt: new Date().toISOString(), payload });
    assert.equal((await event('consent', { agreed: true })).status, 201);
    assert.equal((await event('qualification_attempt', { attempt: 1, outcome: 'failed', incorrect: ['q4'] })).status, 201);
    assert.equal((await event('made_up_event', {})).status, 400);
    assert.equal((await fetch(base + '/api/export/study_events.json')).status, 403);
    const events = await (await fetch(base + '/api/export/study_events.json?token=test-export-token')).json();
    assert.deepEqual(events.map(e => e.event_type), ['consent', 'qualification_attempt']);
    assert.equal(JSON.parse(events[1].payload).outcome, 'failed');
    const people = await (await fetch(base + '/api/export/participants.json?token=test-export-token')).json();
    const landing = people.filter(p => p.prolific_pid === prolific.pid);
    assert.equal(landing.length, 1);
    assert.equal(landing[0].prolific_study_id, 'study-1');

    // Official scores and bonus come from the first completed round of each game.
    await post('/api/round', { participantId: 'p-landing-1', session: 1, humanFinal: 100 });
    await post('/api/round', { participantId: 'p-landing-1', session: 1, humanFinal: 999 });   // replay: ignored
    await post('/api/round', { participantId: 'p-landing-1', session: 2, humanFinal: 50 });
    const done = await (await fetch(base + '/api/completion?participant=p-landing-1')).json();
    assert.deepEqual(done, { completionCode: 'TESTCODE', game1Points: 100, game2Points: 50, totalPoints: 150, bonusUsd: 0.75 });
    assert.equal((await fetch(base + '/api/completion')).status, 400);
    const bonuses = await (await fetch(base + '/api/export/bonuses.json?token=test-export-token')).json();
    assert.deepEqual(bonuses.map(b => [b.prolific_pid, b.bonusUsd]), [[prolific.pid, 0.75]]);
    let res = await post('/api/interaction', payload);
    assert.equal(res.status, 201);
    assert.equal((await res.json()).inserted, true);
    res = await post('/api/interaction', payload);
    assert.equal((await res.json()).inserted, false);
    assert.equal((await post('/api/interaction', { participantId: 'p-http-test' })).status, 400);
    assert.equal((await post('/api/round', { participantId: payload.participantId, runId: payload.runId,
        session: 1, teamScore: 12 })).status, 201);
    assert.equal((await fetch(base + '/api/export/interactions.json')).status, 403);
    const rows = await (await fetch(base + '/api/export/interactions.json?token=test-export-token')).json();
    assert.equal(rows.length, 1);
    assert.deepEqual(JSON.parse(rows[0].payload), payload.event);
    const rounds = await (await fetch(base + '/api/export/rounds.json?token=test-export-token')).json();
    assert.equal(rounds.find(r => r.participant_id === 'p-http-test').run_id, rows[0].run_id);
    const csv = await (await fetch(base + '/api/export/interactions.csv?token=test-export-token')).text();
    assert.match(csv, /run_id/);
    assert.match(csv, /run-http-test/);
    assert.equal((await (await fetch(base + '/api/health')).json()).interactions, 1);
    const decisionStart = { ...payload, event: { ...payload.event, schemaVersion: 2, sequence: 2,
        type: 'decision_start', decisionId: 'run-http-test:human:1' } };
    assert.equal((await post('/api/interaction', decisionStart)).status, 201);
    assert.equal((await post('/api/interaction', { ...decisionStart,
        event: { ...decisionStart.event, sequence: 3, type: 'decision_end', status: 'unfinished' } })).status, 201);
    const decisions = await (await fetch(base + '/api/export/interactions.json?token=test-export-token')).json();
    assert.equal(decisions.filter(r => r.decision_id === 'run-http-test:human:1').length, 2);
    assert.equal((await post('/api/interaction', { ...decisionStart,
        event: { ...decisionStart.event, decisionId: null } })).status, 400);
    console.log('HTTP checks passed: school-server prefix, ingestion, retry deduplication, validation, round join, protected exports, Prolific IDs, funnel events, completion code, bonuses.');
} finally {
    if (server.exitCode === null) {
        const exited = once(server, 'exit');
        server.kill('SIGTERM');
        await exited;
    }
    rmSync(dir, { recursive: true, force: true });
}
