"""
LLM polish layer for manga text translation.

Called via `MangaTranslator.set_polish_fn()` after the initial machine translation
step, before mask refinement and rendering.  Modifies `text_regions[].translation`
in-place.

No extra dependencies beyond ``httpx`` (already in m-trans requirements).
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Optional

import httpx

logger = logging.getLogger("manga_translator.polish")

# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

POLISH_SYSTEM_PROMPT = """\
You are a professional manga translation polisher working in the otaku (anime/manga/game) community context.

Your task is to refine raw machine translations of manga text so they read naturally in the target language while preserving the original feel.

Rules (strict):
1.  **Preserve proper nouns** — character names, skill names, place names, item names. Do NOT translate or alter them.
2.  **Match character voice** — keep the original tone/register: polite, rude, archaic, cute, etc.
3.  **Onomatopoeia** — if the original is onomatopoeia (e.g. ドドド, ガシャン), keep it in the original Japanese and add a short parenthetical translation when the meaning is not obvious.
4.  **Length limit** — the polished version MUST NOT exceed 120 % of the character count of the raw translation. Shorter is better.
5.  **Natural flow** — avoid literal / stiff phrasing. Use contractions, ellipsis, and sentence-final particles where appropriate for the character.
6.  **Keep line breaks** — preserve paragraph / bubble boundaries present in the input.
7.  **Do NOT wrap in quotes** — the text is already inside a speech bubble or narrative box.
8.  **Output format** — respond with a JSON object whose keys are zero-based indices and values are the polished strings. Example: {"0": "Hey, what's up?", "1": "Nothing much."}

Input is a JSON object mapping index -> raw translation text.
Output MUST be a valid JSON object of the same shape.
"""


def _build_prompt(texts: list[str]) -> str:
    """Build the user-turn payload from a list of raw translations."""
    return json.dumps(dict(enumerate(texts)), ensure_ascii=False)


def _parse_response(body: str, count: int) -> list[Optional[str]]:
    """Parse Claude JSON response back into a list aligned with the input."""
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        logger.warning("Claude returned invalid JSON, falling back to raw translations")
        return []

    results: list[Optional[str]] = []
    for i in range(count):
        val = data.get(str(i))
        if val and isinstance(val, str):
            results.append(val)
        else:
            results.append(None)
    return results


# ---------------------------------------------------------------------------
# Glossary helpers
# ---------------------------------------------------------------------------

def apply_glossary_map(
    text: str,
    mapping: dict[str, str],
) -> str:
    """Apply ``mapping`` (source → target) with longest-match-first semantics.

    Works on a single string.  Callers iterate over text regions.
    """
    if not mapping:
        return text

    # Sort by source length descending so longer terms match first
    items = sorted(mapping.items(), key=lambda kv: -len(kv[0]))
    for src, tgt in items:
        # case-insensitive replacement
        text = _replace_ci(text, src, tgt)
    return text


def _replace_ci(text: str, old: str, new: str) -> str:
    """Case-insensitive replace (first occurrence only, to avoid runaway)."""
    lower_text = text.lower()
    lower_old = old.lower()
    idx = lower_text.find(lower_old)
    if idx == -1:
        return text
    return text[:idx] + new + text[idx + len(old):]


def apply_glossary_to_regions(
    text_regions: list,
    glossary: dict[str, str],
) -> None:
    """Replace glossary terms in *translation* of every region in-place."""
    if not glossary:
        return
    for region in text_regions:
        region.translation = apply_glossary_map(region.translation, glossary)


# ---------------------------------------------------------------------------
# Claude API
# ---------------------------------------------------------------------------

CLAUDE_API_URL = "https://api.anthropic.com/v1/messages"
CLAUDE_MODEL = "claude-sonnet-4-20250514"  # or claude-3-5-haiku-latest for speed

# Anthropic SDK is NOT required — use raw httpx to keep dependency count zero.


async def _call_claude(
    api_key: str,
    system: str,
    user_msg: str,
    *,
    max_tokens: int = 4096,
    timeout_s: int = 30,
) -> Optional[str]:
    """Single Claude API call, returns the text content block."""
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    payload = {
        "model": CLAUDE_MODEL,
        "max_tokens": max_tokens,
        "system": [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
        "messages": [{"role": "user", "content": user_msg}],
    }

    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await client.post(CLAUDE_API_URL, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()

        # Extract content text from first content block
        for block in data.get("content", []):
            if block.get("type") == "text":
                return block["text"]
        logger.warning("Claude response had no text block: %s", data)
        return None
    except httpx.HTTPStatusError as e:
        logger.error("Claude API error [%s]: %s", e.response.status_code, e.response.text[:500])
    except httpx.TimeoutException:
        logger.error("Claude API timeout after %ds", timeout_s)
    except Exception as e:
        logger.exception("Claude API unexpected error: %s", e)
    return None


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

async def polish_translations(
    text_regions: list,
    api_key: str = "",
    glossary: Optional[dict[str, str]] = None,
    system_prompt: Optional[str] = None,
) -> None:
    """Polish machine translations of ``text_regions`` in-place.

    Steps
    -----
    1. Apply *glossary* substitutions (longest-match-first, case-insensitive).
    2. Batch-write ``text_regions`` to Claude for LLM refinement.
    3. Write results back into ``region.translation``.

    Falls back gracefully — any failure leaves the original translation untouched.
    """
    if not text_regions:
        return

    # 1. Snapshot the pre-polish translation so callers can show a before/after
    #    comparison. glossary substitution (step 2) also mutates `translation`,
    #    so we capture before that too.
    for r in text_regions:
        if not hasattr(r, "raw_translation"):
            r.raw_translation = getattr(r, "translation", "") or ""

    # 2. Glossary pre-substitution
    if glossary:
        apply_glossary_to_regions(text_regions, glossary)

    # 3. Collect texts that actually have content
    indices: list[int] = []
    texts: list[str] = []
    for i, r in enumerate(text_regions):
        t = getattr(r, "translation", "") or ""
        t = t.strip()
        if t:
            indices.append(i)
            texts.append(t)

    if not texts:
        return

    # 4. Short-circuit when there is no API key (common during development)
    if not api_key:
        logger.info("No API key set for polish — skipping LLM refinement")
        return

    # 5. Call LLM
    system = system_prompt or POLISH_SYSTEM_PROMPT
    user_msg = _build_prompt(texts)
    raw = await _call_claude(api_key, system, user_msg)
    if raw is None:
        return  # fallback: keep original translation

    # 6. Parse and write back
    results = _parse_response(raw, len(texts))
    for idx_in_batch, (orig_idx, polished) in enumerate(zip(indices, results)):
        if polished:
            text_regions[orig_idx].translation = polished
        # else: leave original translation untouched