"""Translation cache using SQLite.

Caches translation results keyed by (source_text, translator, target_lang).
When the same text is translated again with the same engine + language,
the cached result is returned instead of calling the translator API.

This is NOT a cross-work translation memory — it's a per-text-block cache
that saves API calls when re-translating the same image (e.g. after
changing render settings or re-running a failed task).
"""
from __future__ import annotations

import logging
import sqlite3
import threading
from pathlib import Path
from typing import Optional

from config.settings import settings

logger = logging.getLogger("translation_cache")

_lock = threading.Lock()
_db_path: Optional[Path] = None


def _get_db() -> Path:
    global _db_path
    if _db_path is None:
        _db_path = settings.cache_dir / "translation_cache.db"
        _db_path.parent.mkdir(parents=True, exist_ok=True)
    return _db_path


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(str(_get_db()), timeout=5)
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_cache() -> None:
    """Create the cache table if it doesn't exist."""
    with _lock, _connect() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS translation_cache (
                source_text TEXT NOT NULL,
                translator TEXT NOT NULL,
                target_lang TEXT NOT NULL,
                translation TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now')),
                PRIMARY KEY (source_text, translator, target_lang)
            )
        """)
        conn.commit()
    logger.info("Translation cache initialized at %s", _get_db())


def cache_get(source_text: str, translator: str, target_lang: str) -> Optional[str]:
    """Return cached translation, or None if not cached."""
    with _lock, _connect() as conn:
        row = conn.execute(
            "SELECT translation FROM translation_cache WHERE source_text=? AND translator=? AND target_lang=?",
            (source_text, translator, target_lang),
        ).fetchone()
    return row[0] if row else None


def cache_put(source_text: str, translator: str, target_lang: str, translation: str) -> None:
    """Store a translation in the cache."""
    if not source_text or not translation:
        return
    with _lock, _connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO translation_cache (source_text, translator, target_lang, translation) VALUES (?, ?, ?, ?)",
            (source_text, translator, target_lang, translation),
        )
        conn.commit()


def cache_batch_get(
    source_texts: list[str], translator: str, target_lang: str
) -> dict[int, str]:
    """Batch lookup: returns {index: translation} for cached texts.
    Index refers to position in source_texts.
    """
    if not source_texts:
        return {}
    results: dict[int, str] = {}
    with _lock, _connect() as conn:
        # Use a parameterized query with IN clause
        placeholders = ",".join("?" * len(source_texts))
        rows = conn.execute(
            f"SELECT source_text, translation FROM translation_cache "
            f"WHERE translator=? AND target_lang=? AND source_text IN ({placeholders})",
            [translator, target_lang] + source_texts,
        ).fetchall()
    text_to_trans = {r[0]: r[1] for r in rows}
    for i, src in enumerate(source_texts):
        if src in text_to_trans:
            results[i] = text_to_trans[src]
    return results


def cache_batch_put(
    source_texts: list[str], translator: str, target_lang: str,
    translations: list[str],
) -> None:
    """Batch store translations."""
    if not source_texts or not translations:
        return
    with _lock, _connect() as conn:
        conn.executemany(
            "INSERT OR REPLACE INTO translation_cache (source_text, translator, target_lang, translation) VALUES (?, ?, ?, ?)",
            [
                (src, translator, target_lang, tgt)
                for src, tgt in zip(source_texts, translations)
                if src and tgt
            ],
        )
        conn.commit()


def cache_clear() -> int:
    """Clear all cached translations. Returns number of rows deleted."""
    with _lock, _connect() as conn:
        cur = conn.execute("DELETE FROM translation_cache")
        conn.commit()
        return cur.rowcount


def cache_stats() -> dict:
    """Return cache statistics."""
    with _lock, _connect() as conn:
        row = conn.execute("SELECT COUNT(*) FROM translation_cache").fetchone()
        count = row[0] if row else 0
    return {"entries": count}
