// Local experiment server: serves the game AND records its data.
//
//   node server/app.js            -> http://localhost:3000
//
// Zero npm dependencies (node:http + node:sqlite). Two ways to use it:
//
//   1. Open http://localhost:3000/index.html and play. Same origin as the API,
//      so nothing special happens.
//   2. Keep using VS Code Live Server on :5500. Cross-origin requests from any
//      localhost port are allowed below, so logging still works.

// node:sqlite is still flagged experimental; the warning is noise here, so hide
// just that one and let every other warning through.
process.removeAllListeners('warning');
process.on('warning', (w) => {
    if (w.name !== 'ExperimentalWarning') console.warn(w.name + ': ' + w.message);
});

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { insertRound, insertSurvey, insertInteraction, insertStudyEvent, startParticipant, participantSummary, bonusRows, stats, allRows, DB_PATH } from './db.js';
import { getAssignment } from './assignments.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');           // repo root; the game is served from here
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// A lab server may proxy https://<host>/<name>/ to this
// process, so every request arrives with that prefix still attached. Set
// BASE_PATH=/<name> and we strip it, which lets the identical code run mounted
// at the domain root locally and under a sub-path when deployed.
//
// Deliberately forgiving: if the proxy already strips the prefix, nothing
// matches and the path falls through untouched. Either way works.
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/+$/, '');

// The export endpoints hand over every row we hold, so they cannot stay open
// once this is reachable from the internet. Set EXPORT_TOKEN and pass
// ?token=... to use them. With no token set they work locally only, which
// keeps development friction-free while refusing to expose data when deployed.
const EXPORT_TOKEN = process.env.EXPORT_TOKEN || '';

// From the Prolific study's "Completed" path. Set it when starting the server so
// a new Prolific study needs no code change. Without it the final page cannot
// send anyone back to Prolific.
const PROLIFIC_COMPLETION_CODE = (process.env.PROLIFIC_COMPLETION_CODE || '').trim();

function exportAllowed(url) {
    if (EXPORT_TOKEN) return url.searchParams.get('token') === EXPORT_TOKEN;
    return !BASE_PATH;
}

function stripBase(pathname) {
    if (!BASE_PATH) return pathname;
    if (pathname === BASE_PATH) return '/';
    if (pathname.startsWith(BASE_PATH + '/')) return pathname.slice(BASE_PATH.length);
    return pathname;
}

const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp4': 'video/mp4',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.map': 'application/json'
};

