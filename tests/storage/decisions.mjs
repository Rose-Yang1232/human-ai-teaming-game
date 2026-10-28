import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const moduleSource = readFileSync(new URL('../../js/interaction-recorder.js', import.meta.url), 'utf8');
const { captureBoard, createInteractionRecorder, createHumanDecisionTracker } = await import(
    'data:text/javascript;base64,' + Buffer.from(moduleSource).toString('base64'));
const source = readFileSync(new URL('../../js/new-interface-all-agents.js', import.meta.url), 'utf8');
function extract(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    return source.slice(start, source.indexOf('\n}', start) + 2);
}
const target = (ID, x, speed = 0) => ({ ID, x, y: 400, vx: 1, vy: 0, dx: speed, dy: 0, speed,
    active: true, intercepted: false, shape: 'square', urgency: 2, value: 2, size: 15, fill: 7 });
const context = vm.createContext({
    WALKTHROUGH_MODE: false, DEBUG: false, gamePhase: 'preview', selectionAlertPending: true,
    humanDecisionReason: 'initial', humanDecisionTracker: null,
    settings: { animationSpeedFactor: 0.5, aiObjective: 'team', aiConstraint: 'no-harm',
        aiAwareness: 'coordinating', maxTargets: 5, humanBonusPerSquare: 3, aiBonusPerTriangle: 3 },
    objects: [target(1, 500), target(2, 770, 4), { ...target(3, 450), intercepted: true }],
    player: { x: 200, y: 400, width: 30, height: 30, velocity: 1.5, targetObjID: 8, score: 3 },
    AIplayer: { x: 450, y: 500, width: 30, height: 30, velocity: 1.5, ID: 9, score: 6 },
    center: { x: 400, y: 400 }, observableRadius: 390, canvas: { width: 800, height: 800 },
    lastSelectedTargetByActor: { Human: 8, Bot: 9 }, totalScore: 20,
    fps: 30, frameCountGame: 300, maxFrames: 1800, selectionCycleTrigger: 'start',
    console, selectionQueue: [], selectionIndex: 0, pendingHumanSelectionForConfirm: null,
    aiSelectionPlanned: false
});
vm.runInContext(['beginHumanDecision', 'recordHumanSelection', 'finishHumanDecision',
    'getHumanDecisionStartDetails', 'startSelectionCycle', 'getHumanInterceptPlanForTarget',
    'getSimulatedHumanInterceptPlan', 'attemptInterceptLocal'].map(extract).join('\n'), context);
let clock = 100;
const events = [];
const recorder = createInteractionRecorder({
    api: { saveInteraction: p => events.push(p.event) }, session: 1, makeId: () => 'run',
    getContext: () => ({ frame: context.frameCountGame, phase: context.gamePhase }),
    getBoard: () => captureBoard(context)
});
context.humanDecisionTracker = createHumanDecisionTracker({ runId: recorder.runId,
    record: recorder.record, getStartDetails: context.getHumanDecisionStartDetails, now: () => clock });
context.startSelectionCycle('human', 'start');
assert.equal(events.length, 0, 'Do not start response timing during a blocking prompt');
context.selectionAlertPending = false;
context.beginHumanDecision();
const start = events[0];
assert.equal(start.type, 'decision_start');
assert.equal(start.reason, 'initial');
assert.equal(start.remainingGameSeconds, 50);
assert.equal(start.previousHumanTargetId, 8);
assert.equal(start.communicatedAITargetId, 9);
assert.equal(start.alternatives.length, 2, 'Exclude caught targets');
assert.equal(start.alternatives[0].interceptable, true);
assert.equal(start.alternatives[0].interceptionFrames, 200);
assert.equal(start.alternatives[0].interceptionSeconds, 200 / 30);
assert.equal(start.alternatives[0].humanBonus, 3);
assert.equal(start.alternatives[0].teamValue, 2);
assert.equal(start.alternatives[1].interceptable, false);
assert.equal(start.alternatives[1].selectable, false);
assert.equal(start.alternatives[1].interceptionFrames, null);
assert.equal(start.board.targets[0].humanMarked, false);
clock = 400;
context.objects[0].marked = true;
context.player.targetObjID = 1;
context.recordHumanSelection('proposed', 1);
assert.equal(events.at(-1).decisionElapsedMs, 300);
assert.equal(events.at(-1).proposalIndex, 1);
assert.equal(start.board.targets[0].humanMarked, false, 'Future click cannot contaminate start board');
assert.equal(start.board.human.targetId, 8);
clock = 500;
context.recordHumanSelection('cancelled', 1);
context.startSelectionCycle('human', 'start');
assert.equal(events.filter(e => e.type === 'decision_start').length, 1, 'Cancel keeps the original decision');
clock = 600;
context.recordHumanSelection('unreachable', 2);
clock = 700;
context.recordHumanSelection('proposed', 1);
clock = 900;
context.recordHumanSelection('confirmed', 1);
assert.equal(events.at(-1).proposalIndex, 3);
assert.equal(events.at(-1).decisionElapsedMs, 800);
assert.ok(events.every(e => e.decisionId === start.decisionId));
assert.equal(events.filter(e => e.status === 'confirmed').length, 1);
context.startSelectionCycle('human', 'intercept', 'successful_catch');
assert.notEqual(events.at(-1).decisionId, start.decisionId);
assert.equal(events.at(-1).reason, 'successful_catch');
clock = 1000;
context.finishHumanDecision('restart');
assert.equal(events.at(-1).status, 'unfinished');
assert.equal(events.at(-1).reason, 'restart');
const count = events.length;
context.finishHumanDecision('page_exit');
assert.equal(events.length, count, 'No duplicate terminal event');
context.startSelectionCycle('human', 'pause');
assert.equal(events.at(-1).reason, 'manual_pause');
context.finishHumanDecision('round_end');
context.startSelectionCycle('human', 'intercept');
assert.equal(events.at(-1).reason, 'target_unavailable');
context.finishHumanDecision('page_exit');
console.log('Decision checks passed: live phase hooks, prompt timing, no future-choice leakage, production feasibility solver, IDs, cancellations, response times, and unfinished decisions.');
