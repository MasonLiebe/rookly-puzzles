import { PIECE_PATH } from './config.js';

const statusEl = document.getElementById('status');

export function pieceImg(color, type) {
    return PIECE_PATH + color + type.toUpperCase() + '.svg';
}

export function formatTime(s) {
    if (s < 60) return s.toFixed(1) + 's';
    return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
}

export function setStatus(msg, type) {
    statusEl.textContent = msg;
    statusEl.className = 'status-' + type;
    statusEl.style.animation = 'none';
    void statusEl.offsetHeight;
    statusEl.style.animation = '';
}
