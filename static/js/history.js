import { S } from './state.js';
import { formatTime } from './utils.js';

const historyEl = document.getElementById('history-entries');

export async function loadHistory() {
    if (!historyEl) return;
    try {
        const rows = await (await fetch(`/api/user/${S.userId}/history?limit=50`)).json();
        S.puzzleHistory = rows.map(r => ({
            result: r.result,
            rating: r.puzzle_rating,
            time: formatTime(r.time_secs),
            delta: r.elo_delta,
        }));
    } catch {
        S.puzzleHistory = [];
    }
    renderHistory();
}

/** Optimistic add -- push to local array and re-render immediately. */
export function addHistoryEntry(result, rating, time, delta) {
    S.puzzleHistory.unshift({ result, rating, time, delta });
    renderHistory();
}

function renderHistory() {
    historyEl.innerHTML = '';
    for (const e of S.puzzleHistory) {
        const el = document.createElement('div');
        el.className = 'hist-entry ' + e.result;
        const icon = e.result === 'solved' ? '\u2713'
                   : e.result === 'mistakes' ? '\u2731' : '\u2717';
        const dr = Math.round(e.delta);
        const s  = dr >= 0 ? '+' : '';
        const c  = dr >= 0 ? 'up' : 'down';
        el.innerHTML =
            `<span class="hist-icon">${icon}</span>` +
            `<span class="hist-rating">${e.rating}</span>` +
            `<span class="hist-time">${e.time}</span>` +
            `<span class="hist-delta ${c}">${s}${dr}</span>`;
        historyEl.appendChild(el);
    }
    historyEl.scrollLeft = 0;
}
