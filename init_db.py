#!/usr/bin/env python3
"""Load curated puzzles CSV into SQLite database."""

import csv
import os
import sqlite3

CSV_PATH = os.path.join(os.path.dirname(__file__), '..', 'lichess_puzzles_curated.csv')
DB_PATH = os.path.join(os.path.dirname(__file__), 'puzzles.db')
BATCH_SIZE = 10_000


def main():
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
        print(f"Removed existing {DB_PATH}")

    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE TABLE puzzles (
            id TEXT PRIMARY KEY,
            fen TEXT NOT NULL,
            moves TEXT NOT NULL,
            rating INTEGER NOT NULL,
            themes TEXT,
            opening_tags TEXT
        )
    """)

    count = 0
    batch = []
    with open(CSV_PATH, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            batch.append((
                row['PuzzleId'],
                row['FEN'],
                row['Moves'],
                int(row['Rating']),
                row.get('Themes', ''),
                row.get('OpeningTags', ''),
            ))
            if len(batch) >= BATCH_SIZE:
                conn.executemany(
                    "INSERT INTO puzzles VALUES (?, ?, ?, ?, ?, ?)", batch
                )
                count += len(batch)
                batch = []
                if count % 100_000 == 0:
                    print(f"  {count:,} puzzles...")

    if batch:
        conn.executemany("INSERT INTO puzzles VALUES (?, ?, ?, ?, ?, ?)", batch)
        count += len(batch)

    conn.execute("CREATE INDEX idx_rating ON puzzles(rating)")
    conn.commit()

    total = conn.execute("SELECT COUNT(*) FROM puzzles").fetchone()[0]
    print(f"Done. {total:,} puzzles loaded into {DB_PATH}")
    conn.close()


if __name__ == '__main__':
    main()
