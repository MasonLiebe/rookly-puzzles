/**
 * Sound effects via Web Audio API synthesis -- zero external assets.
 */

let ctx = null;
let muted = JSON.parse(localStorage.getItem('rookly_muted') || 'false');

const muteBtn = document.getElementById('mute-btn');
if (muteBtn) syncMuteUI();

function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
}

function tone(freq, dur, vol = 0.13, type = 'sine', delay = 0) {
    if (muted) return;
    const c = getCtx();
    const t = c.currentTime + delay;
    const osc  = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t);
    osc.stop(t + dur);
}

// Short woody click
export function playMove() {
    tone(800, 0.035, 0.10);
    tone(400, 0.025, 0.06, 'triangle');
}

// Heavier click for captures
export function playCapture() {
    tone(300, 0.06, 0.16, 'triangle');
    tone(600, 0.04, 0.10);
}

// Two ascending notes
export function playCorrect() {
    tone(523, 0.09, 0.10);           // C5
    tone(659, 0.09, 0.10, 'sine', 0.08); // E5
}

// Low descending buzz
export function playWrong() {
    const c = getCtx();
    if (muted) return;
    const osc  = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(260, c.currentTime);
    osc.frequency.exponentialRampToValueAtTime(160, c.currentTime + 0.2);
    gain.gain.setValueAtTime(0.16, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + 0.25);
}

// Triumphant ascending arpeggio
export function playComplete() {
    tone(523, 0.12, 0.11);              // C5
    tone(659, 0.12, 0.11, 'sine', 0.1); // E5
    tone(784, 0.18, 0.11, 'sine', 0.2); // G5
}

// ---- Mute toggle ----

export function toggleMute() {
    muted = !muted;
    localStorage.setItem('rookly_muted', JSON.stringify(muted));
    syncMuteUI();
}

export function isMuted() { return muted; }

function syncMuteUI() {
    if (!muteBtn) return;
    muteBtn.textContent = muted ? 'Sound Off' : 'Sound On';
    muteBtn.classList.toggle('muted', muted);
}
