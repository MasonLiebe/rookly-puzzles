#!/usr/bin/env python3
"""Create app database with user accounts, puzzle history, and theme stats."""

import os
import sqlite3

DB_PATH = os.path.join(os.path.dirname(__file__), 'app.db')
USERS = ['Amir', 'Matt', 'Mason', 'Matthais', 'Lucas', 'Jeremy']


def main():
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
        print(f"Removed existing {DB_PATH}")

    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")

    conn.executescript("""
        CREATE TABLE users (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT NOT NULL UNIQUE,
            elo             REAL NOT NULL DEFAULT 400,
            games_played    INTEGER NOT NULL DEFAULT 0,
            puzzles_solved  INTEGER NOT NULL DEFAULT 0,
            puzzles_failed  INTEGER NOT NULL DEFAULT 0,
            current_streak  INTEGER NOT NULL DEFAULT 0,
            created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE puzzle_history (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL REFERENCES users(id),
            puzzle_id       TEXT NOT NULL,
            result          TEXT NOT NULL CHECK (result IN ('solved','mistakes','skipped')),
            score           REAL NOT NULL,
            time_secs       REAL NOT NULL,
            elo_before      REAL NOT NULL,
            elo_after       REAL NOT NULL,
            elo_delta       REAL NOT NULL,
            puzzle_rating   INTEGER NOT NULL,
            themes          TEXT,
            played_at       TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX idx_ph_user      ON puzzle_history(user_id);
        CREATE INDEX idx_ph_user_date ON puzzle_history(user_id, played_at);

        CREATE TABLE theme_stats (
            user_id   INTEGER NOT NULL REFERENCES users(id),
            theme     TEXT NOT NULL,
            correct   INTEGER NOT NULL DEFAULT 0,
            total     INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (user_id, theme)
        );

        CREATE TABLE races (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            creator_id      INTEGER NOT NULL REFERENCES users(id),
            max_players     INTEGER NOT NULL DEFAULT 2,
            puzzle_count    INTEGER NOT NULL DEFAULT 100,
            time_limit_secs INTEGER NOT NULL DEFAULT 300,
            puzzle_ids      TEXT NOT NULL DEFAULT '',
            status          TEXT NOT NULL DEFAULT 'waiting'
                            CHECK (status IN ('waiting','active','finished','cancelled')),
            winner_id       INTEGER REFERENCES users(id),
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            started_at      TEXT,
            finished_at     TEXT
        );
        CREATE INDEX idx_race_status ON races(status);

        CREATE TABLE imported_games (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL REFERENCES users(id),
            source          TEXT NOT NULL CHECK (source IN ('lichess','chesscom')),
            source_username TEXT NOT NULL,
            game_id         TEXT NOT NULL,
            pgn             TEXT NOT NULL,
            white_name      TEXT,
            black_name      TEXT,
            white_rating    INTEGER,
            black_rating    INTEGER,
            result          TEXT,
            time_control    TEXT,
            opening         TEXT,
            fen             TEXT,
            played_at       TEXT,
            imported_at     TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(user_id, source, game_id)
        );
        CREATE INDEX idx_ig_user ON imported_games(user_id);

        CREATE TABLE blitz_scores (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL REFERENCES users(id),
            drill       TEXT NOT NULL,
            score       INTEGER NOT NULL,
            played_at   TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_blitz_user ON blitz_scores(user_id);
        CREATE INDEX idx_blitz_drill ON blitz_scores(drill);

        CREATE TABLE race_participants (
            race_id     INTEGER NOT NULL REFERENCES races(id),
            user_id     INTEGER NOT NULL REFERENCES users(id),
            slot        INTEGER NOT NULL,
            joined_at   TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (race_id, user_id)
        );
        CREATE INDEX idx_rpart_race ON race_participants(race_id);

        CREATE TABLE game_moments (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL REFERENCES users(id),
            game_id         INTEGER NOT NULL REFERENCES imported_games(id),
            fen             TEXT NOT NULL,
            move_number     INTEGER NOT NULL,
            player_move     TEXT NOT NULL,
            best_move       TEXT NOT NULL,
            eval_before     INTEGER,
            eval_after      INTEGER,
            eval_best       INTEGER,
            eval_drop       INTEGER NOT NULL,
            moment_type     TEXT NOT NULL CHECK (moment_type IN ('blunder','mistake')),
            player_color    TEXT NOT NULL CHECK (player_color IN ('white','black')),
            reviewed        INTEGER NOT NULL DEFAULT 0,
            correct         INTEGER,
            analyzed_at     TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_gm_user ON game_moments(user_id);
        CREATE INDEX idx_gm_game ON game_moments(game_id);

        CREATE TABLE game_analysis (
            game_id         INTEGER PRIMARY KEY REFERENCES imported_games(id),
            user_id         INTEGER NOT NULL REFERENCES users(id),
            status          TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','analyzing','done','error')),
            moments_found   INTEGER NOT NULL DEFAULT 0,
            error_msg       TEXT,
            started_at      TEXT,
            finished_at     TEXT
        );
        CREATE INDEX idx_ga_user ON game_analysis(user_id, status);

        CREATE TABLE race_progress (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            race_id         INTEGER NOT NULL REFERENCES races(id),
            user_id         INTEGER NOT NULL REFERENCES users(id),
            puzzle_index    INTEGER NOT NULL,
            puzzle_id       TEXT NOT NULL,
            result          TEXT NOT NULL CHECK (result IN ('solved','mistakes','skipped')),
            time_secs       REAL NOT NULL,
            solved_at       TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(race_id, user_id, puzzle_index)
        );
        CREATE INDEX idx_rp_race ON race_progress(race_id);
    """)

    for name in USERS:
        conn.execute("INSERT INTO users (name) VALUES (?)", (name,))

    conn.commit()
    print(f"Created {DB_PATH} with {len(USERS)} users: {', '.join(USERS)}")
    conn.close()


if __name__ == '__main__':
    main()
