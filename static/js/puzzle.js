/**
 * Puzzle lifecycle: start, skip, retry, complete, undo, and all move logic.
 * Kept in one file to avoid circular imports between moves ↔ puzzle.
 */
import { S } from './state.js';
import { SUCCESS_MSGS } from './config.js';
import { setStatus, formatTime } from './utils.js';
import { renderBoard, boardEl } from './board.js';
import { flashBoard, shakeBoard, animatePieceSlide } from './animations.js';
import { startTimer, stopTimer, getElapsed, clearTimerDisplay } from './timer.js';
import { expectedScore, getK, computeScore, submitResult, animateElo, showEloDelta, updateEloDisplay } from './elo.js';
import { addHistoryEntry } from './history.js';
import { showPromotionPicker } from './promotion.js';
import { playMove, playCapture, playWrong, playComplete } from './sounds.js';

const ratingEl       = document.getElementById('rating');
const themesEl       = document.getElementById('themes');
const moveCountEl    = document.getElementById('move-count');
const colorIndicator = document.getElementById('color-indicator');
const undoBtn        = document.getElementById('undo-btn');
const skipBtn        = document.getElementById('skip-btn');
const nextBtn        = document.getElementById('next-btn');
const retryBtn       = document.getElementById('retry-btn');

// Callbacks injected by main.js (solo) or race.js (race mode)
let _fetchPuzzle = null;
let _onComplete = null;
let _onWrongMove = null;
export function setFetchPuzzle(fn) { _fetchPuzzle = fn; }
export function setOnComplete(fn) { _onComplete = fn; }
export function setOnWrongMove(fn) { _onWrongMove = fn; }

// ---------------------------------------------------------------------------
// Puzzle lifecycle
// ---------------------------------------------------------------------------

export function startPuzzle(puzzle) {
    S.currentPuzzle = puzzle;
    S.puzzleMoves   = puzzle.moves.split(' ');
    S.moveIndex = 0;
    S.selectedSquare = null;
    S.madeError = false;
    S.puzzleSolved = false;
    S.pendingPromotion = null;
    S.lastMoveFrom = null;
    S.lastMoveTo = null;
    S.eloUpdatedForPuzzle = false;

    S.game = new Chess(puzzle.fen);
    S.playerColor  = S.game.turn() === 'w' ? 'b' : 'w';
    S.boardFlipped = S.playerColor === 'b';

    if (colorIndicator) colorIndicator.className = S.playerColor === 'w' ? 'white' : 'black';
    updatePuzzleInfo();
    renderBoard();

    if (undoBtn) undoBtn.disabled = true;
    nextBtn?.classList.add('hidden');
    retryBtn?.classList.add('hidden');
    skipBtn?.classList.remove('hidden');

    setStatus('Watch the opponent\u2019s move\u2026', 'info');

    setTimeout(() => {
        playOpponentMove(180);
        setStatus('Your turn \u2013 find the best move!', 'info');
        startTimer();
    }, 200);
}

export function retryPuzzle() {
    if (S.currentPuzzle) startPuzzle(S.currentPuzzle);
}

export function skipPuzzle() {
    if (!S.eloUpdatedForPuzzle && S.currentPuzzle) {
        stopTimer();
        const elapsed = getElapsed();
        const oldElo = Math.round(S.playerElo);
        const E = expectedScore(S.playerElo, S.currentPuzzle.rating);
        const localDelta = getK() * (0 - E);
        S.playerElo = Math.max(100, S.playerElo + localDelta);
        S.gamesPlayed++;
        S.puzzlesFailed++;
        S.currentStreak = 0;
        S.eloUpdatedForPuzzle = true;

        showEloDelta(localDelta);
        animateElo(oldElo, Math.round(S.playerElo));
        updateEloDisplay();
        flashBoard('glow-red');
        addHistoryEntry('skipped', S.currentPuzzle.rating, formatTime(elapsed), localDelta);

        submitResult({
            puzzle_id: S.currentPuzzle.id,
            result: 'skipped',
            score: 0,
            time_secs: elapsed,
            puzzle_rating: S.currentPuzzle.rating,
            themes: S.currentPuzzle.themes || '',
        }).then(resp => {
            S.playerElo = resp.elo;
            S.gamesPlayed = resp.games_played;
            S.puzzlesSolved = resp.puzzles_solved;
            S.puzzlesFailed = resp.puzzles_failed;
            S.currentStreak = resp.current_streak;
            updateEloDisplay();
        }).catch(() => {});
    }
    if (_fetchPuzzle) _fetchPuzzle();
}

// ---------------------------------------------------------------------------
// Info display
// ---------------------------------------------------------------------------

function updatePuzzleInfo() {
    if (ratingEl) ratingEl.textContent = S.currentPuzzle.rating;
    if (themesEl) {
        const themes = S.currentPuzzle.themes
            ? S.currentPuzzle.themes.split(' ').map(t => t.replace(/([A-Z])/g, ' $1').trim()).join(', ')
            : '\u2014';
        themesEl.textContent = themes;
    }
    updateMoveCount();
}

function updateMoveCount() {
    if (!moveCountEl) return;
    const total = Math.ceil((S.puzzleMoves.length - 1) / 2);
    const cur   = Math.floor(S.moveIndex / 2);
    moveCountEl.textContent = total > 0 ? `Move ${Math.min(cur, total)} of ${total}` : '';
}

// ---------------------------------------------------------------------------
// Move execution
// ---------------------------------------------------------------------------

export function isPromo(from, to) {
    const p = S.game.get(from);
    if (!p || p.type !== 'p') return false;
    return (p.color === 'w' && to[1] === '8') || (p.color === 'b' && to[1] === '1');
}

