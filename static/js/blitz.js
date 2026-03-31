/**
 * Blitz Drill: 60-second sprint. Solve as many puzzles as you can.
 * Wrong move = skip (no penalty, just lost time). Score = correct count.
 */
import { S } from './state.js';
import { setStatus } from './utils.js';
import { initDrag } from './drag.js';
import { initPromotion } from './promotion.js';
import { startPuzzle, setFetchPuzzle, setOnComplete, setOnWrongMove } from './puzzle.js';
import { playComplete, playWrong } from './sounds.js';
import { flashBoard, shakeBoard } from './animations.js';

const DRILL_DURATION = 60; // seconds

const DRILLS = {
    mateIn1:   { theme: 'mateIn1',       label: 'Mate in 1' },
    fork:      { theme: 'fork',           label: 'Forks' },
    pin:       { theme: 'pin',            label: 'Pins' },
    hanging:   { theme: 'hangingPiece',   label: 'Hanging Pieces' },
    back_rank: { theme: 'backRankMate',   label: 'Back Rank Mates' },
    mixed:     { theme: '',               label: 'Mixed Tactics' },
};

// ---- DOM ----
const stepPick    = document.getElementById('step-pick');
const stepDrill   = document.getElementById('step-drill');
const drillGrid   = document.getElementById('drill-grid');
const scoreEl     = document.getElementById('blitz-score');
const timerEl     = document.getElementById('blitz-timer');
const drillNameEl = document.getElementById('blitz-drill-name');
const ratingEl    = document.getElementById('rating');
const resultsEl   = document.getElementById('blitz-results');
const resultsCard = document.getElementById('results-card');
const overlayEl   = document.getElementById('board-overlay');
const overlayIcon = overlayEl.querySelector('.overlay-icon');
const countdownOverlay = document.getElementById('countdown-overlay');
const countdownNum     = document.getElementById('countdown-num');
const playerNameEl     = document.getElementById('nav-player');

// ---- State ----
const userId = parseInt(document.body.dataset.userId);
S.userId = userId;

let currentDrill = null;
let score = 0;
let drillActive = false;
let drillStartTime = 0;
let timerInterval = null;

// ---- Boot ----
async function boot() {
    const user = await (await fetch(`/api/user/${userId}`)).json();
    if (playerNameEl) playerNameEl.textContent = user.name;

    initDrag();
    initPromotion();
    setFetchPuzzle(null);
    setOnComplete(onSolved);
    setOnWrongMove(onFailed);

    // Fetch leaderboards then render drill picker
    const lbData = await (await fetch('/api/blitz/leaderboards')).json();

    for (const [key, drill] of Object.entries(DRILLS)) {
        const card = document.createElement('div');
        card.className = 'drill-card';

        let lbHtml = '';
        const scores = lbData[key];
        if (scores && scores.length > 0) {
            lbHtml = '<div class="drill-lb">';
            for (let i = 0; i < Math.min(scores.length, 3); i++) {
                const s = scores[i];
                const me = s.user_id === userId ? ' me' : '';
                lbHtml += `<div class="drill-lb-row${me}">
                    <span class="lb-pos">${i + 1}.</span>
                    <span class="lb-name">${s.name}</span>
                    <span class="lb-score">${s.best}</span>
                </div>`;
            }
            lbHtml += '</div>';
        } else {
            lbHtml = '<div class="drill-lb-empty">No scores yet</div>';
        }

        card.innerHTML = `${drill.label}<div class="drill-sub">60 seconds</div>${lbHtml}`;
        card.onclick = () => startDrill(key);
        drillGrid.appendChild(card);
    }
}

// ---- Countdown ----
function showCountdown() {
    return new Promise(resolve => {
        countdownOverlay.classList.remove('hidden');
        let n = 3;
        countdownNum.textContent = n;
        const iv = setInterval(() => {
            n--;
            if (n <= 0) {
                clearInterval(iv);
                countdownOverlay.classList.add('hidden');
                resolve();
            } else {
                countdownNum.textContent = n;
                countdownNum.style.animation = 'none';
                void countdownNum.offsetHeight;
                countdownNum.style.animation = '';
            }
        }, 700);
    });
}

