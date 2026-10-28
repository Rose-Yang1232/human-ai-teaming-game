// Exercise the live animation replan block through pause, acknowledgment, and
// subsequent checks. DOM rendering is stubbed; planning and history are real.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boards, defaults } from './boards.mjs';
import { createRuntime } from './live-code.mjs';

const source = readFileSync(new URL('../../js/new-interface-all-agents.js', import.meta.url), 'utf8');
function extract(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `Missing ${name}`);
    return source.slice(start, source.indexOf('\n}', start) + 2);
}
const start = source.indexOf('    // During animation, AI can replan.');
const end = source.indexOf('    // **************************************** Run the Collab AI Planner', start);
assert.ok(start >= 0 && end > start);

for (const aiConstraint of ['may-harm', 'no-harm']) {
    const runtime = createRuntime(boards.find(board => board.id === 'human-commitment'), {
        ...defaults, aiConstraint, aiObjective: 'self-urgency-bonus', aiAwareness: 'coordinating'
    });
    runtime.commit(1);
    const proposed = runtime.decide(); // Refresh production region/path calculations.
    assert.equal(proposed.first.ID, 2);
    const c = runtime.context;
    const alerts = [];
    let acknowledge;
    Object.assign(c, {
        gamePhase: 'animate', isStopped: false, frameCountGame: 30,
        aiReplanCheckIntervalFrames: 15, pendingAIAutoPauseTargetId: null,
        firstStepCollab: { ID: 1, x: 520, y: 350 }, bestSolCollab: { ID: 1, maxValue: 100 },
        aiAutoPauseTriggered: false, pauseCause: null, selectionCycleTrigger: 'start',
        hasActorSelectedTarget: { Human: true, Bot: true }, choiceHistory: [], maxChoiceHistory: 100,
        aiClicks: [], numAIChanges: 0, planDelay: 0, lastAnimationTimestamp: 123,
        recordInteraction() {}, addHistoryMessage() {}, updateChoiceSummary() {}, logAIDecision() {},
        setPauseButtonActive() {},
        getObjectById(id) { return c.objects.find(obj => obj.ID === id); },
        showCustomAlert(message) {
            alerts.push(message);
            return new Promise(resolve => { acknowledge = resolve; });
        },
        startSelectionCycle() { assert.fail('Acknowledgment must not replan the announced target'); }
    });
    c.lastSelectedTargetByActor.Bot = 1;
    Object.assign(c.AIplayer, { ID: 1, moving: true });
    c.player.moving = true;
    runtime.evaluate(['addChoiceEntry', 'resumeMotionAfterConfirmation',
        'formatTargetLabelHtml', 'formatTargetLabelHtmlFromId'].map(extract).join('\n') +
        '\nfunction checkLiveReplan() {\n' + source.slice(start, end) + '\n}');
    runtime.evaluate('checkLiveReplan()');
    assert.equal(alerts.length, 0, 'First suggestion is debounced');
    runtime.evaluate('checkLiveReplan()');
    assert.equal(alerts.length, 1);
    assert.match(alerts[0], /target 1.*target 2/);
    assert.equal(c.isStopped, true);
    assert.equal(c.AIplayer.ID, 2);
    assert.equal(c.bestSolCollab.ID, 2);
    assert.equal(c.firstStepCollab.ID, 2);
    assert.equal(c.lastSelectedTargetByActor.Bot, 2);
    assert.equal(c.AIplayer.targetX, proposed.first.x);
    assert.equal(c.AIplayer.targetY, proposed.first.y);
    assert.equal(c.choiceHistory.length, 1);
    assert.equal(c.aiClicks.length, 1);
    assert.equal(c.numAIChanges, 1);
    runtime.evaluate('checkLiveReplan()');
    assert.equal(alerts.length, 1, 'No concurrent alert while awaiting acknowledgment');
    acknowledge();
    await Promise.resolve();
    assert.equal(c.isStopped, false);
    assert.equal(c.gamePhase, 'animate');
    assert.equal(c.AIplayer.moving, true);
    assert.equal(c.player.moving, true);
    assert.equal(c.pauseCause, null);
    for (let i = 0; i < 4; i++) runtime.evaluate('checkLiveReplan()');
    assert.equal(alerts.length, 1, 'Acknowledged 1 -> 2 switch must not repeat');
}
console.log('Replan pause/acknowledgment regression passed for both coordinating constraints.');
