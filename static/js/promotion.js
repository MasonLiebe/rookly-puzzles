import { S } from './state.js';
import { pieceImg } from './utils.js';

const promoOverlay = document.getElementById('promotion-overlay');
const promoPicker  = document.getElementById('promotion-picker');

/** Wire the backdrop click to cancel. Call once at boot. */
export function initPromotion() {
    promoOverlay.addEventListener('click', e => {
        if (e.target === promoOverlay) cancelPromotion();
    });
}

/**
 * Show the promotion picker. `onChoose(type)` is called with the chosen piece letter.
 */
export function showPromotionPicker(from, to, onChoose) {
    S.pendingPromotion = { from, to };
    promoPicker.innerHTML = '';
    for (const type of ['q', 'r', 'b', 'n']) {
        const el  = document.createElement('div');
        el.className = 'promo-piece';
        const img = document.createElement('img');
        img.src = pieceImg(S.playerColor, type);
        img.draggable = false;
        el.appendChild(img);
        el.addEventListener('click', () => {
            promoOverlay.classList.add('hidden');
            S.pendingPromotion = null;
            onChoose(type);
        });
        promoPicker.appendChild(el);
    }
    promoOverlay.classList.remove('hidden');
}

export function cancelPromotion() {
    S.pendingPromotion = null;
    promoOverlay.classList.add('hidden');
}