// ---- Drill lifecycle ----
async function startDrill(key) {
    currentDrill = key;
    score = 0;
    drillActive = false;

    stepPick.classList.add('hidden');
    stepDrill.classList.remove('hidden');
    drillNameEl.textContent = DRILLS[key].label;
    scoreEl.textContent = '0';
    timerEl.textContent = DRILL_DURATION;
    timerEl.classList.remove('urgent');

    await showCountdown();

    drillActive = true;
    drillStartTime = Date.now();
    timerInterval = setInterval(updateTimer, 100);

    await loadNextPuzzle();
}

function updateTimer() {
    const elapsed = (Date.now() - drillStartTime) / 1000;
    const remaining = Math.max(0, DRILL_DURATION - elapsed);
    const sec = Math.ceil(remaining);
    timerEl.textContent = sec;
    timerEl.classList.toggle('urgent', remaining < 10);

    if (remaining <= 0) {
        endDrill();
    }
}

async function loadNextPuzzle() {
    if (!drillActive) return;
    const theme = DRILLS[currentDrill].theme;
    const url = `/api/blitz/puzzle` + (theme ? `?theme=${theme}` : '');
    const data = await (await fetch(url)).json();
    if (!drillActive) return; // might have ended during fetch
    if (ratingEl) ratingEl.textContent = data.rating;
    setStatus('Solve it!', 'info');
    startPuzzle(data);
}

// ---- Callbacks ----
async function onSolved() {
    if (!drillActive) return;
    score++;
    playComplete();
    bumpScore();
    showOverlay('correct');
    flashBoard('glow-green');

    setTimeout(async () => {
        hideOverlay();
        if (drillActive) await loadNextPuzzle();
    }, 300);
}

async function onFailed() {
    if (!drillActive) return;
    shakeBoard();
    showOverlay('wrong');

    setTimeout(async () => {
        hideOverlay();
        if (drillActive) await loadNextPuzzle();
    }, 400);
}

// ---- UI helpers ----
function showOverlay(type) {
    overlayEl.className = 'show ' + type;
    overlayIcon.textContent = type === 'correct' ? '\u2713' : '\u2717';
}
function hideOverlay() { overlayEl.className = ''; }

function bumpScore() {
    scoreEl.textContent = score;
    scoreEl.classList.remove('score-bump');
    void scoreEl.offsetHeight;
    scoreEl.classList.add('score-bump');
}

// ---- End drill ----
async function endDrill() {
    if (!drillActive) return;
    drillActive = false;
    clearInterval(timerInterval);
    timerEl.textContent = '0';

    // Submit score
    await fetch('/api/blitz/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, drill: currentDrill, score }),
    });

    // Fetch leaderboard
    const lb = await (await fetch(`/api/blitz/leaderboard?drill=${currentDrill}`)).json();
    const myBest = lb.find(r => r.user_id === userId);
    const isNewBest = myBest && myBest.best === score && (myBest.attempts === 1 || score > 0);

    let html = `<h2>Time's Up!</h2>`;
    html += `<div class="results-big">${score}</div>`;
    html += `<div class="results-sub">puzzles solved in 60 seconds</div>`;
    if (isNewBest && score > 0) {
        html += `<div class="results-new-best">New personal best!</div>`;
    }

    html += `<div style="font-size:0.75rem; color:var(--text-3); margin-bottom:0.4rem; text-transform:uppercase; letter-spacing:0.04em; font-weight:600;">${DRILLS[currentDrill].label} Leaderboard</div>`;
    html += `<div class="lb-table">`;
    for (let i = 0; i < lb.length; i++) {
        const r = lb[i];
        const me = r.user_id === userId ? ' me' : '';
        html += `<div class="lb-row${me}">
            <span class="lb-rank">#${i + 1}</span>
            <span class="lb-name">${r.name}</span>
            <span class="lb-score">${r.best}</span>
        </div>`;
    }
    if (lb.length === 0) {
        html += `<div class="lb-row"><span class="lb-name" style="color:var(--text-3)">No scores yet</span></div>`;
    }
    html += `</div>`;

    html += `<div class="results-btns">`;
    html += `<button class="btn-primary" onclick="location.reload()">Try Again</button>`;
    html += `<a href="/play/${userId}" class="btn-secondary">Puzzles</a>`;
    html += `</div>`;

    resultsCard.innerHTML = html;
    resultsEl.classList.remove('hidden');
}

boot();
