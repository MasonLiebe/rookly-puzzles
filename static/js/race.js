/**
 * N-player race mode: infinite puzzles, 3 lives, dynamic lanes.
 * Race ends when all players lose all lives or 5-min hard cap.
 */
import { S } from './state.js';
import { setStatus } from './utils.js';
import { initDrag } from './drag.js';
import { initPromotion } from './promotion.js';
import { startPuzzle, setFetchPuzzle, setOnComplete, setOnWrongMove } from './puzzle.js';
import { playComplete, playWrong } from './sounds.js';
import { flashBoard, shakeBoard } from './animations.js';

const LIVES = 3;

// ---- DOM ----
const lanesEl    = document.getElementById('race-lanes');
const timerEl    = document.getElementById('race-timer');
const resultsEl  = document.getElementById('race-results');
const resultsCard = document.getElementById('results-card');
const ratingEl   = document.getElementById('rating');
const overlayEl  = document.getElementById('board-overlay');
const overlayIcon = overlayEl.querySelector('.overlay-icon');

// ---- State ----
const raceId = parseInt(document.body.dataset.raceId);
const userId = parseInt(document.body.dataset.userId);
S.userId = userId;

let race = null;
let puzzleIndex = 0;
let raceOver = false;
let myDead = false;
let myCorrect = 0;
let myWrong = 0;
let myTrail = [];
let startedAt = null;
let pollInterval = null;
let countdownInterval = null;

// Per-player lane refs: { [userId]: { trailEl, livesEl, scoreEl, racerEl, trail, correct, wrong } }
let lanes = {};
let myLane = null;

// ---- Boot ----
async function boot() {
    race = await (await fetch(`/api/race/${raceId}`)).json();
    if (race.started_at) startedAt = new Date(race.started_at + 'Z');

    // Build lanes: current user first, then others by slot
    const players = race.players || [];
    const me = players.find(p => p.user_id === userId);
    const others = players.filter(p => p.user_id !== userId).sort((a, b) => a.slot - b.slot);
    const ordered = me ? [me, ...others] : others;

    for (const p of ordered) {
        const lane = createLane(p);
        lanes[p.user_id] = lane;
        if (p.user_id === userId) myLane = lane;
    }

    setFetchPuzzle(null);
    setOnComplete(onSolved);
    setOnWrongMove(onFailed);

    initDrag();
    initPromotion();

    pollInterval = setInterval(pollRace, 500);
    const timeLimit = race.time_limit_secs || 0;
    if (timeLimit > 0 && startedAt) {
        countdownInterval = setInterval(updateCountdown, 200);
        updateCountdown();
    } else {
        timerEl.textContent = '';
    }

    await loadPuzzle(0);
}

// ---- Lane creation ----
function createLane(player) {
    const lane = document.createElement('div');
    lane.className = 'race-lane';

    const info = document.createElement('div');
    info.className = 'lane-info';
    const nameEl = document.createElement('span');
    nameEl.className = 'lane-name';
    nameEl.textContent = player.name;
    const livesEl = document.createElement('div');
    livesEl.className = 'lane-lives';
    renderLives(livesEl, LIVES, 0);
    info.appendChild(nameEl);
    info.appendChild(livesEl);

    const track = document.createElement('div');
    track.className = 'lane-track';
    const trailEl = document.createElement('div');
    trailEl.className = 'lane-trail';
    const racerEl = document.createElement('img');
    racerEl.className = 'racer';
    racerEl.src = `/static/pieces/${player.piece}.svg`;
    track.appendChild(trailEl);
    track.appendChild(racerEl);

    const scoreEl = document.createElement('span');
    scoreEl.className = 'lane-score';
    scoreEl.textContent = '0';

    lane.appendChild(info);
    lane.appendChild(track);
    lane.appendChild(scoreEl);
    lanesEl.appendChild(lane);

    return { trailEl, livesEl, scoreEl, racerEl, trail: [], correct: 0, wrong: 0, piece: player.piece };
}

