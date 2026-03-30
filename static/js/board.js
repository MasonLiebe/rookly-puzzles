import { S } from './state.js';
import { pieceImg } from './utils.js';

const boardEl = document.getElementById('board');

export { boardEl };

export function renderBoard() {
    boardEl.innerHTML = '';
    const validTargets = S.selectedSquare
        ? S.game.moves({ square: S.selectedSquare, verbose: true }).map(m => m.to)
        : [];
    const checkSq = S.game.in_check() ? findKing(S.game.turn()) : null;

    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const rank = S.boardFlipped ? row + 1 : 8 - row;
            const file = S.boardFlipped ? 7 - col : col;
            const sq   = 'abcdefgh'[file] + rank;

            const cell = document.createElement('div');
            cell.className = 'square';
            cell.dataset.square = sq;
            cell.classList.add((file + rank) % 2 === 0 ? 'light' : 'dark');

            if (sq === S.lastMoveFrom || sq === S.lastMoveTo) cell.classList.add('last-move');
            if (sq === S.selectedSquare)                       cell.classList.add('selected');
            if (sq === checkSq)                                cell.classList.add('in-check');
            if (validTargets.includes(sq)) {
                cell.classList.add('valid-target');
                if (S.game.get(sq)) cell.classList.add('capture-target');
            }

            const piece = S.game.get(sq);
            if (piece) {
                const img = document.createElement('img');
                img.className = 'piece';
                img.src = pieceImg(piece.color, piece.type);
                img.draggable = false;
                cell.appendChild(img);
            }

            if (col === 0) {
                const r = document.createElement('span');
                r.className = 'coord coord-rank';
                r.textContent = rank;
                cell.appendChild(r);
            }
            if (row === 7) {
                const f = document.createElement('span');
                f.className = 'coord coord-file';
                f.textContent = 'abcdefgh'[file];
                cell.appendChild(f);
            }

            boardEl.appendChild(cell);
        }
    }
}

export function findKing(color) {
    for (const f of 'abcdefgh')
        for (let r = 1; r <= 8; r++) {
            const sq = f + r, p = S.game.get(sq);
            if (p && p.type === 'k' && p.color === color) return sq;
        }
    return null;
}