// Local development only: allow the page to be served from any localhost port
// (e.g. Live Server on 5500) while the API runs here.
function cors(req, res) {
    const origin = req.headers.origin;
    if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const json = (res, code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
};

async function readJsonBody(req, limitBytes = 8 * 1024 * 1024) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > limitBytes) throw new Error('payload too large');
        chunks.push(chunk);
    }
    if (!size) return {};
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function toCsv(rows) {
    if (!rows.length) return '';
    const cols = Object.keys(rows[0]);
    const esc = (v) => {
        if (v == null) return '';
        const s = String(v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
}

// Top-level directories that must never be served. The repo root is the web
// root, so without this the collected participant database is a public download
// once the app is behind a public proxy. Dot-directories (.git above all)
// are refused by the segment check below.
const DENY = new Set(['data', 'exports', 'server', 'console-logs', 'node_modules']);

async function serveStatic(req, res, pathname) {
    // normalize() + the prefix check keep ../ traversal out of the tree.
    const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');

    // 404 rather than 403: no reason to confirm these exist.
    const segs = rel.split(/[/\\]/).filter(Boolean);
    if (segs.some(s => s.startsWith('.')) || DENY.has(segs[0])) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Not found');
    }

    let filePath = join(ROOT, rel);
    if (!filePath.startsWith(ROOT)) return json(res, 403, { error: 'forbidden' });
    try {
        const info = await stat(filePath);
        if (info.isDirectory()) filePath = join(filePath, 'index.html');
        const body = await readFile(filePath);
        res.writeHead(200, {
            'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-store'   // always serve the file you just edited
        });
        res.end(body);
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found: ' + rel);
    }
}

const server = createServer(async (req, res) => {
    cors(req, res);
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = stripBase(url.pathname);

    try {
        if (path === '/api/health') {
            const { dbPath, ...counts } = stats();   // path stays server-side
            return json(res, 200, { ok: true, ...counts });
        }

        if (path === '/api/assignment' && req.method === 'POST') {
            const body = await readJsonBody(req, 4096);
            try {
                const assignment = getAssignment({ ...body, userAgent: req.headers['user-agent'] });
                console.log(`[assignment] participant=${assignment.participantId} game=${body.session} ` +
                    `source=${assignment.source} condition=${assignment.condition} order=${assignment.targetSizeOrder.join(',')}`);
                return json(res, 200, assignment);
            } catch (error) {
                console.warn(`[assignment] participant=${body.participantId} game=${body.session} error=${error.code || 'SERVER_ERROR'}`);
                throw error;
            }
        }

        if (path === '/api/completion' && req.method === 'GET') {
            const participantId = url.searchParams.get('participant') || '';
            if (!/^p-[a-zA-Z0-9-]{1,120}$/.test(participantId)) return json(res, 400, { error: 'participant required' });
            if (!PROLIFIC_COMPLETION_CODE) return json(res, 503, { error: 'Completion code is not configured' });
            return json(res, 200, { completionCode: PROLIFIC_COMPLETION_CODE, ...participantSummary(participantId) });
        }

        if (path === '/api/participant' && req.method === 'POST') {
            const body = await readJsonBody(req, 4096);
            const result = startParticipant({ ...body, userAgent: req.headers['user-agent'] });
            console.log(`[participant] ${result.participantId} prolific=${result.prolific} reused=${result.reused}`);
            return json(res, 200, result);
        }

        if (path === '/api/study-event' && req.method === 'POST') {
            const body = await readJsonBody(req, 65536);
            const id = insertStudyEvent({ ...body, userAgent: req.headers['user-agent'] });
            console.log(`[study]  participant=${body.participantId} ${body.type}` +
                (body.type === 'qualification_attempt' ? ` outcome=${body.payload?.outcome}` : ''));
            return json(res, 201, { ok: true, id });
        }

        if (path === '/api/round' && req.method === 'POST') {
            const body = await readJsonBody(req);
            if (!body.participantId) return json(res, 400, { error: 'participantId required' });
            const id = insertRound({ ...body, userAgent: req.headers['user-agent'] });
            console.log(`[round]  participant=${body.participantId} session=${body.session} ` +
                        `team=${body.teamScore} human=${body.humanBonus} ai=${body.aiBonus} ` +
                        `${body.aiConstraint}/${body.aiObjective}/${body.aiAwareness} ` +
                        `targets=${body.maxTargets} ${Math.round((body.durationMs || 0) / 1000)}s -> row ${id}`);
            return json(res, 201, { ok: true, id });
        }

        if (path === '/api/interaction' && req.method === 'POST') {
            const body = await readJsonBody(req, 64 * 1024);
            try {
                const result = insertInteraction({ ...body, userAgent: req.headers['user-agent'] });
                return json(res, 201, { ok: true, ...result });
            } catch (error) {
                if (error instanceof TypeError) return json(res, 400, { error: error.message });
                throw error;
            }
        }

        if (path === '/api/survey' && req.method === 'POST') {
            const body = await readJsonBody(req);
            if (!body.participantId) return json(res, 400, { error: 'participantId required' });
            const id = insertSurvey({ ...body, userAgent: req.headers['user-agent'] });
            const n = Object.keys(body.responses || {}).length;
            console.log(`[survey] participant=${body.participantId} session=${body.session} ` +
                        `${n} answers -> row ${id}`);
            return json(res, 201, { ok: true, id });
        }

        // /api/export/rounds.csv | surveys.csv | participants.csv (or .json)
        const exp = path.match(/^\/api\/export\/(participants|rounds|surveys|interactions|assignments|study_events|bonuses)\.(csv|json)$/);
        if (exp) {
            if (!exportAllowed(url)) return json(res, 403, { error: 'export requires a token' });
            const rows = (exp[1] === 'bonuses' ? bonusRows() : allRows(exp[1])).map(r => ({ ...r }));
            if (exp[2] === 'json') return json(res, 200, rows);
            res.writeHead(200, {
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="${exp[1]}.csv"`
            });
            return res.end(toCsv(rows));
        }

        if (path.startsWith('/api/')) return json(res, 404, { error: 'no such endpoint' });

        return serveStatic(req, res, path === '/' ? '/index.html' : path);
    } catch (error) {
        console.error('[error]', error.message);
        return json(res, error.status || 500, { error: error.message, code: error.code });
    }
});

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`\n  Port ${PORT} is already in use.`);
        console.error(`  Most likely this server is already running in another terminal.\n`);
        console.error(`  Find it:   lsof -nP -iTCP:${PORT} -sTCP:LISTEN`);
        console.error(`  Stop it:   pkill -f "server/app.js"`);
        console.error(`  Or use a different port:   PORT=3001 node server/app.js\n`);
        process.exit(1);
    }
    throw error;
});

if (!PROLIFIC_COMPLETION_CODE) {
    console.warn('\n  WARNING: PROLIFIC_COMPLETION_CODE is not set. Participants who finish');
    console.warn('  cannot be sent back to Prolific. Start with PROLIFIC_COMPLETION_CODE=<code>.\n');
}

server.listen(PORT, HOST, () => {
    const s = stats();
    const local = `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`;
    console.log(`\n  Experiment server running`);
    console.log(`  game      ${local}${BASE_PATH}/index.html`);
    console.log(`  health    ${local}${BASE_PATH}/api/health`);
    console.log(`  export    ${local}${BASE_PATH}/api/export/rounds.csv`);
    if (BASE_PATH) console.log(`  mounted   under ${BASE_PATH} (public URL ends /${BASE_PATH.replace(/^\//, '')}/index.html)`);
    console.log(`  database  ${DB_PATH}`);
    console.log(`  so far    ${s.participants} participants, ${s.rounds} rounds, ${s.surveys} surveys\n`);
});