export function makePlayerMove(from, to, promotion) {
    const expected = S.puzzleMoves[S.moveIndex];
    const moveObj  = { from, to };
    if (promotion) moveObj.promotion = promotion;

    const result = S.game.move(moveObj);
    if (!result) { S.selectedSquare = null; renderBoard(); return; }

    const uci = from + to + (promotion || '');
    S.lastMoveFrom = from;
    S.lastMoveTo   = to;
    S.selectedSquare = null;
    S.moveIndex++;
    renderBoard();
    updateMoveCount();

    if (uci === expected) {
        if (undoBtn) undoBtn.disabled = true;

        if (S.moveIndex >= S.puzzleMoves.length) {
            playComplete();
            flashBoard('glow-green');
            completePuzzle();
        } else {
            result.captured ? playCapture() : playMove();
            playOpponentMove(120);
            if (S.moveIndex >= S.puzzleMoves.length) {
                playComplete();
                flashBoard('glow-green');
                completePuzzle();
            } else {
                setStatus('Your turn', 'info');
            }
        }
    } else {
        playWrong();
        S.madeError = true;

        // Race mode: wrong move = instant fail, no undo
        if (_onWrongMove) {
            _onWrongMove({ time_secs: (Date.now() - S.puzzleStartTime) / 1000 });
            return;
        }

        if (undoBtn) undoBtn.disabled = false;
        shakeBoard();
        flashBoard('glow-red');
        setStatus('Not quite \u2013 try again.', 'error');
    }
}

function playOpponentMove(animDuration) {
    if (S.moveIndex >= S.puzzleMoves.length) return;
    const uci  = S.puzzleMoves[S.moveIndex];
    const from = uci.slice(0, 2);
    const to   = uci.slice(2, 4);
    const promo = uci.length > 4 ? uci[4] : undefined;

    const fromCell = boardEl.querySelector(`[data-square="${from}"]`);
    const fromRect = fromCell?.getBoundingClientRect();

    const moveResult = S.game.move({ from, to, promotion: promo });
    moveResult.captured ? playCapture() : playMove();
    S.lastMoveFrom = from;
    S.lastMoveTo   = to;
    S.moveIndex++;

    renderBoard();
    updateMoveCount();
    animatePieceSlide(to, fromRect, animDuration || 120);
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

export function undoMove() {
    if (S.moveIndex <= 1) return;
    S.game.undo();
    S.moveIndex--;
    S.lastMoveFrom = S.lastMoveTo = null;
    if (S.moveIndex >= 1) {
        const p = S.puzzleMoves[S.moveIndex - 1];
        S.lastMoveFrom = p.slice(0, 2);
        S.lastMoveTo   = p.slice(2, 4);
    }
    S.selectedSquare = null;
    if (undoBtn) undoBtn.disabled = true;
    renderBoard();
    updateMoveCount();
    setStatus('Your turn \u2013 find the best move!', 'info');
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

function completePuzzle() {
    S.puzzleSolved = true;
    stopTimer();

    const elapsed = getElapsed();
    const result  = S.madeError ? 'mistakes' : 'solved';

    // Race mode: delegate to race handler and skip Elo
    if (_onComplete) {
        _onComplete({ result, time_secs: elapsed, madeError: S.madeError });
        if (undoBtn) undoBtn.disabled = true;
        skipBtn?.classList.add('hidden');
        return;
    }

    const timeStr = formatTime(elapsed);
    const score   = computeScore(true, S.madeError, elapsed);

    // Optimistic local elo for animation
    const oldElo = Math.round(S.playerElo);
    const E = expectedScore(S.playerElo, S.currentPuzzle.rating);
    const localDelta = getK() * (score - E);
    S.playerElo = Math.max(100, S.playerElo + localDelta);
    S.gamesPlayed++;
    if (result === 'solved') S.puzzlesSolved++; else S.puzzlesFailed++;
    if (score >= 0.5) S.currentStreak++; else S.currentStreak = 0;
    S.eloUpdatedForPuzzle = true;

    showEloDelta(localDelta);
    animateElo(oldElo, Math.round(S.playerElo));
    updateEloDisplay();

    const sign   = localDelta >= 0 ? '+' : '';
    const deltaR = Math.round(localDelta);
    addHistoryEntry(result, S.currentPuzzle.rating, timeStr, localDelta);

    // POST to server (reconcile on response)
    submitResult({
        puzzle_id: S.currentPuzzle.id,
        result,
        score,
        time_secs: elapsed,
        puzzle_rating: S.currentPuzzle.rating,
        themes: S.currentPuzzle.themes || '',
    }).then(resp => {
        S.playerElo = resp.elo;
        S.gamesPlayed = resp.games_played;
        S.puzzlesSolved = resp.puzzles_solved;
        S.puzzlesFailed = resp.puzzles_failed;
        S.currentStreak = resp.current_streak;
        updateEloDisplay();
    }).catch(() => {});

    if (S.madeError) {
        setStatus(`Solved with mistakes (${timeStr})  ${sign}${deltaR}`, 'warning');
        retryBtn?.classList.remove('hidden');
    } else {
        flashBoard('celebrate');
        const praise = S.currentStreak >= 5 ? `${S.currentStreak} in a row!`
            : S.currentStreak >= 3 ? `${S.currentStreak} streak!`
            : elapsed < 5 ? 'Lightning fast!'
            : SUCCESS_MSGS[Math.floor(Math.random() * SUCCESS_MSGS.length)];
        setStatus(`${praise} ${timeStr}  ${sign}${deltaR}`, 'success');
    }

    nextBtn?.classList.remove('hidden');
    skipBtn?.classList.add('hidden');
    if (undoBtn) undoBtn.disabled = true;
}
