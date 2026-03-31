#!/usr/bin/env python3
"""Flask app serving chess puzzles with user accounts."""

import json as json_mod
import math
import os
import random
import sqlite3
import ssl
import threading
import urllib.request
import urllib.error

# SSL context for external API calls (macOS may need this)
_ssl_ctx = ssl.create_default_context()
try:
    import certifi
    _ssl_ctx.load_verify_locations(certifi.where())
except ImportError:
    _ssl_ctx.check_hostname = False
    _ssl_ctx.verify_mode = ssl.CERT_NONE

from flask import Flask, jsonify, render_template, request

app = Flask(__name__)
PUZZLE_DB = os.path.join(os.path.dirname(__file__), 'puzzles.db')
APP_DB = os.path.join(os.path.dirname(__file__), 'app.db')


def get_puzzle_db():
    conn = sqlite3.connect(PUZZLE_DB)
    conn.row_factory = sqlite3.Row
    return conn


def get_app_db():
    conn = sqlite3.connect(APP_DB)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=3000")
    return conn


# ---- Elo math (mirrors frontend) ----

def expected_score(player_r, puzzle_r):
    return 1 / (1 + 10 ** ((puzzle_r - player_r) / 400))


def get_k(games_played):
    if games_played < 20:
        return 40
    if games_played < 50:
        return 32
    return 20


# ---- Pages ----

@app.route('/')
def landing():
    return render_template('landing.html')


@app.route('/play/<int:user_id>')
def play(user_id):
    return render_template('play.html', user_id=user_id, page='practice')


@app.route('/analytics/<int:user_id>')
def analytics(user_id):
    return render_template('analytics.html', user_id=user_id, page='stats')


@app.route('/blitz/<int:user_id>')
def blitz(user_id):
    return render_template('blitz.html', user_id=user_id, page='blitz')


@app.route('/games/<int:user_id>')
def games(user_id):
    return render_template('games.html', user_id=user_id, page='games')


@app.route('/review/<int:user_id>')
def review(user_id):
    return render_template('review.html', user_id=user_id, page='review')


# ---- Game Import API ----

def _fetch_lichess_games(username, max_games=500):
    """Fetch recent games from Lichess API (ndjson streaming)."""
    url = (f'https://lichess.org/api/games/user/{username}'
           f'?max={max_games}&pgnInJson=true&opening=true')
    req = urllib.request.Request(url, headers={
        'Accept': 'application/x-ndjson',
        'User-Agent': 'Rookly Puzzles Prototype',
    })
    games = []
    with urllib.request.urlopen(req, timeout=120, context=_ssl_ctx) as resp:
        for line in resp:
            line = line.strip()
            if not line:
                continue
            g = json_mod.loads(line)
            players = g.get('players', {})
            w = players.get('white', {})
            b = players.get('black', {})
            games.append({
                'game_id': g.get('id', ''),
                'pgn': g.get('pgn', ''),
                'white_name': w.get('user', {}).get('name', '?'),
                'black_name': b.get('user', {}).get('name', '?'),
                'white_rating': w.get('rating'),
                'black_rating': b.get('rating'),
                'result': _lichess_result(g.get('winner'), w, b),
                'time_control': g.get('speed', ''),
                'opening': g.get('opening', {}).get('name', ''),
                'fen': g.get('lastFen', ''),
                'played_at': g.get('createdAt', ''),
            })
    return games


def _lichess_result(winner, w, b):
    if winner == 'white':
        return '1-0'
    elif winner == 'black':
        return '0-1'
    else:
        return '1/2-1/2'


def _fetch_chesscom_games(username, max_games=500):
    """Fetch recent games from Chess.com API (monthly archives)."""
    base = f'https://api.chess.com/pub/player/{username}/games/archives'
    req = urllib.request.Request(base, headers={
        'User-Agent': 'Rookly Puzzles Prototype',
    })
    with urllib.request.urlopen(req, timeout=15, context=_ssl_ctx) as resp:
        archives = json_mod.loads(resp.read()).get('archives', [])

    if not archives:
        return []

    # Fetch most recent months until we have enough games
    games = []
    for archive_url in reversed(archives):
        if len(games) >= max_games:
            break
        req = urllib.request.Request(archive_url, headers={
            'User-Agent': 'Rookly Puzzles Prototype',
        })
        with urllib.request.urlopen(req, timeout=15, context=_ssl_ctx) as resp:
            data = json_mod.loads(resp.read())
        for g in reversed(data.get('games', [])):
            if len(games) >= max_games:
                break
            w = g.get('white', {})
            b = g.get('black', {})
            games.append({
                'game_id': g.get('url', '').split('/')[-1],
                'pgn': g.get('pgn', ''),
                'white_name': w.get('username', '?'),
                'black_name': b.get('username', '?'),
                'white_rating': w.get('rating'),
                'black_rating': b.get('rating'),
                'result': _chesscom_result(w.get('result'), b.get('result')),
                'time_control': g.get('time_class', ''),
                'opening': g.get('eco', ''),
                'fen': g.get('fen', ''),
                'played_at': str(g.get('end_time', '')),
            })
    return games


def _chesscom_result(w_result, b_result):
    if w_result == 'win':
        return '1-0'
    elif b_result == 'win':
        return '0-1'
    else:
        return '1/2-1/2'


