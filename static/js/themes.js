/**
 * Per-theme accuracy tracking, persisted in localStorage.
 */

const THEME_STATS_KEY = 'rookly_theme_stats';

let stats = {};

export function loadThemeStats() {
    try { stats = JSON.parse(localStorage.getItem(THEME_STATS_KEY)) || {}; }
    catch { stats = {}; }
}

function saveThemeStats() {
    localStorage.setItem(THEME_STATS_KEY, JSON.stringify(stats));
}

/**
 * Update stats for each theme in the puzzle.
 * @param {string} themesStr  Space-separated theme string from the puzzle
 * @param {string} result     'solved' | 'mistakes' | 'skipped'
 */
export function updateThemeStats(themesStr, result) {
    if (!themesStr) return;
    const solved = result === 'solved';
    for (const theme of themesStr.split(' ')) {
        if (!theme) continue;
        if (!stats[theme]) stats[theme] = { correct: 0, total: 0 };
        stats[theme].total++;
        if (solved) stats[theme].correct++;
    }
    saveThemeStats();
}

export function getThemeStats() { return stats; }
