/**
 * Keyboard shortcuts for power users.
 *
 *   N  = Next puzzle / Skip
 *   Z  = Undo
 *   R  = Retry
 *   F  = Flip board
 *  Esc = Deselect / cancel promotion
 */
import { S } from './state.js';
import { renderBoard } from './board.js';
import { cancelPromotion } from './promotion.js';
import { toggleMute } from './sounds.js';

let actions = {};

export function initKeyboard(fns) {
    actions = fns; // { fetchPuzzle, skipPuzzle, retryPuzzle, undoMove }
    document.addEventListener('keydown', onKey);
}

function onKey(e) {
    // Don't intercept when typing in inputs
    if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const key = e.key.toLowerCase();

    if (key === 'escape') {
        if (S.pendingPromotion) { cancelPromotion(); return; }
        if (S.selectedSquare) { S.selectedSquare = null; renderBoard(); }
        return;
    }

    if (key === 'n') {
        e.preventDefault();
        if (S.puzzleSolved) actions.fetchPuzzle?.();
        else actions.skipPuzzle?.();
        return;
    }

    if (key === 'z') {
        e.preventDefault();
        actions.undoMove?.();
        return;
    }

    if (key === 'r') {
        e.preventDefault();
        actions.retryPuzzle?.();
        return;
    }

    if (key === 'f') {
        e.preventDefault();
        S.boardFlipped = !S.boardFlipped;
        renderBoard();
        return;
    }

    if (key === 'm') {
        e.preventDefault();
        toggleMute();
        return;
    }
}
