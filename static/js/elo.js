import { S } from './state.js';

const eloValueEl    = document.getElementById('elo-value');
const eloDeltaEl    = document.getElementById('elo-delta');
const gamesPlayedEl = document.getElementById('games-played');
const winRateEl     = document.getElementById('win-rate');
const streakBadge   = document.getElementById('streak-badge');

// ---- Math (also computed server-side, kept here for optimistic UI) ----

export function expectedScore(pR, qR) {
    return 1 / (1 + Math.pow(10, (qR - pR) / 400));
}

export function getK() {
    if (S.gamesPlayed < 20) return 40;
    if (S.gamesPlayed < 50) return 32;
    return 20;
}

export function computeScore(solved, hadErrors, seconds) {
    if (!solved) return 0;
    if (hadErrors) return 0.3;
    const t = 1 / (1 + Math.exp(0.08 * (seconds - 30)));
    return 0.5 + 0.5 * t;
}

// ---- Server persistence ----

export async function loadPlayerStateFromServer() {
    const res = await fetch(`/api/user/${S.userId}`);
    const d = await res.json();
    S.playerElo     = d.elo;
    S.gamesPlayed   = d.games_played;
    S.puzzlesSolved = d.puzzles_solved;
    S.puzzlesFailed = d.puzzles_failed;
    S.currentStreak = d.current_streak;
    S.userName      = d.name;
}

export async function submitResult(data) {
    const res = await fetch(`/api/user/${S.userId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return res.json();
}

// ---- Display ----

export function updateEloDisplay() {
    if (!eloValueEl) return;
    eloValueEl.textContent = Math.round(S.playerElo);
    if (gamesPlayedEl) gamesPlayedEl.textContent = S.gamesPlayed;
    if (winRateEl) winRateEl.textContent = S.gamesPlayed > 0
        ? Math.round(100 * S.puzzlesSolved / S.gamesPlayed) : 0;
    updateStreakBadge();
}

export function animateElo(from, to) {
    if (!eloValueEl) return;
    const duration = 500;
    const start = performance.now();
    const diff = to - from;
    const dir = diff >= 0 ? 'counting-up' : 'counting-down';
    eloValueEl.classList.add(dir);

    function step(now) {
        const t = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        eloValueEl.textContent = Math.round(from + diff * eased);
        if (t < 1) requestAnimationFrame(step);
        else eloValueEl.classList.remove('counting-up', 'counting-down');
    }
    requestAnimationFrame(step);
}

export function showEloDelta(delta) {
    if (!eloDeltaEl) return;
    const r = Math.round(delta);
    eloDeltaEl.textContent = (r >= 0 ? '+' : '') + r;
    eloDeltaEl.className = r >= 0 ? 'elo-up' : 'elo-down';
    clearTimeout(eloDeltaEl._t);
    eloDeltaEl._t = setTimeout(() => { eloDeltaEl.className = 'elo-fade'; }, 2500);
}

function updateStreakBadge() {
    if (!streakBadge) return;
    if (S.currentStreak >= 2) {
        streakBadge.textContent = S.currentStreak + ' streak';
        streakBadge.classList.add('visible');
    } else {
        streakBadge.classList.remove('visible');
    }
}
