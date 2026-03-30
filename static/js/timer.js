import { S } from './state.js';
import { formatTime } from './utils.js';

const timerEl = document.getElementById('timer');

export function startTimer() {
    S.puzzleStartTime = Date.now();
    clearInterval(S.timerInterval);
    S.timerInterval = setInterval(() => {
        timerEl.textContent = formatTime(getElapsed());
    }, 100);
    timerEl.textContent = '0.0s';
}

export function stopTimer() {
    clearInterval(S.timerInterval);
    S.timerInterval = null;
}

export function getElapsed() {
    return (Date.now() - S.puzzleStartTime) / 1000;
}

export function clearTimerDisplay() {
    timerEl.textContent = '';
}