// ---- Lives ----
function renderLives(el, total, lost) {
    el.innerHTML = '';
    for (let i = 0; i < total; i++) {
        const dot = document.createElement('div');
        dot.className = 'life' + (i >= total - lost ? ' lost' : '');
        el.appendChild(dot);
    }
}

// ---- Trail rendering ----
function renderTrail(laneObj, isNew) {
    const el = laneObj.trailEl;
    el.innerHTML = '';
    laneObj.trail.forEach((r, i) => {
        const m = document.createElement('div');
        m.className = 'marker ' + (r === 'solved' ? 'solved' : 'wrong');
        if (isNew && i === laneObj.trail.length - 1) m.classList.add('new');
        el.appendChild(m);
    });
    el.parentElement.scrollLeft = el.parentElement.scrollWidth;
}

function bounceRacer(laneObj) {
    laneObj.racerEl.classList.remove('advancing');
    void laneObj.racerEl.offsetHeight;
    laneObj.racerEl.classList.add('advancing');
}

// ---- Board overlay ----
function showOverlay(type) {
    overlayEl.className = 'show ' + type;
    overlayIcon.textContent = type === 'correct' ? '\u2713' : '\u2717';
}
function hideOverlay() { overlayEl.className = ''; }

// ---- Puzzle flow ----
async function loadPuzzle(index) {
    if (raceOver || myDead) return;
    puzzleIndex = index;
    if (ratingEl) ratingEl.textContent = '---';
    setStatus(`Puzzle ${myCorrect + myWrong + 1}`, 'info');
    const res = await fetch(`/api/race/${raceId}/puzzle/${index}`);
    const data = await res.json();
    if (data.error) { setStatus(data.error, 'error'); return; }
    if (ratingEl) ratingEl.textContent = data.rating;
    startPuzzle(data);
}

async function onSolved({ time_secs }) {
    if (raceOver || myDead) return;
    playComplete();
    showOverlay('correct');
    flashBoard('glow-green');

    myTrail.push('solved');
    myLane.trail = myTrail;
    renderTrail(myLane, true);
    bounceRacer(myLane);

    const resp = await recordResult('solved', time_secs);
    myCorrect = resp.correct;
    myLane.correct = myCorrect;
    myLane.scoreEl.textContent = myCorrect;

    if (resp.finished) {
        setTimeout(() => { hideOverlay(); finishRace(resp.winner_id); }, 500);
        return;
    }
    setTimeout(async () => { hideOverlay(); await loadPuzzle(puzzleIndex + 1); }, 500);
}

async function onFailed({ time_secs }) {
    if (raceOver || myDead) return;
    shakeBoard();
    showOverlay('wrong');

    myTrail.push('mistakes');
    myLane.trail = myTrail;
    renderTrail(myLane, true);
    bounceRacer(myLane);

    const resp = await recordResult('mistakes', time_secs);
    myCorrect = resp.correct;
    myWrong = resp.wrong;
    myLane.correct = myCorrect;
    myLane.wrong = myWrong;
    myLane.scoreEl.textContent = myCorrect;
    renderLives(myLane.livesEl, LIVES, myWrong);

    if (resp.finished) {
        setTimeout(() => { hideOverlay(); finishRace(resp.winner_id); }, 600);
        return;
    }
    if (myWrong >= LIVES) {
        myDead = true;
        setTimeout(() => { hideOverlay(); setStatus('Out of lives! Waiting for others\u2026', 'error'); }, 600);
        return;
    }
    setTimeout(async () => { hideOverlay(); await loadPuzzle(puzzleIndex + 1); }, 600);
}

