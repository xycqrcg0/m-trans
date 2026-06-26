"""
Glossary (term-base) storage and CRUD.

Each glossary is a JSON file on disk.  The top-level interface mirrors
:func:`load_dictionary` / :func:`apply_dictionary` from ``manga_translator``
but uses structured JSON (source → target mapping) instead of regex files.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from .utils import BASE_PATH

logger = __import__("logging").getLogger("manga_translator.glossary")

# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

# Default storage directory — caller can override via set_glossary_dir().
_glossary_dir: Path = Path(BASE_PATH) / "glossaries"


class GlossaryEntry:
    """A single term mapping."""

    __slots__ = ("source", "target", "note")

    def __init__(self, source: str, target: str, note: str = "") -> None:
        self.source = source
        self.target = target
        self.note = note

    def to_dict(self) -> dict:
        return {"source": self.source, "target": self.target, "note": self.note}

    @classmethod
    def from_dict(cls, d: dict) -> GlossaryEntry:
        return cls(d.get("source", ""), d.get("target", ""), d.get("note", ""))


class Glossary:
    """In-memory glossary with metadata."""

    __slots__ = ("id", "name", "created_at", "entries")

    def __init__(
        self,
        id: str,
        name: str,
        created_at: str = "",
        entries: Optional[list[GlossaryEntry]] = None,
    ) -> None:
        self.id = id
        self.name = name
        self.created_at = created_at or datetime.now(timezone.utc).isoformat()
        self.entries = entries or []

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "created_at": self.created_at,
            "entries": [e.to_dict() for e in self.entries],
        }

    @classmethod
    def from_dict(cls, d: dict) -> Glossary:
        return cls(
            id=d.get("id", ""),
            name=d.get("name", ""),
            created_at=d.get("created_at", ""),
            entries=[GlossaryEntry.from_dict(e) for e in d.get("entries", [])],
        )

    @property
    def mapping(self) -> dict[str, str]:
        """Convenience: {source: target} lookup for quick substitution."""
        return {e.source: e.target for e in self.entries if e.source}


# ---------------------------------------------------------------------------
# Directory setup
# ---------------------------------------------------------------------------


def set_glossary_dir(path: str | Path) -> None:
    """Override the default glossary storage directory."""
    global _glossary_dir
    _glossary_dir = Path(path)
    _glossary_dir.mkdir(parents=True, exist_ok=True)


def _ensure_dir() -> Path:
    _glossary_dir.mkdir(parents=True, exist_ok=True)
    return _glossary_dir


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


def list_glossaries() -> list[dict]:
    """Return metadata for every glossary on disk (no entries)."""
    d = _ensure_dir()
    result: list[dict] = []
    for p in sorted(d.glob("*.json")):
        try:
            g = Glossary.from_dict(json.loads(p.read_text(encoding="utf-8")))
            result.append({
                "id": g.id,
                "name": g.name,
                "created_at": g.created_at,
                "entry_count": len(g.entries),
            })
        except Exception as e:
            logger.warning("Failed to load glossary %s: %s", p.name, e)
    return result


def load_glossary(glossary_id: str) -> Optional[Glossary]:
    """Load a glossary by id (filename stem)."""
    p = _ensure_dir() / f"{glossary_id}.json"
    if not p.exists():
        return None
    try:
        return Glossary.from_dict(json.loads(p.read_text(encoding="utf-8")))
    except Exception as e:
        logger.error("Failed to load glossary %s: %s", glossary_id, e)
        return None


def load_glossary_mapping(glossary_id: str) -> dict[str, str]:
    """Quick-load just the source→target mapping (no full object)."""
    g = load_glossary(glossary_id)
    return g.mapping if g else {}


def create_glossary(name: str) -> Glossary:
    """Create a new empty glossary and persist it."""
    g = Glossary(
        id=uuid.uuid4().hex[:12],
        name=name,
    )
    _save(g)
    return g


def update_entries(glossary_id: str, entries: list[dict]) -> Glossary:
    """Replace (not merge) the entry list of an existing glossary."""
    g = load_glossary(glossary_id)
    if g is None:
        raise ValueError(f"Glossary '{glossary_id}' does not exist")
    g.entries = [GlossaryEntry.from_dict(e) for e in entries]
    _save(g)
    return g



def add_entry(glossary_id: str, source: str, target: str, note: str = "") -> Glossary:
    """Add or update a single entry. If source already exists, update target."""
    g = load_glossary(glossary_id)
    if g is None:
        raise ValueError(f"Glossary '{glossary_id}' does not exist")
    for e in g.entries:
        if e.source == source:
            e.target = target
            if note:
                e.note = note
            _save(g)
            return g
    g.entries.append(GlossaryEntry(source=source, target=target, note=note))
    _save(g)
    return g


def delete_entry(glossary_id: str, source: str) -> Glossary:
    """Remove a single entry by source text."""
    g = load_glossary(glossary_id)
    if g is None:
        raise ValueError(f"Glossary '{glossary_id}' does not exist")
    g.entries = [e for e in g.entries if e.source != source]
    _save(g)
    return g


def delete_glossary(glossary_id: str) -> None:
    """Remove a glossary file from disk."""
    p = _ensure_dir() / f"{glossary_id}.json"
    p.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _save(g: Glossary) -> None:
    d = _ensure_dir()
    (d / f"{g.id}.json").write_text(
        json.dumps(g.to_dict(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


# ---------------------------------------------------------------------------
# Inline glossary application (mirrors apply_dictionary API)
# ---------------------------------------------------------------------------


def apply_glossary(text: str, mapping: dict[str, str]) -> str:
    """Apply ``mapping`` (source → target) with longest-match-first.

    Case-insensitive replacement on *first occurrence only* per term.
    Intended for use on a single text region's translation.
    """
    if not mapping:
        return text
    items = sorted(mapping.items(), key=lambda kv: -len(kv[0]))
    lower_text = text.lower()
    for src, tgt in items:
        lower_src = src.lower()
        idx = lower_text.find(lower_src)
        if idx != -1:
            text = text[:idx] + tgt + text[idx + len(src):]
            lower_text = lower_text[:idx] + tgt.lower() + lower_text[idx + len(src):]
    return text


# ---------------------------------------------------------------------------
# Default built-in glossary
# ---------------------------------------------------------------------------

_DEFAULT_ENTRIES: list[GlossaryEntry] = [
    # ── 作品标题 ──
    GlossaryEntry("かめはめ波", "龟派气功", "Dragon Ball signature move"),
    GlossaryEntry("ワンピース", "海贼王", "One Piece"),
    GlossaryEntry("ナルト", "火影忍者", "Naruto"),

    # ── 角色类型 / 称谓 ──
    GlossaryEntry("勇者", "勇者", "default hero title — keep as-is"),
    GlossaryEntry("魔王", "魔王", "demon king / demon lord"),
    GlossaryEntry("主人公", "主角", "main character / protagonist"),
    GlossaryEntry("仲間", "伙伴", "companion / friend"),
    GlossaryEntry("せんぱい", "前辈", "senior"),
    GlossaryEntry("こうはい", "后辈", "junior"),
    GlossaryEntry("先輩", "前辈", "senior (kanji form)"),
    GlossaryEntry("後輩", "后辈", "junior (kanji form)"),
    GlossaryEntry("先生", "老师", "teacher / master"),
    GlossaryEntry("センセイ", "老师 / 先生", "teacher / master (kana form)"),
    GlossaryEntry("お嬢様", "大小姐", "rich young lady"),
    GlossaryEntry("おにいちゃん", "哥哥", "older brother (affectionate)"),
    GlossaryEntry("おねえちゃん", "姐姐", "older sister (affectionate)"),
    GlossaryEntry("幼馴染", "青梅竹马", "childhood friend"),

    # ── 自称 / 第二人称 ──
    GlossaryEntry("僕", "我", "male self-referral (gentle)"),
    GlossaryEntry("俺", "我", "male self-referral (rough)"),
    GlossaryEntry("私", "我", "general self-referral"),
    GlossaryEntry("にんげん", "人类", "human"),

    # ── 感叹词 / 语气词 ──
    GlossaryEntry("たすけて", "救命", "help!"),
    GlossaryEntry("まって", "等等", "wait"),
    GlossaryEntry("だいじょうぶ", "没关系", "it's fine / don't worry"),
    GlossaryEntry("すごい", "好厉害", "amazing"),
    GlossaryEntry("ばか", "笨蛋", "idiot / fool"),
    GlossaryEntry("やった", "做到了", "I did it!"),
    GlossaryEntry("えっと", "那个…", "thinking pause"),
    GlossaryEntry("やっぱり", "果然", "as expected"),
    GlossaryEntry("なるほど", "原来如此", "I see"),
    GlossaryEntry("しまった", "糟了", "mistake / oh no"),
    GlossaryEntry("ちから", "力量 / 力", "power"),

    # ── 战斗 / 冒险术语 ──
    GlossaryEntry("必殺技", "必杀技", "ultimate move"),
    GlossaryEntry("結界", "结界", "barrier"),
    GlossaryEntry("封印", "封印", "seal"),
    GlossaryEntry("覚醒", "觉醒", "awakening"),
    GlossaryEntry("暴走", "暴走", "rampage / out of control"),

    # ── 校园 / 日常 ──
    GlossaryEntry("宿題", "作业", "homework"),
    GlossaryEntry("試験", "考试", "exam"),
    GlossaryEntry("卒業", "毕业", "graduation"),
    GlossaryEntry("文化祭", "文化祭", "school festival"),
    GlossaryEntry("体育祭", "运动会", "sports festival"),

    # ── 情感 / 心理 ──
    GlossaryEntry("恥ずかしい", "好尴尬", "embarrassed"),
    GlossaryEntry("寂しい", "好寂寞", "lonely"),
    GlossaryEntry("悔しい", "不甘心", "frustrated"),
    GlossaryEntry("怖い", "好可怕", "scary"),
    GlossaryEntry("嬉しい", "好开心", "happy"),

    # ── 拟声词 ──
    GlossaryEntry("ドキドキ", "扑通扑通", "heartbeat"),
    GlossaryEntry("ワクワク", "兴奋期待", "excitement"),
    GlossaryEntry("ガシャン", "哐当", "metal crash"),
    GlossaryEntry("ドドド", "咚咚咚", "running / impact"),

    # ── 角色名（示例：路人女主） ──
    GlossaryEntry("安芸倫也", "安艺伦也", "character name, male"),
    GlossaryEntry("倫也", "伦也", "character name, male"),
    GlossaryEntry("安芸", "安艺", "surname"),
    GlossaryEntry("加藤恵", "加藤惠", "character name, female"),
    GlossaryEntry("恵", "惠", "character name, female"),
    GlossaryEntry("加藤", "加藤", "surname"),
    GlossaryEntry("澤村・スペンサー・英梨々", "泽村・斯宾塞・英梨梨", "character name, female"),
    GlossaryEntry("英梨々", "英梨梨", "character name, female"),
    GlossaryEntry("澤村", "泽村", "surname"),

    # ── 常见角色名（日文旧字体→简体） ──
    GlossaryEntry("東條", "东条", "surname"),
    GlossaryEntry("希咲", "希咲", "name, female"),
    GlossaryEntry("理華", "理华", "name, female"),
    GlossaryEntry("美咲", "美咲", "name, female"),
    GlossaryEntry("楓", "枫", "name, female"),
    GlossaryEntry("澪", "澪", "name, female"),
    GlossaryEntry("凛", "凛", "name, neutral"),
    GlossaryEntry("茜", "茜", "name, female"),
    GlossaryEntry("蓮", "莲", "name, male/neutral"),
]


def create_default_glossary() -> Glossary:
    """Create (or reload) the built-in glossary with common anime/manga terms."""
    g = Glossary(
        id="default",
        name="二次元常用术语 (built-in)",
        entries=list(_DEFAULT_ENTRIES),
    )
    _save(g)
    return g