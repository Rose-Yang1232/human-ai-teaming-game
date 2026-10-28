// Local data store for the intercept-game experiment.
//
// Uses node:sqlite (built into Node 22) so the server has ZERO npm
// dependencies. The whole database is one file, data/experiment.db, which you
// can copy, back up or hand to a collaborator as-is.
//
// All DB access lives in this file. If this later moves to the lab server's
// MongoDB, this is the only file that has to be rewritten.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DB_PATH = process.env.EXPERIMENT_DB
    || resolve(HERE, '..', 'data', 'experiment.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

// WAL keeps reads working while a write is in flight, which matters as soon as
// you inspect the database while a session is running.
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS participants (
    id           TEXT PRIMARY KEY,
    created_at   TEXT NOT NULL,
    user_agent   TEXT,
    notes        TEXT
);

CREATE TABLE IF NOT EXISTS assignments (
    id               TEXT PRIMARY KEY REFERENCES participants(id),
    condition_number INTEGER NOT NULL CHECK(condition_number BETWEEN 1 AND 8),
    ai_constraint    TEXT NOT NULL,
    ai_objective     TEXT NOT NULL,
    ai_awareness     TEXT NOT NULL,
    first_targets    INTEGER NOT NULL CHECK(first_targets IN (5, 15)),
    second_targets   INTEGER NOT NULL CHECK(second_targets IN (5, 15) AND second_targets != first_targets),
    design_version   INTEGER NOT NULL DEFAULT 1,
    created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rounds (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_id TEXT NOT NULL REFERENCES participants(id),
    session        INTEGER,

    -- timing
    started_at     TEXT,     -- ISO, when the round began
    ended_at       TEXT,     -- ISO, when endGame fired
    duration_ms    INTEGER,  -- wall clock
    frames         INTEGER,  -- frameCountGame, a frame-accurate duration

    -- the agent the participant actually faced
    ai_constraint  TEXT,
    ai_objective   TEXT,
    ai_awareness   TEXT,
    max_targets    INTEGER,
    human_bonus_per_square INTEGER,
    ai_bonus_per_triangle  INTEGER,

    -- performance
    team_score     REAL,
    human_bonus    REAL,
    ai_bonus       REAL,
    human_final    REAL,
    ai_final       REAL,
    human_stats    TEXT,     -- JSON: byLevelShape / shapeTotals / levelTotals
    ai_stats       TEXT,     -- JSON, same shape

    created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS surveys (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_id TEXT NOT NULL REFERENCES participants(id),
    session        INTEGER,
    responses      TEXT NOT NULL,   -- JSON: every post-* field
    free_text      TEXT,            -- post-comprehension, pulled out for coding
    duration_ms    INTEGER,         -- time spent on the survey page
    created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS interactions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_id TEXT NOT NULL REFERENCES participants(id),
    run_id         TEXT NOT NULL,
    session        INTEGER,
    sequence       INTEGER NOT NULL,
    event_type     TEXT NOT NULL,
    occurred_at    TEXT NOT NULL,
    frame          INTEGER,
    elapsed_ms     INTEGER,
    payload        TEXT NOT NULL,
    created_at     TEXT NOT NULL,
    UNIQUE(participant_id, run_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_interactions_run ON interactions(participant_id, run_id);

CREATE INDEX IF NOT EXISTS idx_rounds_participant  ON rounds(participant_id);
CREATE INDEX IF NOT EXISTS idx_surveys_participant ON surveys(participant_id);
`);

// Additive migration: preserve existing school-server databases and old rows.
if (!db.prepare('PRAGMA table_info(rounds)').all().some(column => column.name === 'run_id')) {
    db.exec('ALTER TABLE rounds ADD COLUMN run_id TEXT');
}

if (!db.prepare('PRAGMA table_info(interactions)').all().some(column => column.name === 'decision_id')) {
    db.exec('ALTER TABLE interactions ADD COLUMN decision_id TEXT');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_interactions_decision ON interactions(participant_id, run_id, decision_id, sequence)');

// Prolific identifiers, recorded once on the landing page. Kept on the
// participant row so bonuses and approvals can be joined to game data. Remove
// these columns before sharing deidentified data.
for (const column of ['prolific_pid', 'prolific_study_id', 'prolific_session_id']) {
    if (!db.prepare('PRAGMA table_info(participants)').all().some(c => c.name === column)) {
        db.exec(`ALTER TABLE participants ADD COLUMN ${column} TEXT`);
    }
}
db.exec('CREATE INDEX IF NOT EXISTS idx_participants_prolific ON participants(prolific_pid)');

// Funnel events before and around the games: landing, consent, and every
// qualification attempt. Payload is JSON; see server/README.md.
db.exec(`
CREATE TABLE IF NOT EXISTS study_events (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_id TEXT NOT NULL REFERENCES participants(id),
    event_type     TEXT NOT NULL,
    occurred_at    TEXT NOT NULL,
    payload        TEXT NOT NULL,
    created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_study_events_participant ON study_events(participant_id, event_type);
`);

const now = () => new Date().toISOString();
const asJson = (v) => (v == null ? null : JSON.stringify(v));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

export function ensureParticipant(id, userAgent) {
    db.prepare(`INSERT INTO participants (id, created_at, user_agent)
                VALUES (?, ?, ?)
                ON CONFLICT(id) DO NOTHING`).run(id, now(), userAgent ?? null);
    return id;
}

const PARTICIPANT_ID = /^p-[a-zA-Z0-9-]{1,120}$/;
const PROLIFIC_VALUE = /^[A-Za-z0-9_-]{1,64}$/;
export const STUDY_EVENT_TYPES = ['study_start', 'consent', 'qualification_attempt', 'final_feedback'];

// Called from the landing page. A returning Prolific participant gets their
// earlier ID back, so reopening the study link never draws a new assignment.
export function startParticipant({ participantId, prolific = {}, userAgent }) {
    if (typeof participantId !== 'string' || !PARTICIPANT_ID.test(participantId)) {
        throw Object.assign(new TypeError('Valid participantId required'), { status: 400 });
    }
    const clean = v => (typeof v === 'string' && PROLIFIC_VALUE.test(v) ? v : null);
    const pid = clean(prolific.pid), studyId = clean(prolific.studyId), sessionId = clean(prolific.sessionId);
    db.exec('BEGIN IMMEDIATE');
    try {
        let id = participantId, reused = false;
        if (pid) {
            const earlier = db.prepare(`SELECT id FROM participants WHERE prolific_pid = ?
                ORDER BY created_at LIMIT 1`).get(pid);
            if (earlier) { id = earlier.id; reused = id !== participantId; }
        }
        ensureParticipant(id, userAgent);
        if (pid) {
            db.prepare(`UPDATE participants SET prolific_pid = COALESCE(prolific_pid, ?),
                prolific_study_id = COALESCE(prolific_study_id, ?),
                prolific_session_id = COALESCE(prolific_session_id, ?) WHERE id = ?`)
                .run(pid, studyId, sessionId, id);
        }
        db.exec('COMMIT');
        return { participantId: id, reused, prolific: Boolean(pid) };
    } catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
}

export function insertStudyEvent(p) {
    if (typeof p.participantId !== 'string' || !PARTICIPANT_ID.test(p.participantId) ||
        !STUDY_EVENT_TYPES.includes(p.type) ||
        typeof p.occurredAt !== 'string' || !Number.isFinite(Date.parse(p.occurredAt))) {
        throw Object.assign(new TypeError('Valid participantId, type, and occurredAt required'), { status: 400 });
    }
    ensureParticipant(p.participantId, p.userAgent);
    const info = db.prepare(`INSERT INTO study_events (participant_id, event_type, occurred_at, payload, created_at)
        VALUES (?,?,?,?,?)`).run(p.participantId, p.type, p.occurredAt, JSON.stringify(p.payload ?? {}), now());
    return Number(info.lastInsertRowid);
}

// Bonus rate stated to participants on the rules page: 100 points = $0.50.
export const DOLLARS_PER_POINT = 0.005;

// A participant's official score per game is their FIRST completed round of that
// game, so replaying a game after a reload cannot raise the bonus.
export function participantSummary(participantId) {
    const games = {};
    for (const session of [1, 2]) {
        const row = db.prepare(`SELECT human_final, team_score, human_bonus FROM rounds
            WHERE participant_id = ? AND session = ? ORDER BY created_at, id LIMIT 1`).get(participantId, session);
        games[session] = row ? (row.human_final ?? (row.team_score ?? 0) + (row.human_bonus ?? 0)) : null;
    }
    const totalPoints = (games[1] ?? 0) + (games[2] ?? 0);
    return { game1Points: games[1], game2Points: games[2], totalPoints,
        bonusUsd: Math.round(totalPoints * DOLLARS_PER_POINT * 100) / 100 };
}

// One row per Prolific participant with at least one completed game.
export function bonusRows() {
    return db.prepare(`SELECT id, prolific_pid FROM participants
        WHERE prolific_pid IS NOT NULL AND id IN (SELECT participant_id FROM rounds)
        ORDER BY created_at`).all()
        .map(p => ({ prolific_pid: p.prolific_pid, participant_id: p.id, ...participantSummary(p.id) }));
}

export function insertRound(p) {
    ensureParticipant(p.participantId, p.userAgent);
    const info = db.prepare(`
        INSERT INTO rounds (
            participant_id, session, started_at, ended_at, duration_ms, frames,
            ai_constraint, ai_objective, ai_awareness, max_targets,
            human_bonus_per_square, ai_bonus_per_triangle,
            team_score, human_bonus, ai_bonus, human_final, ai_final,
            human_stats, ai_stats, created_at, run_id
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        p.participantId, num(p.session), p.startedAt ?? null, p.endedAt ?? null,
        num(p.durationMs), num(p.frames),
        p.aiConstraint ?? null, p.aiObjective ?? null, p.aiAwareness ?? null,
        num(p.maxTargets), num(p.humanBonusPerSquare), num(p.aiBonusPerTriangle),
        num(p.teamScore), num(p.humanBonus), num(p.aiBonus),
        num(p.humanFinal), num(p.aiFinal),
        asJson(p.humanStats), asJson(p.aiStats), now(), p.runId ?? null);
    return Number(info.lastInsertRowid);
}

export function insertInteraction(p) {
    const e = p.event;
    if (typeof p.participantId !== 'string' || !p.participantId ||
        typeof p.runId !== 'string' || !p.runId || !e ||
        !Number.isSafeInteger(e.sequence) || e.sequence < 1 ||
        !['round_start', 'round_end', 'decision_start', 'decision_end', 'selection', 'panel_history', 'panel_message'].includes(e.type) ||
        typeof e.occurredAt !== 'string' || !Number.isFinite(Date.parse(e.occurredAt))) {
        throw new TypeError('Valid participantId, runId, and event required');
    }
    const needsDecisionId = ['decision_start', 'decision_end'].includes(e.type) ||
        (e.schemaVersion >= 2 && e.type === 'selection' && e.actor === 'Human');
    if ((needsDecisionId || e.decisionId != null) &&
        (typeof e.decisionId !== 'string' || !e.decisionId)) {
        throw new TypeError('decisionId required for human decision events');
    }
    ensureParticipant(p.participantId, p.userAgent);
    const result = db.prepare(`INSERT INTO interactions
        (participant_id, run_id, session, sequence, event_type, occurred_at,
         frame, elapsed_ms, payload, created_at, decision_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(participant_id, run_id, sequence) DO NOTHING`).run(
        p.participantId, p.runId, num(p.session), e.sequence, e.type, e.occurredAt,
        num(e.frame), num(e.elapsedMs), JSON.stringify(e), now(), e.decisionId ?? null);
    return { inserted: Number(result.changes) === 1 };
}

export function insertSurvey(p) {
    ensureParticipant(p.participantId, p.userAgent);
    const info = db.prepare(`
        INSERT INTO surveys (participant_id, session, responses, free_text,
                             duration_ms, created_at)
        VALUES (?,?,?,?,?,?)`).run(
        p.participantId, num(p.session), JSON.stringify(p.responses ?? {}),
        p.freeText ?? null, num(p.durationMs), now());
    return Number(info.lastInsertRowid);
}

export function stats() {
    const one = (sql) => db.prepare(sql).get();
    return {
        participants: one('SELECT COUNT(*) AS n FROM participants').n,
        rounds:       one('SELECT COUNT(*) AS n FROM rounds').n,
        surveys:      one('SELECT COUNT(*) AS n FROM surveys').n,
        interactions: one('SELECT COUNT(*) AS n FROM interactions').n,
        assignments:  one('SELECT COUNT(*) AS n FROM assignments').n,
        studyEvents:  one('SELECT COUNT(*) AS n FROM study_events').n,
        dbPath: DB_PATH
    };
}

export function allRows(table) {
    if (!['participants', 'rounds', 'surveys', 'interactions', 'assignments', 'study_events'].includes(table)) {
        throw new Error('unknown table: ' + table);
    }
    return db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
}

export default db;
