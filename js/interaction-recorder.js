// Structured board snapshots use canvas pixels and simulation-frame velocities.
// Store decisions, not every animation frame. No image encoding or DOM capture.
export function captureBoard({ objects, player, AIplayer, canvas, center, observableRadius,
    settings, totalScore, lastSelectedTargetByActor }) {
    const actor = (p, targetId) => ({
        x: p.x, y: p.y, width: p.width, height: p.height, color: p.color,
        velocity: p.velocity, moving: p.moving, targetId,
        targetX: p.targetX, targetY: p.targetY, bonus: p.score
    });
    return {
        width: canvas.width, height: canvas.height,
        center: { x: center.x, y: center.y }, radius: observableRadius,
        teamScore: totalScore,
        human: actor(player, player.targetObjID), ai: actor(AIplayer, AIplayer.ID),
        communicatedTargets: { ...lastSelectedTargetByActor },
        targets: objects.filter(o => o.active && !o.intercepted).map(o => ({
            id: o.ID, shape: o.shape, value: o.value, urgency: o.urgency,
            x: o.x, y: o.y, size: o.size, fill: o.fill,
            dx: o.dx * settings.animationSpeedFactor,
            dy: o.dy * settings.animationSpeedFactor,
            humanMarked: Boolean(o.marked), aiMarked: Boolean(o.AImarked),
            inHumanRegion: Boolean(o.inPlayerRegion), onHumanPath: Boolean(o.willOverlap)
        }))
    };
}

export function createInteractionRecorder({ api, session, getContext, getBoard, makeId }) {
    const runId = makeId();
    let sequence = 0;
    return {
        runId,
        record(type, details = {}, withBoard = false) {
            // Capture synchronously: later movement must not mutate saved decisions.
            const event = {
                schemaVersion: 2, sequence: ++sequence,
                occurredAt: new Date().toISOString(), type,
                ...getContext(), ...details,
                ...(withBoard ? { board: getBoard() } : {})
            };
            try {
                api?.saveInteraction({ runId, session, event });
            } catch (error) {
                console.warn('[interaction] event not saved:', error.message);
            }
            return event;
        }
    };
}

// One opportunity can contain several cancelled proposals before a confirmation.
// Use a monotonic clock for response times; ISO event times are recorded separately.
export function createHumanDecisionTracker({ runId, record, getStartDetails, now = () => performance.now() }) {
    let counter = 0;
    let active = null;
    return {
        open(reason) {
            if (active) return active.id;
            active = { id: `${runId}:human:${++counter}`, startedAt: now(), proposal: 0 };
            record('decision_start', {
                actor: 'Human', decisionId: active.id, reason, ...getStartDetails()
            }, true);
            return active.id;
        },
        selection(status, targetId, details = {}) {
            if (!active) return;
            if (status === 'proposed' || status === 'unreachable') active.proposal++;
            record('selection', {
                ...details, actor: 'Human', status, targetId, decisionId: active.id,
                proposalIndex: active.proposal, decisionElapsedMs: Math.max(0, now() - active.startedAt)
            }, true);
            if (status === 'confirmed') active = null;
        },
        finish(reason) {
            if (!active) return;
            record('decision_end', { actor: 'Human', decisionId: active.id, status: 'unfinished', reason,
                decisionElapsedMs: Math.max(0, now() - active.startedAt) });
            active = null;
        }
    };
}
