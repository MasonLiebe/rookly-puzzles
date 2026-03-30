/** Shared mutable state -- imported by every module. */
export const S = {
    // Chess game
    game: null,
    currentPuzzle: null,
    puzzleMoves: [],
    moveIndex: 0,

    // Board
    selectedSquare: null,
    playerColor: 'w',
    boardFlipped: false,
    lastMoveFrom: null,
    lastMoveTo: null,

    // Puzzle progress
    madeError: false,
    puzzleSolved: false,
    eloUpdatedForPuzzle: false,

    // Drag
    dragState: null,

    // Promotion
    pendingPromotion: null,

    // Elo
    playerElo: 400,
    gamesPlayed: 0,
    puzzlesSolved: 0,
    puzzlesFailed: 0,
    currentStreak: 0,

    // Timer
    puzzleStartTime: 0,
    timerInterval: null,

    // History
    puzzleHistory: [],

    // User
    userId: null,
    userName: '',
};
