// Dump the database to CSV for analysis. The server does not need to be running.
//
//   node server/export.js            -> exports/participants.csv, rounds.csv,
//                                       surveys.csv, survey_wide.csv
//   node server/export.js path/to/dir
//
// survey_wide.csv is the one you probably want: it flattens the JSON responses
// blob into one column per question, which is what R/pandas expect.

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allRows, bonusRows, DB_PATH } from './db.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(process.argv[2] || join(HERE, '..', 'exports'));
mkdirSync(OUT, { recursive: true });

function toCsv(rows) {
    if (!rows.length) return '';
    const cols = [...rows.reduce((s, r) => {
        Object.keys(r).forEach(k => s.add(k));
        return s;
    }, new Set())];
    const esc = (v) => {
        if (v == null) return '';
        const s = String(v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
}

const write = (name, rows) => {
    const file = join(OUT, name);
    writeFileSync(file, toCsv(rows.map(r => ({ ...r }))));
    console.log(`  ${String(rows.length).padStart(5)} rows -> ${file}`);
};

console.log(`\nreading ${DB_PATH}`);

const participants = allRows('participants');
const rounds = allRows('rounds');
const surveys = allRows('surveys');

write('participants.csv', participants);
write('rounds.csv', rounds);
write('surveys.csv', surveys);
write('interactions.csv', allRows('interactions'));
write('assignments.csv', allRows('assignments'));
write('study_events.csv', allRows('study_events'));

// Bonuses: one row per Prolific participant, plus the "PID,amount" lines that
// Prolific's bulk bonus box accepts. Amounts under one cent are left out.
const bonuses = bonusRows();
write('bonuses.csv', bonuses);
writeFileSync(join(OUT, 'prolific-bulk-bonus.txt'),
    bonuses.filter(b => b.bonusUsd >= 0.01).map(b => `${b.prolific_pid},${b.bonusUsd.toFixed(2)}`).join('\n') + '\n');

// One column per survey item, so it loads straight into R/pandas.
const wide = surveys.map((s) => {
    let responses = {};
    try { responses = JSON.parse(s.responses || '{}'); } catch { /* keep empty */ }
    return {
        id: s.id,
        participant_id: s.participant_id,
        session: s.session,
        duration_ms: s.duration_ms,
        created_at: s.created_at,
        ...responses
    };
});
write('survey_wide.csv', wide);

console.log('\ndone\n');