@app.route('/api/user/<int:user_id>/import', methods=['POST'])
def import_games(user_id):
    data = request.json
    source = data.get('source', '')
    username = data.get('username', '').strip()

    if source not in ('lichess', 'chesscom') or not username:
        return jsonify({"error": "Provide source (lichess/chesscom) and username"}), 400

    try:
        if source == 'lichess':
            games = _fetch_lichess_games(username)
        else:
            games = _fetch_chesscom_games(username)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return jsonify({"error": f"User '{username}' not found on {source}"}), 404
        return jsonify({"error": f"API error: {e.code}"}), 502
    except Exception as e:
        return jsonify({"error": f"Failed to fetch: {str(e)}"}), 502

    db = get_app_db()
    try:
        imported = 0
        skipped = 0
        for g in games:
            try:
                db.execute("""
                    INSERT INTO imported_games
                    (user_id, source, source_username, game_id, pgn,
                     white_name, black_name, white_rating, black_rating,
                     result, time_control, opening, fen, played_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, (user_id, source, username, g['game_id'], g['pgn'],
                      g['white_name'], g['black_name'], g['white_rating'],
                      g['black_rating'], g['result'], g['time_control'],
                      g['opening'], g['fen'], g['played_at']))
                imported += 1
            except sqlite3.IntegrityError:
                skipped += 1
        db.commit()
        return jsonify({"imported": imported, "skipped": skipped, "total": len(games)})
    finally:
        db.close()


@app.route('/api/user/<int:user_id>/games')
def list_games(user_id):
    limit = request.args.get('limit', 500, type=int)
    source = request.args.get('source', '', type=str)
    db = get_app_db()
    try:
        where = "user_id = ?"
        params = [user_id]
        if source:
            where += " AND source = ?"
            params.append(source)
        rows = db.execute(f"""
            SELECT id, source, source_username, game_id,
                   white_name, black_name, white_rating, black_rating,
                   result, time_control, opening, played_at
            FROM imported_games WHERE {where}
            ORDER BY id DESC LIMIT ?
        """, params + [limit]).fetchall()
        return jsonify([dict(r) for r in rows])
    finally:
        db.close()


# ---- Game Analysis (Stockfish) ----

import chess
import chess.pgn
import chess.engine
import io
import datetime

import shutil
STOCKFISH_PATH = shutil.which('stockfish') or '/opt/homebrew/bin/stockfish'
ANALYSIS_DEPTH = 13
BLUNDER_THRESHOLD = 400   # centipawns drop for "blunder" (~losing a minor piece)
MISTAKE_THRESHOLD = 200   # centipawns drop for "mistake" (~2 pawns, clearly tactical)
# Only flag moments that change the position's character:
# - Position was competitive (eval_before between -300 and +600)
# - After the move, position is actually worse (eval_after <= -50)
# This filters out subtle positional errors and "mate in 6 → +8" noise.
EVAL_BEFORE_MAX = 600     # skip if already crushing (still winning after mistake)
EVAL_BEFORE_MIN = -300    # skip if already lost
EVAL_AFTER_MAX = -50      # after move, position must actually be bad


def _analyze_game(game_row_id, user_id, pgn_text, source_username):
    """Analyze a single game with Stockfish and store interesting moments."""
    db = get_app_db()
    try:
        db.execute("""
            INSERT OR REPLACE INTO game_analysis (game_id, user_id, status, started_at)
            VALUES (?, ?, 'analyzing', datetime('now'))
        """, (game_row_id, user_id))
        db.commit()

        # Parse PGN
        pgn_io = io.StringIO(pgn_text)
        game = chess.pgn.read_game(pgn_io)
        if game is None:
            db.execute("""
                UPDATE game_analysis SET status='error', error_msg='Invalid PGN',
                finished_at=datetime('now') WHERE game_id=?
            """, (game_row_id,))
            db.commit()
            return 0

        # Determine which color the user played
        white_name = game.headers.get('White', '')
        black_name = game.headers.get('Black', '')
        user_lower = source_username.lower()
        if white_name.lower() == user_lower:
            user_color = chess.WHITE
        elif black_name.lower() == user_lower:
            user_color = chess.BLACK
        else:
            # Fallback: check if username appears in either name
            if user_lower in white_name.lower():
                user_color = chess.WHITE
            elif user_lower in black_name.lower():
                user_color = chess.BLACK
            else:
                db.execute("""
                    UPDATE game_analysis SET status='error',
                    error_msg='Cannot determine player color',
                    finished_at=datetime('now') WHERE game_id=?
                """, (game_row_id,))
                db.commit()
                return 0

        color_str = 'white' if user_color == chess.WHITE else 'black'

        # Walk through moves with Stockfish
        engine = chess.engine.SimpleEngine.popen_uci(STOCKFISH_PATH)
        board = game.board()
        moments = []
        prev_eval = None
        move_number = 0

        for node in game.mainline():
            move = node.move
            is_user_move = board.turn == user_color
            move_number += 1

            if is_user_move and prev_eval is not None:
                # Evaluate the position BEFORE the user's move
                info_before = engine.analyse(board, chess.engine.Limit(depth=ANALYSIS_DEPTH))
                best_move = info_before.get('pv', [None])[0]
                score_before = info_before['score'].pov(user_color)

                # Play the actual move and evaluate
                board.push(move)
                info_after = engine.analyse(board, chess.engine.Limit(depth=ANALYSIS_DEPTH))
                score_after = info_after['score'].pov(user_color)
                board.pop()

                # Calculate eval drop
                cp_before = _score_to_cp(score_before)
                cp_after = _score_to_cp(score_after)
                drop = cp_before - cp_after  # positive = player worsened position

                # Only flag if: significant drop, position was competitive,
                # and the result is no longer comfortable.
                if (best_move and best_move != move
                        and drop >= MISTAKE_THRESHOLD
                        and EVAL_BEFORE_MIN <= cp_before <= EVAL_BEFORE_MAX
                        and cp_after <= EVAL_AFTER_MAX):
                    # Evaluate what would have happened with best move
                    board.push(best_move)
                    info_best = engine.analyse(board, chess.engine.Limit(depth=ANALYSIS_DEPTH))
                    cp_best = _score_to_cp(info_best['score'].pov(user_color))
                    board.pop()

                    moment_type = 'blunder' if drop >= BLUNDER_THRESHOLD else 'mistake'
                    moments.append({
                        'fen': board.fen(),
                        'move_number': (move_number + 1) // 2,
                        'player_move': move.uci(),
                        'best_move': best_move.uci(),
                        'eval_before': cp_before,
                        'eval_after': cp_after,
                        'eval_best': cp_best,
                        'eval_drop': drop,
                        'moment_type': moment_type,
                        'player_color': color_str,
                    })

            # Play the move to advance the position
            board.push(move)
            # Update prev_eval
            info = engine.analyse(board, chess.engine.Limit(depth=ANALYSIS_DEPTH))
            prev_eval = info['score'].pov(user_color)

        engine.quit()

        # Store moments
        for m in moments:
            db.execute("""
                INSERT INTO game_moments
                (user_id, game_id, fen, move_number, player_move, best_move,
                 eval_before, eval_after, eval_best, eval_drop,
                 moment_type, player_color, analyzed_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
            """, (user_id, game_row_id, m['fen'], m['move_number'],
                  m['player_move'], m['best_move'], m['eval_before'],
                  m['eval_after'], m['eval_best'], m['eval_drop'],
                  m['moment_type'], m['player_color']))

        db.execute("""
            UPDATE game_analysis SET status='done', moments_found=?,
            finished_at=datetime('now') WHERE game_id=?
        """, (len(moments), game_row_id))
        db.commit()
        return len(moments)

    except Exception as e:
        db.execute("""
            UPDATE game_analysis SET status='error', error_msg=?,
            finished_at=datetime('now') WHERE game_id=?
        """, (str(e)[:200], game_row_id))
        db.commit()
        return 0
    finally:
        db.close()


def _score_to_cp(score):
    """Convert a chess.engine Score to centipawns (capping mates)."""
    if score.is_mate():
        mate_in = score.mate()
        return 10000 if mate_in > 0 else -10000
    return score.score()


def _run_analysis_batch(user_id, game_ids):
    """Background thread: analyze a batch of games."""
    db = get_app_db()
    try:
        for gid in game_ids:
            row = db.execute("""
                SELECT id, pgn, source_username FROM imported_games WHERE id=?
            """, (gid,)).fetchone()
            if row:
                _analyze_game(row['id'], user_id, row['pgn'], row['source_username'])
    finally:
        db.close()


@app.route('/api/user/<int:user_id>/analyze', methods=['POST'])
def analyze_games(user_id):
    """Trigger Stockfish analysis on un-analyzed imported games."""
    data = request.json or {}
    limit = data.get('limit', 10)  # analyze up to N games at a time

    db = get_app_db()
    try:
        # Find games that haven't been analyzed yet
        rows = db.execute("""
            SELECT ig.id FROM imported_games ig
            LEFT JOIN game_analysis ga ON ga.game_id = ig.id
            WHERE ig.user_id = ? AND (ga.game_id IS NULL OR ga.status = 'error')
            ORDER BY ig.id DESC LIMIT ?
        """, (user_id, limit)).fetchall()

        if not rows:
            return jsonify({"status": "nothing_to_analyze", "queued": 0})

        game_ids = [r['id'] for r in rows]

        # Mark them as pending
        for gid in game_ids:
            db.execute("""
                INSERT OR REPLACE INTO game_analysis (game_id, user_id, status)
                VALUES (?, ?, 'pending')
            """, (gid, user_id))
        db.commit()

        # Run analysis in background thread
        t = threading.Thread(target=_run_analysis_batch, args=(user_id, game_ids))
        t.daemon = True
        t.start()

        return jsonify({"status": "started", "queued": len(game_ids)})
    finally:
        db.close()


@app.route('/api/user/<int:user_id>/analysis-status')
def analysis_status(user_id):
    """Check progress of game analysis."""
    db = get_app_db()
    try:
        total = db.execute(
            "SELECT COUNT(*) FROM imported_games WHERE user_id=?", (user_id,)
        ).fetchone()[0]
        done = db.execute(
            "SELECT COUNT(*) FROM game_analysis WHERE user_id=? AND status='done'",
            (user_id,)
        ).fetchone()[0]
        analyzing = db.execute(
            "SELECT COUNT(*) FROM game_analysis WHERE user_id=? AND status='analyzing'",
            (user_id,)
        ).fetchone()[0]
        pending = db.execute(
            "SELECT COUNT(*) FROM game_analysis WHERE user_id=? AND status='pending'",
            (user_id,)
        ).fetchone()[0]
        errors = db.execute(
            "SELECT COUNT(*) FROM game_analysis WHERE user_id=? AND status='error'",
            (user_id,)
        ).fetchone()[0]
        total_moments = db.execute(
            "SELECT COALESCE(SUM(moments_found),0) FROM game_analysis WHERE user_id=? AND status='done'",
            (user_id,)
        ).fetchone()[0]
        return jsonify({
            "total_games": total,
            "analyzed": done,
            "analyzing": analyzing,
            "pending": pending,
            "errors": errors,
            "total_moments": total_moments,
            "in_progress": analyzing + pending > 0,
        })
    finally:
        db.close()


@app.route('/api/user/<int:user_id>/moments')
def get_moments(user_id):
    """Get blunder/mistake moments for the review quiz."""
    mode = request.args.get('mode', 'unreviewed')  # unreviewed, all, blunders
    limit = request.args.get('limit', 20, type=int)

    db = get_app_db()
    try:
        where = "gm.user_id = ?"
        params = [user_id]

        # Only show moments where the position was competitive and the
        # mistake actually changed the game's character (filters out
        # "mate in 6 → +8" and already-lost positions).
        where += (" AND gm.eval_before >= ? AND gm.eval_before <= ?"
                  " AND gm.eval_after <= ?")
        params += [EVAL_BEFORE_MIN, EVAL_BEFORE_MAX, EVAL_AFTER_MAX]

        if mode == 'unreviewed':
            where += " AND gm.reviewed = 0"
        elif mode == 'blunders':
            where += " AND gm.moment_type = 'blunder'"

        rows = db.execute(f"""
            SELECT gm.*, ig.white_name, ig.black_name, ig.source, ig.opening,
                   ig.game_id AS source_game_id
            FROM game_moments gm
            JOIN imported_games ig ON ig.id = gm.game_id
            WHERE {where}
            ORDER BY gm.eval_drop DESC
            LIMIT ?
        """, params + [limit]).fetchall()

        return jsonify([dict(r) for r in rows])
    finally:
        db.close()


@app.route('/api/user/<int:user_id>/moments/<int:moment_id>/review', methods=['POST'])
def review_moment(user_id, moment_id):
    """Record the user's answer for a moment quiz."""
    data = request.json
    chose_correct = data.get('correct', False)

    db = get_app_db()
    try:
        db.execute("""
            UPDATE game_moments SET reviewed = 1, correct = ?
            WHERE id = ? AND user_id = ?
        """, (1 if chose_correct else 0, moment_id, user_id))
        db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


@app.route('/api/user/<int:user_id>/review-stats')
def review_stats(user_id):
    """Stats on blunder review performance."""
    db = get_app_db()
    try:
        total = db.execute(
            "SELECT COUNT(*) FROM game_moments WHERE user_id=? AND reviewed=1",
            (user_id,)
        ).fetchone()[0]
        correct = db.execute(
            "SELECT COUNT(*) FROM game_moments WHERE user_id=? AND reviewed=1 AND correct=1",
            (user_id,)
        ).fetchone()[0]
        unreviewed = db.execute(
            "SELECT COUNT(*) FROM game_moments WHERE user_id=? AND reviewed=0",
            (user_id,)
        ).fetchone()[0]
        by_type = db.execute("""
            SELECT moment_type, COUNT(*) as total,
                   SUM(CASE WHEN correct=1 THEN 1 ELSE 0 END) as correct
            FROM game_moments WHERE user_id=? AND reviewed=1
            GROUP BY moment_type
        """, (user_id,)).fetchall()

        return jsonify({
            "reviewed": total,
            "correct": correct,
            "accuracy": round(correct / total * 100, 1) if total > 0 else 0,
            "unreviewed": unreviewed,
            "by_type": [dict(r) for r in by_type],
        })
    finally:
        db.close()


# ---- Blitz API ----

BLITZ_DRILLS = {
    'mateIn1':  {'theme': 'mateIn1',  'label': 'Mate in 1'},
    'fork':     {'theme': 'fork',     'label': 'Forks'},
    'pin':      {'theme': 'pin',      'label': 'Pins'},
    'hanging':  {'theme': 'hangingPiece', 'label': 'Hanging Pieces'},
    'back_rank': {'theme': 'backRankMate', 'label': 'Back Rank Mates'},
    'mixed':    {'theme': '',          'label': 'Mixed Tactics'},
}


@app.route('/api/blitz/puzzle')
def blitz_puzzle():
    """Fast random puzzle for blitz drills, optionally filtered by theme."""
    theme = request.args.get('theme', '', type=str)
    where = "1=1"
    params = []
    if theme:
        where = "themes LIKE ?"
        params.append(f'%{theme}%')
    # Keep puzzles short (2-4 moves = 1-2 player moves)
    where += " AND length(moves) - length(replace(moves,' ','')) < 4"

    pdb = get_puzzle_db()
    try:
        row = pdb.execute(
            f"SELECT * FROM puzzles WHERE {where} ORDER BY RANDOM() LIMIT 1", params
        ).fetchone()
        if not row:
            row = pdb.execute("SELECT * FROM puzzles ORDER BY RANDOM() LIMIT 1").fetchone()
        return jsonify({
            "id": row["id"], "fen": row["fen"], "moves": row["moves"],
            "rating": row["rating"], "themes": row["themes"],
            "opening_tags": row["opening_tags"],
        })
    finally:
        pdb.close()


@app.route('/api/blitz/submit', methods=['POST'])
def blitz_submit():
    data = request.json
    db = get_app_db()
    try:
        db.execute(
            "INSERT INTO blitz_scores (user_id, drill, score) VALUES (?,?,?)",
            (data['user_id'], data['drill'], data['score']),
        )
        db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


@app.route('/api/blitz/leaderboard')
def blitz_leaderboard():
    drill = request.args.get('drill', 'mixed', type=str)
    db = get_app_db()
    try:
        rows = db.execute("""
            SELECT b.user_id, u.name, MAX(b.score) as best, COUNT(*) as attempts,
                   b.played_at
            FROM blitz_scores b JOIN users u ON b.user_id = u.id
            WHERE b.drill = ?
            GROUP BY b.user_id
            ORDER BY best DESC
        """, (drill,)).fetchall()

        # Get the played_at for the best score for each user
        result = []
        for r in rows:
            best_row = db.execute("""
                SELECT played_at FROM blitz_scores
                WHERE user_id=? AND drill=? AND score=?
                ORDER BY played_at DESC LIMIT 1
            """, (r['user_id'], drill, r['best'])).fetchone()
            result.append({
                'user_id': r['user_id'], 'name': r['name'],
                'best': r['best'], 'attempts': r['attempts'],
                'played_at': best_row['played_at'] if best_row else None,
            })
        return jsonify(result)
    finally:
        db.close()


@app.route('/api/blitz/leaderboards')
def blitz_leaderboards():
    """All drill leaderboards in one call."""
    db = get_app_db()
    try:
        rows = db.execute("""
            SELECT b.user_id, u.name, b.drill, MAX(b.score) as best
            FROM blitz_scores b JOIN users u ON b.user_id = u.id
            GROUP BY b.user_id, b.drill
            ORDER BY best DESC
        """).fetchall()
        result = {}
        for r in rows:
            result.setdefault(r['drill'], []).append({
                'user_id': r['user_id'], 'name': r['name'], 'best': r['best'],
            })
        return jsonify(result)
    finally:
        db.close()


# ---- Puzzle API ----

@app.route('/api/puzzle/random')
def random_puzzle():
    min_rating = request.args.get('min_rating', 0, type=int)
    max_rating = request.args.get('max_rating', 9999, type=int)
    theme = request.args.get('theme', '', type=str)

    where = "rating BETWEEN ? AND ?"
    params = [min_rating, max_rating]
    if theme and theme.isalnum():
        where += " AND themes LIKE ?"
        params.append(f'%{theme}%')

    db = get_puzzle_db()
    try:
        count = db.execute(
            f"SELECT COUNT(*) FROM puzzles WHERE {where}", params
        ).fetchone()[0]
        if count == 0:
            return jsonify({"error": "No puzzles found for that filter"}), 404

        offset = random.randint(0, count - 1)
        row = db.execute(
            f"SELECT * FROM puzzles WHERE {where} LIMIT 1 OFFSET ?",
            params + [offset],
        ).fetchone()

        return jsonify({
            "id": row["id"], "fen": row["fen"], "moves": row["moves"],
            "rating": row["rating"], "themes": row["themes"],
            "opening_tags": row["opening_tags"],
        })
    finally:
        db.close()


# ---- User API ----

@app.route('/api/users')
def list_users():
    db = get_app_db()
    try:
        rows = db.execute("SELECT * FROM users ORDER BY elo DESC").fetchall()
        return jsonify([dict(r) for r in rows])
    finally:
        db.close()


@app.route('/api/user/<int:user_id>')
def get_user(user_id):
    db = get_app_db()
    try:
        row = db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        if not row:
            return jsonify({"error": "User not found"}), 404
        return jsonify(dict(row))
    finally:
        db.close()


@app.route('/api/user/<int:user_id>/complete', methods=['POST'])
def complete_puzzle_endpoint(user_id):
    data = request.json
    db = get_app_db()
    try:
        user = db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        if not user:
            return jsonify({"error": "User not found"}), 404

        elo_before = user['elo']
        E = expected_score(elo_before, data['puzzle_rating'])
        K = get_k(user['games_played'])
        delta = K * (data['score'] - E)
        elo_after = max(100, elo_before + delta)

        solved = data['result'] == 'solved'
        streak = (user['current_streak'] + 1) if data['score'] >= 0.5 else 0

        db.execute("""
            INSERT INTO puzzle_history
            (user_id, puzzle_id, result, score, time_secs,
             elo_before, elo_after, elo_delta, puzzle_rating, themes)
            VALUES (?,?,?,?,?,?,?,?,?,?)
        """, (user_id, data['puzzle_id'], data['result'], data['score'],
              data['time_secs'], elo_before, elo_after, delta,
              data['puzzle_rating'], data.get('themes', '')))

        db.execute("""
            UPDATE users SET elo=?, games_played=games_played+1,
                puzzles_solved=puzzles_solved+?, puzzles_failed=puzzles_failed+?,
                current_streak=?
            WHERE id=?
        """, (elo_after, 1 if solved else 0, 0 if solved else 1, streak, user_id))

        themes_str = data.get('themes', '')
        if themes_str:
            for t in themes_str.split():
                if not t:
                    continue
                db.execute("""
                    INSERT INTO theme_stats (user_id, theme, correct, total)
                    VALUES (?,?,?,1)
                    ON CONFLICT(user_id, theme) DO UPDATE SET
                        correct=correct+?, total=total+1
                """, (user_id, t, 1 if solved else 0, 1 if solved else 0))

        db.commit()

        new_solved = user['puzzles_solved'] + (1 if solved else 0)
        new_failed = user['puzzles_failed'] + (0 if solved else 1)
        return jsonify({
            "elo": elo_after, "elo_delta": delta,
            "games_played": user['games_played'] + 1,
            "puzzles_solved": new_solved, "puzzles_failed": new_failed,
            "current_streak": streak,
        })
    finally:
        db.close()


@app.route('/api/user/<int:user_id>/history')
def user_history(user_id):
    limit = request.args.get('limit', 50, type=int)
    offset = request.args.get('offset', 0, type=int)
    db = get_app_db()
    try:
        rows = db.execute("""
            SELECT puzzle_id, result, time_secs, elo_delta, puzzle_rating, themes, played_at
            FROM puzzle_history WHERE user_id=?
            ORDER BY id DESC LIMIT ? OFFSET ?
        """, (user_id, limit, offset)).fetchall()
        return jsonify([dict(r) for r in rows])
    finally:
        db.close()


@app.route('/api/user/<int:user_id>/calendar')
def user_calendar(user_id):
    db = get_app_db()
    try:
        rows = db.execute("""
            SELECT DATE(played_at) as day, result, COUNT(*) as cnt
            FROM puzzle_history
            WHERE user_id=? AND played_at >= date('now', '-365 days')
            GROUP BY day, result
        """, (user_id,)).fetchall()

        cal = {}
        for r in rows:
            d = r['day']
            if d not in cal:
                cal[d] = {'total': 0, 'solved': 0, 'mistakes': 0, 'skipped': 0}
            cal[d][r['result']] = r['cnt']
            cal[d]['total'] += r['cnt']

        return jsonify({"calendar": cal})
    finally:
        db.close()


@app.route('/api/user/<int:user_id>/analytics')
def user_analytics(user_id):
    db = get_app_db()
    try:
        elo_rows = db.execute("""
            SELECT elo_after, played_at FROM puzzle_history
            WHERE user_id=? ORDER BY id
        """, (user_id,)).fetchall()

        theme_rows = db.execute("""
            SELECT theme, correct, total FROM theme_stats
            WHERE user_id=? ORDER BY total DESC
        """, (user_id,)).fetchall()

        return jsonify({
            "elo_history": [
                {"elo": r['elo_after'], "played_at": r['played_at']}
                for r in elo_rows
            ],
            "theme_stats": [dict(r) for r in theme_rows],
        })
    finally:
        db.close()


# ---- Race Pages ----

@app.route('/race')
def race_lobby():
    user_id = request.args.get('user', None, type=int)
    return render_template('race.html', user_id=user_id, page='race')


@app.route('/race/<int:race_id>/play/<int:user_id>')
def race_play(race_id, user_id):
    return render_template('race_play.html', race_id=race_id, user_id=user_id)


# ---- Race API ----

RACE_POOL_SIZE = 100
RACE_LIVES = 3
RACE_TIME_LIMIT = 300
RACE_RAMP_PUZZLES = 70
RACE_MIN_RATING = 400
RACE_MAX_RATING = 2800
RACE_PIECES = ['wN', 'bN', 'wR', 'bR', 'wB', 'bB']


def _build_race_pool(count):
    pdb = get_puzzle_db()
    pool = []
    for i in range(count):
        t = min(i / RACE_RAMP_PUZZLES, 1.0)
        target = RACE_MIN_RATING + t * (RACE_MAX_RATING - RACE_MIN_RATING)
        lo, hi = max(0, int(target - 150)), int(target + 150)
        row = pdb.execute(
            "SELECT id FROM puzzles WHERE rating BETWEEN ? AND ? ORDER BY RANDOM() LIMIT 1",
            (lo, hi)).fetchone()
        pool.append(row['id'] if row else
                    pdb.execute("SELECT id FROM puzzles ORDER BY RANDOM() LIMIT 1").fetchone()['id'])
    pdb.close()
    return pool


def _race_participants(db, race_id):
    return db.execute("""
        SELECT rp.user_id, rp.slot, u.name
        FROM race_participants rp JOIN users u ON rp.user_id = u.id
        WHERE rp.race_id=? ORDER BY rp.slot
    """, (race_id,)).fetchall()


def _race_progress(db, race_id):
    rows = db.execute("""
        SELECT user_id,
               COUNT(*) as completed,
               SUM(CASE WHEN result='solved' THEN 1 ELSE 0 END) as correct,
               SUM(CASE WHEN result!='solved' THEN 1 ELSE 0 END) as wrong,
               COALESCE(SUM(time_secs),0) as total_time
        FROM race_progress WHERE race_id=? GROUP BY user_id
    """, (race_id,)).fetchall()
    return {str(r['user_id']): {
        'completed': r['completed'], 'correct': r['correct'],
        'wrong': r['wrong'], 'total_time': r['total_time'],
    } for r in rows}


def _check_race_finish(db, race):
    """Race ends when all players are dead, time runs out, or a player has clinched."""
    if race['status'] != 'active':
        return
    participants = _race_participants(db, race['id'])
    progress = _race_progress(db, race['id'])
    empty = {'completed': 0, 'correct': 0, 'wrong': 0, 'total_time': 0}

    stats = [(p['user_id'], progress.get(str(p['user_id']), empty)) for p in participants]
    alive = [(uid, s) for uid, s in stats if s['wrong'] < RACE_LIVES]
    dead  = [(uid, s) for uid, s in stats if s['wrong'] >= RACE_LIVES]

    all_dead = len(alive) == 0

    # Clinch: exactly one player alive AND they already lead everyone who's dead
    clinched = False
    if len(alive) == 1 and dead:
        leader_correct = alive[0][1]['correct']
        best_dead = max(s['correct'] for _, s in dead)
        clinched = leader_correct > best_dead

    timed_out = False
    if race['started_at']:
        from datetime import datetime
        started = datetime.fromisoformat(race['started_at'])
        timed_out = (datetime.utcnow() - started).total_seconds() >= RACE_TIME_LIMIT

    if not all_dead and not clinched and not timed_out:
        return

    # Rank: most correct, then least time
    ranked = sorted(
        [(p['user_id'], progress.get(str(p['user_id']), empty)) for p in participants],
        key=lambda x: (-x[1]['correct'], x[1]['total_time']),
    )
    winner = ranked[0][0] if ranked else None
    # Check for tie with second place
    if len(ranked) >= 2:
        a, b = ranked[0][1], ranked[1][1]
        if a['correct'] == b['correct'] and a['total_time'] == b['total_time']:
            winner = None

    db.execute("""
        UPDATE races SET winner_id=?, status='finished', finished_at=datetime('now')
        WHERE id=? AND status='active'
    """, (winner, race['id']))
    db.commit()


@app.route('/api/race/create', methods=['POST'])
def create_race():
    data = request.json
    player_id = data['player_id']
    max_players = min(6, max(2, data.get('max_players', 2)))
    time_limit = data.get('time_limit_secs', RACE_TIME_LIMIT)
    if time_limit < 0:
        time_limit = 0

    adb = get_app_db()
    user = adb.execute("SELECT id FROM users WHERE id=?", (player_id,)).fetchone()
    if not user:
        adb.close()
        return jsonify({"error": "User not found"}), 404

    pool = _build_race_pool(RACE_POOL_SIZE)
    cur = adb.execute("""
        INSERT INTO races (creator_id, max_players, puzzle_count, time_limit_secs, puzzle_ids)
        VALUES (?,?,?,?,?)
    """, (player_id, max_players, RACE_POOL_SIZE, time_limit, ' '.join(pool)))
    race_id = cur.lastrowid

    adb.execute("INSERT INTO race_participants (race_id, user_id, slot) VALUES (?,?,0)",
                (race_id, player_id))
    adb.commit()
    adb.close()
    return jsonify({"race_id": race_id, "status": "waiting"})


@app.route('/api/races/open')
def open_races():
    db = get_app_db()
    try:
        rows = db.execute("""
            SELECT r.id as race_id, r.creator_id, u.name as creator_name,
                   r.max_players, r.time_limit_secs, r.created_at,
                   (SELECT COUNT(*) FROM race_participants WHERE race_id=r.id) as player_count
            FROM races r JOIN users u ON r.creator_id = u.id
            WHERE r.status = 'waiting' ORDER BY r.created_at DESC
        """).fetchall()
        return jsonify([dict(r) for r in rows])
    finally:
        db.close()


@app.route('/api/race/<int:race_id>/join', methods=['POST'])
def join_race(race_id):
    data = request.json
    player_id = data['player_id']
    db = get_app_db()
    try:
        race = db.execute("SELECT * FROM races WHERE id=?", (race_id,)).fetchone()
        if not race:
            return jsonify({"error": "Race not found"}), 404
        if race['status'] != 'waiting':
            return jsonify({"error": "Race is not open"}), 400

        existing = db.execute("SELECT 1 FROM race_participants WHERE race_id=? AND user_id=?",
                              (race_id, player_id)).fetchone()
        if existing:
            return jsonify({"error": "Already in this race"}), 400

        count = db.execute("SELECT COUNT(*) FROM race_participants WHERE race_id=?",
                           (race_id,)).fetchone()[0]
        if count >= race['max_players']:
            return jsonify({"error": "Race is full"}), 400

        db.execute("INSERT INTO race_participants (race_id, user_id, slot) VALUES (?,?,?)",
                   (race_id, player_id, count))

        # Auto-start if full
        if count + 1 >= race['max_players']:
            db.execute("UPDATE races SET status='active', started_at=datetime('now') WHERE id=?",
                       (race_id,))

        db.commit()
        return jsonify({"ok": True, "player_count": count + 1})
    finally:
        db.close()


@app.route('/api/race/<int:race_id>/start', methods=['POST'])
def start_race(race_id):
    data = request.json
    db = get_app_db()
    try:
        race = db.execute("SELECT * FROM races WHERE id=?", (race_id,)).fetchone()
        if not race or race['status'] != 'waiting':
            return jsonify({"error": "Cannot start"}), 400
        if race['creator_id'] != data.get('player_id'):
            return jsonify({"error": "Only the creator can start"}), 403
        count = db.execute("SELECT COUNT(*) FROM race_participants WHERE race_id=?",
                           (race_id,)).fetchone()[0]
        if count < 2:
            return jsonify({"error": "Need at least 2 players"}), 400

        db.execute("UPDATE races SET status='active', started_at=datetime('now') WHERE id=?",
                   (race_id,))
        db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


@app.route('/api/race/<int:race_id>/leave', methods=['POST'])
def leave_race(race_id):
    data = request.json
    db = get_app_db()
    try:
        db.execute("DELETE FROM race_participants WHERE race_id=? AND user_id=?",
                   (race_id, data['player_id']))
        db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


@app.route('/api/race/<int:race_id>/cancel', methods=['POST'])
def cancel_race(race_id):
    db = get_app_db()
    try:
        db.execute("UPDATE races SET status='cancelled' WHERE id=? AND status='waiting'", (race_id,))
        db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


@app.route('/api/race/<int:race_id>')
def get_race(race_id):
    db = get_app_db()
    try:
        race = db.execute("SELECT * FROM races WHERE id=?", (race_id,)).fetchone()
        if not race:
            return jsonify({"error": "Race not found"}), 404

        _check_race_finish(db, race)
        race = db.execute("SELECT * FROM races WHERE id=?", (race_id,)).fetchone()

        participants = _race_participants(db, race['id'])
        players = [{'user_id': p['user_id'], 'name': p['name'], 'slot': p['slot'],
                     'piece': RACE_PIECES[p['slot'] % len(RACE_PIECES)]} for p in participants]

        progress = _race_progress(db, race['id'])

        detail = db.execute("""
            SELECT user_id, result FROM race_progress
            WHERE race_id=? ORDER BY puzzle_index
        """, (race_id,)).fetchall()
        trails = {}
        for r in detail:
            trails.setdefault(str(r['user_id']), []).append(r['result'])

        return jsonify({
            **dict(race),
            'players': players,
            'progress': progress,
            'trails': trails,
        })
    finally:
        db.close()


@app.route('/api/race/<int:race_id>/puzzle/<int:index>')
def race_puzzle(race_id, index):
    db = get_app_db()
    try:
        race = db.execute("SELECT puzzle_ids FROM races WHERE id=?", (race_id,)).fetchone()
        if not race:
            return jsonify({"error": "Race not found"}), 404
        ids = race['puzzle_ids'].split()
        if index < 0 or index >= len(ids):
            return jsonify({"error": "Invalid puzzle index"}), 400
    finally:
        db.close()
    pdb = get_puzzle_db()
    try:
        puzzle = pdb.execute("SELECT * FROM puzzles WHERE id=?", (ids[index],)).fetchone()
        if not puzzle:
            return jsonify({"error": "Puzzle not found"}), 404
        return jsonify({
            "id": puzzle["id"], "fen": puzzle["fen"], "moves": puzzle["moves"],
            "rating": puzzle["rating"], "themes": puzzle["themes"],
            "opening_tags": puzzle["opening_tags"],
        })
    finally:
        pdb.close()


@app.route('/api/race/<int:race_id>/complete', methods=['POST'])
def race_complete(race_id):
    data = request.json
    db = get_app_db()
    try:
        race = db.execute("SELECT * FROM races WHERE id=?", (race_id,)).fetchone()
        if not race or race['status'] != 'active':
            return jsonify({"error": "Race not active"}), 400

        db.execute("""
            INSERT OR IGNORE INTO race_progress
            (race_id, user_id, puzzle_index, puzzle_id, result, time_secs)
            VALUES (?,?,?,?,?,?)
        """, (race_id, data['player_id'], data['puzzle_index'],
              data['puzzle_id'], data['result'], data['time_secs']))
        db.commit()

        _check_race_finish(db, race)
        race = db.execute("SELECT * FROM races WHERE id=?", (race_id,)).fetchone()

        progress = _race_progress(db, race_id)
        empty = {'completed': 0, 'correct': 0, 'wrong': 0}
        my = progress.get(str(data['player_id']), empty)

        return jsonify({
            "completed": my['completed'], "correct": my['correct'], "wrong": my['wrong'],
            "finished": race['status'] == 'finished', "winner_id": race['winner_id'],
        })
    finally:
        db.close()


if __name__ == '__main__':
    for p, label in [(PUZZLE_DB, 'Puzzle DB'), (APP_DB, 'App DB')]:
        if not os.path.exists(p):
            print(f"{label} not found at {p}")
            print("Run: python init_db.py && python init_app_db.py")
            raise SystemExit(1)
    app.run(debug=True, port=8000)
