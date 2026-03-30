const boardEl = document.getElementById('board');

export function flashBoard(type) {
    boardEl.classList.remove('glow-green', 'glow-red', 'celebrate', 'shake');
    void boardEl.offsetHeight;
    boardEl.classList.add(type);
    setTimeout(() => boardEl.classList.remove(type), type === 'celebrate' ? 900 : 500);
}

export function shakeBoard() {
    flashBoard('shake');
}

/**
 * Slide a piece from a captured source rect to its current position.
 * Call AFTER renderBoard() -- pass the getBoundingClientRect() captured BEFORE re-render.
 */
export function animatePieceSlide(toSq, fromRect, duration) {
    if (!fromRect) return;
    const toCell = boardEl.querySelector(`[data-square="${toSq}"]`);
    const piece  = toCell?.querySelector('.piece');
    if (!piece || !toCell) return;

    const toRect = toCell.getBoundingClientRect();
    const dx = fromRect.left - toRect.left;
    const dy = fromRect.top  - toRect.top;
    if (dx === 0 && dy === 0) return;

    piece.style.transform = `translate(${dx}px, ${dy}px)`;
    piece.style.zIndex = '10';
    void piece.offsetHeight;
    piece.style.transition = `transform ${duration}ms ease-out`;
    piece.style.transform  = 'translate(0,0)';

    piece.addEventListener('transitionend', () => {
        piece.style.transition = '';
        piece.style.transform  = '';
        piece.style.zIndex     = '';
    }, { once: true });
}