async function recordResult(result, time_secs) {
    return (await fetch(`/api/race/${raceId}/complete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player_id: userId, puzzle_index: puzzleIndex,
            puzzle_id: S.currentPuzzle.id, result, time_secs }),
    })).json();
}

// ---- Polling ----
async function pollRace() {
    if (raceOver) return;
    try {
        const data = await (await fetch(`/api/race/${raceId}`)).json();

        // Update all other players' lanes
        for (const p of (data.players || [])) {
            if (p.user_id === userId) continue;
            const lane = lanes[p.user_id];
            if (!lane) continue;
            const prog = (data.progress || {})[String(p.user_id)];
            const trail = (data.trails || {})[String(p.user_id)] || [];
            const oldLen = lane.trail.length;
            lane.trail = trail;
            if (prog) {
                lane.correct = prog.correct;
                lane.wrong = prog.wrong;
                lane.scoreEl.textContent = prog.correct;
                renderLives(lane.livesEl, LIVES, prog.wrong);
            }
            if (trail.length !== oldLen) {
                renderTrail(lane, true);
                bounceRacer(lane);
            }
        }

        if (data.status === 'finished') {
            finishRace(data.winner_id);
        }
    } catch {}
}

// ---- Countdown ----
function updateCountdown() {
    if (!startedAt || !race.time_limit_secs) return;
    const remaining = Math.max(0, race.time_limit_secs - (Date.now() - startedAt.getTime()) / 1000);
    const min = Math.floor(remaining / 60);
    const sec = Math.floor(remaining % 60);
    timerEl.textContent = `${min}:${String(sec).padStart(2, '0')}`;
    timerEl.classList.toggle('urgent', remaining < 30);
}

// ---- Finish ----
function finishRace(winnerId) {
    if (raceOver) return;
    raceOver = true;
    clearInterval(pollInterval);
    clearInterval(countdownInterval);
    hideOverlay();
    fetch(`/api/race/${raceId}`).then(r => r.json()).then(data => showResults(winnerId, data));
}

function showResults(winnerId, data) {
    const progress = data.progress || {};
    const trails = data.trails || {};
    const players = (data.players || []).slice();

    // Sort by ranking: most correct, then least time
    players.sort((a, b) => {
        const ap = progress[String(a.user_id)] || { correct: 0, total_time: 0 };
        const bp = progress[String(b.user_id)] || { correct: 0, total_time: 0 };
        if (bp.correct !== ap.correct) return bp.correct - ap.correct;
        return (ap.total_time || 0) - (bp.total_time || 0);
    });

    const isWinner = winnerId === userId;
    const isDraw = winnerId === null;
    const verdict = isDraw ? 'Draw' : isWinner ? 'Victory!' : 'Defeat';
    const cls = isDraw ? 'draw' : isWinner ? 'win' : 'lose';

    let html = `<div class="results-verdict ${cls}">${verdict}</div>`;

    for (let i = 0; i < players.length; i++) {
        const p = players[i];
        const prog = progress[String(p.user_id)] || { correct: 0, wrong: 0, total_time: 0 };
        const trail = trails[String(p.user_id)] || [];
        const isMe = p.user_id === userId;
        const rank = i + 1;
        const crown = (p.user_id === winnerId) ? ' (Winner)' : '';

        html += `<div style="margin-top:0.6rem; ${isMe ? 'opacity:1' : 'opacity:0.75'}">`;
        html += `<div class="results-stat"><strong>#${rank} ${p.name}${crown}</strong></div>`;
        html += `<div class="results-lane">`;
        html += `<div class="results-trail">`;
        for (const r of trail) {
            html += `<div class="marker ${r === 'solved' ? 'solved' : 'wrong'}"></div>`;
        }
        html += `</div><img class="racer" src="/static/pieces/${p.piece}.svg"></div>`;
        html += `<div class="results-stat"><span class="val">${prog.correct} correct</span>, <span class="val">${prog.wrong} mistakes</span> &middot; <span class="val">${(prog.total_time||0).toFixed(1)}s</span></div>`;
        html += `</div>`;
    }

    const tl = race.time_limit_secs;
    const timeRule = tl > 0 ? (tl / 60) + ' min limit' : 'No time limit';
    html += `<div class="results-rule">3 lives &middot; ${timeRule} &middot; Most correct wins</div>`;
    html += `<div class="results-btns"><a href="/race?user=${userId}" class="btn-primary">Race Again</a><a href="/play/${userId}" class="btn-secondary">Puzzles</a></div>`;

    resultsCard.innerHTML = html;
    resultsEl.classList.remove('hidden');
}

boot();
