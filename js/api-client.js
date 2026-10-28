// Talks to the local experiment server (server/app.js).
//
// Loaded as a plain script (not a module) so the non-module pages can use it
// too; everything hangs off window.ExperimentAPI.
//
// Event logging remains best effort. Assignment loading must succeed before
// gameplay: never replace an unavailable assignment with a new random draw.

(function () {
    'use strict';

    // The sub-path this app is mounted under, worked out from the page's own URL.
    // Locally that is '' (pages sit at /index.html and /html/*.html). On the lab
    // server the proxy mounts us under /<name>, so the same pages are at
    // /<name>/index.html and /<name>/html/*.html and this returns '/<name>'.
    function basePrefix() {
        try {
            var path = window.location.pathname;
            var i = path.indexOf('/html/');
            if (i !== -1) return path.slice(0, i);   // /<name>/html/foo.html -> /<name>
            return path.replace(/\/[^/]*$/, '');     // /<name>/index.html    -> /<name>
        } catch (error) {
            return '';
        }
    }

    // Where the API lives. Normally same origin as the page, since server/app.js
    // serves the game and the API together - including under the lab server's
    // sub-path. The one exception is VS Code Live Server on :5500, which serves
    // files only, so the API has to be addressed on :3000 directly.
    function apiBase() {
        try {
            if (window.EXPERIMENT_API_BASE) return window.EXPERIMENT_API_BASE;
            if (window.location.port === '5500') return 'http://localhost:3000';
            return window.location.origin + basePrefix();
        } catch (error) {
            return 'http://localhost:3000';
        }
    }

    var PARTICIPANT_KEY = 'experimentParticipantId';
    var cachedParticipantId;
    var identitySource;

    // The opaque participation ID travels in every study URL. sessionStorage is
    // only a convenience for legacy links; losing it must not change identity.
    // Only Game 1 may create an ID. Surveys and Game 2 must recover an existing one.
    function participantId(allowCreate = false) {
        if (cachedParticipantId) return cachedParticipantId;
        var url = new URL(window.location.href);
        var fresh = url.searchParams.get('newParticipant') === '1';
        var id = fresh ? null : url.searchParams.get('participant');
        var source = id ? 'url' : null;
        if (url.searchParams.has('participant') && !fresh && !/^p-[a-zA-Z0-9-]{1,120}$/.test(id || '')) {
            throw Error('This study link is incomplete. Please return to your original study link or contact the study team.');
        }
        try {
            if (!id && !fresh) {
                id = window.sessionStorage.getItem(PARTICIPANT_KEY);
                if (id) source = 'sessionStorage';
            }
        } catch (error) {
            console.warn('[identity] Unable to read session storage:', error.message);
        }
        if (!id) {
            if (!allowCreate) {
                throw Error('We could not find your study session. Return to the tab or saved link where you played Game 1, or contact the study team.');
            }
            id = 'p-' + window.crypto.randomUUID();
            source = 'created';
        }
        if (!/^p-[a-zA-Z0-9-]{1,120}$/.test(id)) throw Error('Invalid study session. Please contact the study team.');

        // Publish the recoverable URL before any API request or gameplay. If
        // history cannot be updated, fail instead of relying on volatile memory.
        url.searchParams.set('participant', id);
        url.searchParams.delete('newParticipant');
        window.history.replaceState(null, '', url.href);
        try {
            if (fresh || window.sessionStorage.getItem(PARTICIPANT_KEY) !== id) {
                for (var key of ['experimentCondition', 'lastGameSummary', 'gameSummary_session1', 'gameSummary_session2']) {
                    window.sessionStorage.removeItem(key);
                }
            }
            window.sessionStorage.setItem(PARTICIPANT_KEY, id);
        } catch (error) {
            console.warn('[identity] Storage unavailable; continuing with the study URL:', error.message);
        }
        cachedParticipantId = id;
        identitySource = source;
        return id;
    }

    // Landing page only. Records the Prolific IDs from the study link and makes
    // the participant ID that every later page carries. The server may hand back
    // an earlier ID for a returning Prolific participant; that ID wins.
    var studyStart = null;
    function startStudy() {
        if (studyStart) return studyStart;
        var url = new URL(window.location.href);
        var candidate = url.searchParams.get('participant');
        if (!candidate || !/^p-[a-zA-Z0-9-]{1,120}$/.test(candidate)) candidate = 'p-' + window.crypto.randomUUID();
        var prolific = {
            pid: url.searchParams.get('PROLIFIC_PID'),
            studyId: url.searchParams.get('STUDY_ID'),
            sessionId: url.searchParams.get('SESSION_ID')
        };
        studyStart = (async function () {
            var lastError;
            for (var attempt = 0; attempt < 3; attempt++) {
                try {
                    var res = await fetch(apiBase() + '/api/participant', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        signal: AbortSignal.timeout(10000),
                        body: JSON.stringify({ participantId: candidate, prolific: prolific })
                    });
                    var body = await res.json();
                    if (!res.ok) throw Error(body.error || 'HTTP ' + res.status);
                    // Adopt the server's ID as if it came in the URL.
                    cachedParticipantId = null;
                    url.searchParams.set('participant', body.participantId);
                    window.history.replaceState(null, '', url.href);
                    participantId();
                    logStudyEvent('study_start', {
                        prolific: prolific, returning: body.reused, referrer: document.referrer || null,
                        screen: { width: window.screen.width, height: window.screen.height },
                        viewport: { width: window.innerWidth, height: window.innerHeight }
                    });
                    return body;
                } catch (error) {
                    lastError = error;
                    await new Promise(function (r) { setTimeout(r, 1000 * (attempt + 1)); });
                }
            }
            studyStart = null;
            console.error('[study] start failed:', lastError);
            throw Error('We could not start your study session. Check your connection and reload this page. If this continues, contact the study team.');
        })();
        return studyStart;
    }

    // Funnel events (consent, qualification attempts). Retries once; resolves to
    // null instead of throwing so callers decide whether a loss blocks the page.
    function logStudyEvent(type, payload) {
        var body = { type: type, occurredAt: new Date().toISOString(), payload: payload || {} };
        return post('/api/study-event', body, 5000).then(function (result) {
            return result || post('/api/study-event', body, 5000);
        });
    }

    function withParticipant(href) {
        var url = new URL(href, window.location.href);
        // Never send the study ID to an external site, including Prolific.
        if (url.origin !== window.location.origin || !url.pathname.startsWith(basePrefix() + '/html/')) return href;
        if (url.searchParams.get('newParticipant') === '1') return href;
        url.searchParams.set('participant', participantId());
        return url.href;
    }

    function decorateStudyLinks() {
        document.querySelectorAll('a[href]').forEach(function (link) {
            link.href = withParticipant(link.getAttribute('href'));
        });
    }

    function showStudyError(error) {
        console.error('[study]', error);
        const show = function () {
            var old = document.getElementById('study-session-error');
            if (old) old.remove();
            var panel = document.createElement('div');
            panel.id = 'study-session-error';
            panel.setAttribute('role', 'alert');
            panel.style.cssText = 'margin:24px auto;padding:24px;max-width:760px;background:#fff3cd;color:#332701;border:1px solid #c99b25;border-radius:8px';
            var title = document.createElement('h2');
            title.textContent = 'Unable to continue the study';
            var message = document.createElement('p');
            message.textContent = error.message;
            var retry = document.createElement('button');
            retry.textContent = 'Reload page';
            retry.addEventListener('click', function () { window.location.reload(); });
            panel.append(title, message, retry);
            document.body.prepend(panel);
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show, { once: true });
        else show();
    }

    async function loadAssignment(session) {
        if (![1, 2].includes(session)) throw Error('Invalid game number. Please use your original study link.');
        var id = participantId(session === 1);
        var params = new URLSearchParams(window.location.search);
        var forced = params.get('condition');
        if (forced !== null && (!/^[1-8]$/.test(forced))) {
            throw Error('Invalid condition in this link. Please use your original study link.');
        }
        var controller = new AbortController();
        var timer = setTimeout(() => controller.abort(), 10000);
        try {
            var res = await fetch(apiBase() + '/api/assignment', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({ participantId: id, session,
                    ...(forced !== null ? { condition: Number(forced) } : {}) })
            });
            var assignment = await res.json();
            if (!res.ok) throw Object.assign(Error(assignment.error || 'Unable to retrieve your study assignment.'), { code: assignment.code });
            if (assignment.participantId !== id || !Number.isInteger(assignment.condition) ||
                assignment.condition < 1 || assignment.condition > 8 ||
                !['may-harm', 'no-harm'].includes(assignment.aiConstraint) ||
                !['self-urgency-bonus', 'team'].includes(assignment.aiObjective) ||
                !['oblivious', 'coordinating'].includes(assignment.aiAwareness) ||
                !Array.isArray(assignment.targetSizeOrder) || assignment.targetSizeOrder.length !== 2 ||
                ![5, 15].includes(assignment.targetSizeOrder[0]) ||
                assignment.targetSizeOrder[1] !== 20 - assignment.targetSizeOrder[0]) {
                throw Object.assign(Error('The saved study assignment is invalid. Please contact the study team.'), { code: 'ASSIGNMENT_INVALID' });
            }
            console.log(`[assignment] participant=${id} identity=${identitySource} source=${assignment.source} game=${session}`);
            decorateStudyLinks();
            return { ...assignment, identitySource };
        } catch (error) {
            console.error('[assignment] Load failed:', error);
            if (error.code?.startsWith('ASSIGNMENT_')) throw error;
            throw Error('We could not load your study assignment. Check your connection and reload this page. If this continues, contact the study team.');
        } finally {
            clearTimeout(timer);
        }
    }

    function post(path, payload, timeoutMs = 0) {
        var body = Object.assign({ participantId: participantId() }, payload);
        var controller = timeoutMs ? new AbortController() : null;
        var timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
        return fetch(apiBase() + path, {
            method: 'POST',
            ...(controller ? { signal: controller.signal } : {}),
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            keepalive: true          // survives the page navigating away
        }).then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
        }).catch(function (error) {
            console.warn('[api] ' + path + ' failed (data not saved):', error.message);
            return null;
        }).finally(function () { if (timer) clearTimeout(timer); });
    }

    // Each request is one small event, avoiding a whole-round screenshot payload.
    // Retry once with the same run/sequence; the server deduplicates retries.
    var pendingInteractions = new Set();
    function saveInteraction(payload) {
        var pending = post('/api/interaction', payload, 5000).then(function (result) {
            return result || post('/api/interaction', payload, 5000);
        });
        pendingInteractions.add(pending);
        pending.finally(function () { pendingInteractions.delete(pending); });
        return pending;
    }

    window.ExperimentAPI = {
        participantId: participantId,
        loadAssignment: loadAssignment,
        withParticipant: withParticipant,
        showStudyError: showStudyError,
        apiBase: apiBase,
        saveInteraction: saveInteraction,
        flushInteractions: function () { return Promise.allSettled(Array.from(pendingInteractions)); },
        saveRound: function (payload) { return post('/api/round', payload); },
        saveSurvey: function (payload) { return post('/api/survey', payload, 10000); },
        startStudy: startStudy,
        logStudyEvent: logStudyEvent
    };

    // Summary and transition links must retain the ID even when opened in a new
    // tab with no sessionStorage. Game 1 publishes its ID in loadAssignment().
    document.addEventListener('DOMContentLoaded', function () {
        if (window.location.pathname.endsWith('/game-main-exp.html')) return;
        // The landing page has no ID yet; startStudy() creates it.
        if (window.location.pathname.indexOf('/html/') === -1) return;
        try { participantId(); decorateStudyLinks(); }
        catch (error) { showStudyError(error); }
    });
})();
