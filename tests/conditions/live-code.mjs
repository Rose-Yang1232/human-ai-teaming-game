import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const plannerPath = new URL('../../js/AIplannerv1.5.2.js', import.meta.url);
const enginePath = new URL('../../js/new-interface-all-agents.js', import.meta.url);
const planner = readFileSync(plannerPath, 'utf8');
const engine = readFileSync(enginePath, 'utf8');
const walkthrough = readFileSync(new URL('../../js/new-interface-walkthrough.js', import.meta.url), 'utf8');

// These existing top-level functions have an unindented closing brace.
// Extract rather than copy their policy logic or execute the DOM/Firebase module.
// A source-layout change must fail loudly, never silently fall back to a mock.
function extract(name, file = engine) {
    const start = file.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`Missing live function: ${name}`);
    const end = file.indexOf('\n}', start);
    if (end < 0) throw new Error(`Missing closing brace: ${name}`);
    const source = file.slice(start, end + 2);
    new vm.Script(`(${source})`); // Verify the extracted declaration is complete.
    return source;
}

const helpers = [
    'getHumanCommittedTargetId', 'getFilteredObjectsForCollabPlanner',
    'attemptInterceptLocal', 'checkCollision', 'splitGameHalf'
].map(name => extract(name)).join('\n');

// Test-owned route prediction (the game no longer filters on routes). Would the AI,
// flying straight to intercept `candidate`, touch `protectedObj` on the way? Steps the
// same straight-line motion the game animates and uses the live collision rule.
// Used only for observations (e.g. a route passing over a square), never as a rule.
const routePrediction = `
function routeTouches(candidate, protectedObj) {
    const factor = settings.animationSpeedFactor;
    const [success, travelTime, interceptX, interceptY] = attemptInterceptLocal(
        AIplayer.x - center.x, AIplayer.y - center.y, AIplayer.velocity,
        candidate.x - center.x, candidate.y - center.y,
        candidate.dx * factor, candidate.dy * factor, observableRadius);
    if (!success || !Number.isFinite(travelTime)) return false;
    const endX = interceptX + center.x;
    const endY = interceptY + center.y;
    const frames = Math.ceil(Math.hypot(endX - AIplayer.x, endY - AIplayer.y) / AIplayer.velocity);
    const stepX = frames > 0 ? (endX - AIplayer.x) / frames : 0;
    const stepY = frames > 0 ? (endY - AIplayer.y) / frames : 0;
    const box = { x: AIplayer.x, y: AIplayer.y, width: AIplayer.width, height: AIplayer.height };
    const target = { x: protectedObj.x, y: protectedObj.y, size: protectedObj.size };
    for (let f = 0; f <= frames; f++) {
        if (checkCollision(box, target)) return true;
        box.x += stepX; box.y += stepY;
        target.x += protectedObj.dx * factor; target.y += protectedObj.dy * factor;
    }
    return false;
}`;
// Rename only the declaration so both live local solvers can coexist in the VM.
const tutorialSolver = extract('attemptInterceptLocal', walkthrough)
    .replace('function attemptInterceptLocal(', 'function attemptInterceptWalkthrough(');

export const sourceHashes = Object.fromEntries([
    ['js/AIplannerv1.5.2.js', planner], ['js/new-interface-all-agents.js', engine],
    ['js/new-interface-walkthrough.js', walkthrough]
].map(([name, source]) => [name, createHash('sha256').update(source).digest('hex')]));

export function createRuntime(board, settings) {
    const velocity = settings.playerSpeed * settings.animationSpeedFactor;
    const context = vm.createContext({
        settings: structuredClone(settings),
        objects: structuredClone(board.objects),
        player: { ...board.human, velocity, targetObjID: null },
        AIplayer: { ...board.ai, velocity },
        center: { x: 400, y: 400 }, observableRadius: 390,
        canvas: { width: 800, height: 800 }, DEBUG: false,
        pendingHumanSelectionForConfirm: null,
        lastSelectedTargetByActor: { Human: null },
        console: { log() {}, warn() {}, error() {} }
    });
    vm.runInContext(planner + '\n' + helpers + '\n' + routePrediction + '\n' + tutorialSolver, context, { timeout: 2000 });
    // Prevent accidental randomness from making a fixture appear deterministic.
    vm.runInContext('Math.random = () => { throw new Error("Randomness in deterministic test"); };', context);
    return {
        context,
        evaluate(code) { return vm.runInContext(code, context, { timeout: 2000 }); },
        commit(id) {
            context.player.targetObjID = id ?? null;
            context.lastSelectedTargetByActor.Human = id ?? null;
            const target = context.objects.find(obj => obj.ID === id);
            context.pendingHumanSelectionForConfirm = target ?? null;
            // Static fixtures use exact target positions; moving-human interception
            // is intentionally outside this decision-level harness.
            context.player.targetX = target?.x ?? context.player.x;
            context.player.targetY = target?.y ?? context.player.y;
        },
        decide(previous = null, frame = 0) {
            context.previous = previous;
            context.frame = frame;
            return this.evaluate(`
                for (const obj of objects) obj.inPlayerRegion = splitGameHalf(obj);
                var eligible = getFilteredObjectsForCollabPlanner(objects);
                var decision = runAIPlanner(eligible, AIplayer, observableRadius, center,
                    'collab', settings.AIStabilityThreshold, previous, frame, settings.alpha);
                ({ eligible: eligible.map(obj => obj.ID), first: decision[0], plan: decision[1] });
            `);
        }
    };
}
