import { S } from './state.js';
import { DRAG_THRESHOLD } from './config.js';
import { pieceImg } from './utils.js';
import { renderBoard, boardEl } from './board.js';
import { makePlayerMove, isPromo } from './puzzle.js';
import { showPromotionPicker } from './promotion.js';

/**
 * Initialise drag-and-drop + click-to-move via event delegation on the board.
 * Call once at boot.
 */
export function initDrag() {
    boardEl.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup',   onPointerUp);
}

// ---------------------------------------------------------------------------

function onPointerDown(e) {
    const cell = e.target.closest('[data-square]');
    if (!cell) return;
    const sq = cell.dataset.square;

    if (S.puzzleSolved || S.pendingPromotion) return;
    if (S.game.turn() !== S.playerColor) return;

    const piece = S.game.get(sq);

    // Click-to-move: complete a pending move
    if (S.selectedSquare && S.selectedSquare !== sq) {
        const moves = S.game.moves({ square: S.selectedSquare, verbose: true });
        if (moves.find(m => m.to === sq)) {
            if (isPromo(S.selectedSquare, sq)) {
                showPromotionPicker(S.selectedSquare, sq, type => makePlayerMove(S.selectedSquare, sq, type));
            } else {
                makePlayerMove(S.selectedSquare, sq);
            }
            return;
        }
    }

    if (!piece || piece.color !== S.playerColor) {
        if (S.selectedSquare) { S.selectedSquare = null; renderBoard(); }
        return;
    }

    e.preventDefault();
    S.selectedSquare = sq;
    renderBoard();

    S.dragState = {
        from: sq,
        startX: e.clientX,
        startY: e.clientY,
        ghost: null,
        isDragging: false,
    };
}

function onPointerMove(e) {
    const ds = S.dragState;
    if (!ds) return;
    const dx = e.clientX - ds.startX;
    const dy = e.clientY - ds.startY;

    if (!ds.isDragging) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        ds.isDragging = true;
        const piece = S.game.get(ds.from);
        if (!piece) { S.dragState = null; return; }

        const sz = boardEl.offsetWidth / 8;
        const ghost = document.createElement('img');
        ghost.src = pieceImg(piece.color, piece.type);
        ghost.className = 'drag-ghost';
        ghost.style.width  = (sz * 0.9) + 'px';
        ghost.style.height = (sz * 0.9) + 'px';
        document.body.appendChild(ghost);
        ds.ghost = ghost;
        ds.off   = sz * 0.45;

        const orig = boardEl.querySelector(`[data-square="${ds.from}"] .piece`);
        if (orig) orig.style.opacity = '0.2';
    }

    if (ds.ghost) {
        ds.ghost.style.left = (e.clientX - ds.off) + 'px';
        ds.ghost.style.top  = (e.clientY - ds.off) + 'px';
    }
}

function onPointerUp(e) {
    const ds = S.dragState;
    if (!ds) return;

    if (ds.isDragging) {
        if (ds.ghost) ds.ghost.remove();
        const sq = squareFromPoint(e.clientX, e.clientY);
        if (sq && sq !== ds.from) {
            const moves = S.game.moves({ square: ds.from, verbose: true });
            if (moves.find(m => m.to === sq)) {
                if (isPromo(ds.from, sq)) {
                    showPromotionPicker(ds.from, sq, type => makePlayerMove(ds.from, sq, type));
                } else {
                    makePlayerMove(ds.from, sq);
                }
            } else { renderBoard(); }
        } else { renderBoard(); }
    }
    S.dragState = null;
}

function squareFromPoint(x, y) {
    for (const el of document.elementsFromPoint(x, y))
        if (el.dataset?.square) return el.dataset.square;
    return null;
}
