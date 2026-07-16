"""SQLite 저장소: 지침 조항 청크, 검토 세션/결과. 관련도 검색은 임베딩 없이
문자 bigram 자카드 유사도로 처리한다 (외부 의존성 없음, ai_assistant 프로젝트와
동일한 방식)."""

import re
import sqlite3
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(__file__).parent / "review.db"


@contextmanager
def _conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with _conn() as c:
        c.execute("""
            CREATE TABLE IF NOT EXISTS guideline_chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_file TEXT NOT NULL,
                label TEXT,
                content TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS review_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS review_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                item_label TEXT,
                item_content TEXT,
                verdict TEXT,
                reason TEXT,
                guideline_ref TEXT,
                suggestion TEXT,
                FOREIGN KEY (session_id) REFERENCES review_sessions(id)
            )
        """)


def clear_guidelines():
    with _conn() as c:
        c.execute("DELETE FROM guideline_chunks")


def add_guideline_chunks(source_file: str, chunks: list[tuple[str, str]]):
    """chunks: [(label, content), ...]"""
    with _conn() as c:
        c.executemany(
            "INSERT INTO guideline_chunks (source_file, label, content) VALUES (?, ?, ?)",
            [(source_file, label, content) for label, content in chunks],
        )


def count_guideline_chunks() -> int:
    with _conn() as c:
        row = c.execute("SELECT COUNT(*) AS n FROM guideline_chunks").fetchone()
        return row["n"]


def list_guideline_sources() -> list[dict]:
    with _conn() as c:
        rows = c.execute(
            "SELECT source_file, COUNT(*) AS n, MAX(created_at) AS uploaded_at "
            "FROM guideline_chunks GROUP BY source_file ORDER BY uploaded_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]


def _bigrams(text: str) -> set:
    text = re.sub(r"\s+", "", text.lower())
    return {text[i : i + 2] for i in range(len(text) - 1)} or {text}


def _relevance_score(query: str, content: str) -> float:
    a, b = _bigrams(query), _bigrams(content)
    if not a or not b:
        return 0.0
    inter = len(a & b)
    union = len(a | b)
    return inter / union if union else 0.0


def find_relevant_guidelines(query: str, top_k: int = 5) -> list[dict]:
    with _conn() as c:
        rows = [dict(r) for r in c.execute("SELECT * FROM guideline_chunks").fetchall()]
    scored = [(_relevance_score(query, r["content"]), r) for r in rows]
    scored.sort(key=lambda x: x[0], reverse=True)
    return [r for score, r in scored[:top_k] if score > 0]


def create_review_session(filename: str) -> int:
    with _conn() as c:
        cur = c.execute("INSERT INTO review_sessions (filename) VALUES (?)", (filename,))
        return cur.lastrowid


def add_review_item(session_id: int, item: dict):
    with _conn() as c:
        c.execute(
            """INSERT INTO review_items
               (session_id, item_label, item_content, verdict, reason, guideline_ref, suggestion)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                session_id,
                item.get("item_label"),
                item.get("item_content"),
                item.get("verdict"),
                item.get("reason"),
                item.get("guideline_ref"),
                item.get("suggestion"),
            ),
        )


def list_review_sessions() -> list[dict]:
    with _conn() as c:
        rows = c.execute(
            "SELECT * FROM review_sessions ORDER BY created_at DESC LIMIT 50"
        ).fetchall()
        return [dict(r) for r in rows]


def get_review_session(session_id: int) -> dict:
    with _conn() as c:
        session = c.execute(
            "SELECT * FROM review_sessions WHERE id = ?", (session_id,)
        ).fetchone()
        items = c.execute(
            "SELECT * FROM review_items WHERE session_id = ? ORDER BY id", (session_id,)
        ).fetchall()
        return {"session": dict(session) if session else None, "items": [dict(i) for i in items]}
