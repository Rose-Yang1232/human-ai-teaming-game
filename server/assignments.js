import { randomInt } from 'node:crypto';
import db, { ensureParticipant } from './db.js';

// Keep the original condition numbering, and save the actual policy as well as
// its number so a future design change cannot reinterpret an existing record.
export const conditions = [];
for (const aiConstraint of ['may-harm', 'no-harm']) {
    for (const aiObjective of ['self-urgency-bonus', 'team']) {
        for (const aiAwareness of ['oblivious', 'coordinating']) {
            conditions.push({ aiConstraint, aiObjective, aiAwareness });
        }
    }
}

function fail(status, code, message) {
    throw Object.assign(new Error(message), { status, code });
}

function response(row, source) {
    return { participantId: row.id, condition: row.condition_number,
        aiConstraint: row.ai_constraint, aiObjective: row.ai_objective,
        aiAwareness: row.ai_awareness, targetSizeOrder: [row.first_targets, row.second_targets],
        designVersion: row.design_version, assignedAt: row.created_at, source };
}

function recoverPreviousGame(participantId) {
    const previous = db.prepare(`SELECT ai_constraint AS aiConstraint, ai_objective AS aiObjective,
        ai_awareness AS aiAwareness, max_targets AS maxTargets FROM rounds
        WHERE participant_id = ? AND session = 1`).all(participantId);
    for (const row of db.prepare(`SELECT payload FROM interactions
        WHERE participant_id = ? AND session = 1 AND event_type = 'round_start'`).all(participantId)) {
        try { previous.push(JSON.parse(row.payload).settings || {}); }
        catch { previous.push({}); }
    }
    if (!previous.length) return null;
    const plans = previous.map(s => ({
        condition: conditions.findIndex(c => c.aiConstraint === s.aiConstraint &&
            c.aiObjective === s.aiObjective && c.aiAwareness === s.aiAwareness) + 1,
        firstTargets: s.maxTargets
    }));
    const plan = plans[0];
    if (!plan.condition || ![5, 15].includes(plan.firstTargets) ||
        plans.some(p => p.condition !== plan.condition || p.firstTargets !== plan.firstTargets)) {
        fail(409, 'ASSIGNMENT_AMBIGUOUS', 'Previous Game 1 records disagree. Please contact the study team.');
    }
    return plan;
}

// Balanced assignment over 8 treatments x 2 target orders = 16 groups. Each new
// participant joins the group with the fewest Prolific participants who either
// finished Game 2 or started within the last IN_PROGRESS_MINUTES; dropouts stop
// counting after that, so their group is refilled. Ties are broken at random.
// Test runs without a Prolific ID are assigned the same way but never counted.
export const IN_PROGRESS_MINUTES = 90;

function chooseBalancedCell(forcedCondition) {
    const cutoff = new Date(Date.now() - IN_PROGRESS_MINUTES * 60000).toISOString();
    const counts = new Map();
    for (const row of db.prepare(`SELECT a.condition_number AS c, a.first_targets AS f, COUNT(*) AS n
            FROM assignments a JOIN participants p ON p.id = a.id
            WHERE p.prolific_pid IS NOT NULL
              AND (a.created_at >= ? OR EXISTS (SELECT 1 FROM rounds r WHERE r.participant_id = a.id AND r.session = 2))
            GROUP BY a.condition_number, a.first_targets`).all(cutoff)) {
        counts.set(`${row.c}:${row.f}`, row.n);
    }
    const cells = [];
    for (let c = 1; c <= conditions.length; c++) {
        if (forcedCondition != null && c !== forcedCondition) continue;
        for (const f of [5, 15]) cells.push({ condition: c, firstTargets: f, n: counts.get(`${c}:${f}`) ?? 0 });
    }
    const fewest = Math.min(...cells.map(cell => cell.n));
    const open = cells.filter(cell => cell.n === fewest);
    return open[randomInt(open.length)];
}

export function getAssignment({ participantId, session, condition, userAgent }) {
    if (typeof participantId !== 'string' || !/^p-[a-zA-Z0-9-]{1,120}$/.test(participantId) ||
        ![1, 2].includes(session) ||
        (condition != null && (!Number.isInteger(condition) || condition < 1 || condition > 8))) {
        fail(400, 'ASSIGNMENT_INVALID', 'Invalid study session or condition. Please use your original study link.');
    }

    // The transaction and primary key also protect against simultaneous starts
    // from multiple tabs/processes. Retries always return the committed record.
    db.exec('BEGIN IMMEDIATE');
    try {
        let row = db.prepare('SELECT * FROM assignments WHERE id = ?').get(participantId);
        let source = 'existing';
        if (!row) {
            const recovered = recoverPreviousGame(participantId);
            if (!recovered && session === 2) {
                fail(409, 'ASSIGNMENT_MISSING', 'We could not find your Game 1 assignment. Return to your original study tab or saved study link, or contact the study team.');
            }
            const cell = recovered ? null : chooseBalancedCell(condition);
            const selected = recovered?.condition ?? cell.condition;
            const first = recovered?.firstTargets ?? cell.firstTargets;
            if (condition != null && condition !== selected) {
                fail(409, 'ASSIGNMENT_CONFLICT', 'This link requests a different condition from your saved study. Please use your original study link.');
            }
            const policy = conditions[selected - 1];
            ensureParticipant(participantId, userAgent);
            db.prepare(`INSERT INTO assignments(id, condition_number, ai_constraint, ai_objective,
                ai_awareness, first_targets, second_targets, created_at) VALUES (?,?,?,?,?,?,?,?)`)
                .run(participantId, selected, policy.aiConstraint, policy.aiObjective,
                    policy.aiAwareness, first, 20 - first, new Date().toISOString());
            row = db.prepare('SELECT * FROM assignments WHERE id = ?').get(participantId);
            source = recovered ? 'recovered' : 'created';
        }
        if (condition != null && condition !== row.condition_number) {
            fail(409, 'ASSIGNMENT_CONFLICT', 'This link requests a different condition from your saved study. Please use your original study link.');
        }
        db.exec('COMMIT');
        return response(row, source);
    } catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
}
