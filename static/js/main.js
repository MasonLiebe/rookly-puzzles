/**
 * Entry point -- boots the app with server-side user state.
 */
import { S } from './state.js';
import { setStatus } from './utils.js';
import { loadPlayerStateFromServer, updateEloDisplay } from './elo.js';
import { loadHistory } from './history.js';
import { stopTimer, clearTimerDisplay } from './timer.js';
import { initDrag } from './drag.js';
import { initPromotion } from './promotion.js';
import { startPuzzle, retryPuzzle, skipPuzzle, undoMove, setFetchPuzzle } from './puzzle.js';
import { initKeyboard } from './keyboard.js';
import { toggleMute } from './sounds.js';

const ratingFilter = document.getElementById('rating-filter');
const themeFilter  = document.getElementById('theme-filter');
const muteBtn      = document.getElementById('mute-btn');
const userNameEl   = document.getElementById('nav-player');

// ---- Read user ID from page ----
S.userId = parseInt(document.body.dataset.userId);
if (!S.userId) {
    window.location = '/';
}

// ---- API ----

async function fetchPuzzle() {
    setStatus('Loading puzzle\u2026', 'info');
    stopTimer();
    clearTimerDisplay();
    const [min, max] = getRatingRange();
    const theme = themeFilter?.value || '';
    let url = `/api/puzzle/random?min_rating=${min}&max_rating=${max}`;
    if (theme) url += `&theme=${encodeURIComponent(theme)}`;
    let data;
    try {
        const res = await fetch(url);
        data = await res.json();
        if (data.error) { setStatus(data.error, 'error'); return; }
    } catch (err) {
        setStatus('Failed to load puzzle: ' + err.message, 'error');
        return;
    }
    try { startPuzzle(data); }
    catch (err) { setStatus('Error: ' + err.message, 'error'); }
}

function getRatingRange() {
    const v = ratingFilter.value;
    if (v === 'all') return [0, 9999];
    if (v === 'adaptive') {
        const r = Math.round(S.playerElo);
        return [Math.max(0, r - 300), r + 300];
    }
    return v.split('-').map(Number);
}

// ---- Boot ----

setFetchPuzzle(fetchPuzzle);

// Load user state from server
await loadPlayerStateFromServer();
if (userNameEl) userNameEl.textContent = S.userName;
updateEloDisplay();

// Load recent history from server
await loadHistory();

initDrag();
initPromotion();
initKeyboard({ fetchPuzzle, skipPuzzle, retryPuzzle, undoMove });

document.getElementById('undo-btn').addEventListener('click', undoMove);
document.getElementById('skip-btn').addEventListener('click', skipPuzzle);
document.getElementById('next-btn').addEventListener('click', () => fetchPuzzle());
document.getElementById('retry-btn').addEventListener('click', retryPuzzle);
if (muteBtn) muteBtn.addEventListener('click', toggleMute);

fetchPuzzle();
