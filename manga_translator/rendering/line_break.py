"""Unified line-breaking abstraction shared by horizontal and vertical renderers.

The render layer (``put_text_horizontal`` / ``put_text_vertical``) consumes a
``LineBreakPlan`` produced by a ``BreakStrategy``. Strategies live behind a
single contract so that newline handling, font-size shrinking and future
breaking rules apply uniformly to both directions.

The raw single-segment breakers (``calc_vertical`` / ``calc_horizontal``) stay
in ``text_render`` and are reused by the strategies; this module adds the
direction-agnostic envelope around them:

* ``compact_special_symbols`` + explicit ``\\n`` split — done once here, so the
  vertical path now honours forced breaks (previously it silently dropped them).
* font-size shrink-to-fit — applied by every strategy, fixing the vertical
  renderer which never shrank and could overflow its bubble.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Protocol, Tuple

from . import text_render


@dataclass
class LineBreakPlan:
    """Result of breaking ``text`` into lines/columns.

    ``lines`` are ordered in reading order. ``line_extents[i]`` is the size of
    ``lines[i]`` along the primary axis: width for horizontal, height for
    vertical. ``font_size`` may be smaller than the requested size after
    shrink-to-fit.
    """
    lines: List[str]
    line_extents: List[int]
    font_size: int


class BreakStrategy(Protocol):
    """Breaks ``text`` into a ``LineBreakPlan`` for a given direction."""

    def break_text(
        self,
        text: str,
        primary: int,
        secondary: int,
        font_size: int,
        *,
        direction: str,
        lang: str = "en_US",
        hyphenate: bool = True,
    ) -> LineBreakPlan: ...


class BaseBreakStrategy:
    """Common envelope: newline normalisation, explicit-break split, shrink-to-fit.

    Subclasses implement ``_break_segment`` (single line of text with no
    embedded newlines) and ``_measure_total`` (estimate of total primary-axis
    extent used to decide whether shrinking is needed).
    """

    #: minimum font size after shrinking
    MIN_FONT_SIZE = 8
    #: shrink factor per iteration
    SHRINK_FACTOR = 0.9

    def break_text(
        self,
        text: str,
        primary: int,
        secondary: int,
        font_size: int,
        *,
        direction: str,
        lang: str = "en_US",
        hyphenate: bool = True,
    ) -> LineBreakPlan:
        if font_size <= 0:
            font_size = self.MIN_FONT_SIZE

        # Normalise once here; put_text_* no longer call compact_special_symbols.
        text = text_render.compact_special_symbols(text)

        # Explicit \n forces a break in BOTH directions. forced_break_after[i]
        # marks that segment i must be followed by a break even if the next
        # segment would otherwise fit on the same line.
        segments = text.split("\n")
        forced_break_after = [False] * len(segments)
        for i in range(len(segments) - 1):
            forced_break_after[i] = True

        cur_size = font_size
        while True:
            lines: List[str] = []
            extents: List[int] = []
            overflow = False
            for seg_i, segment in enumerate(segments):
                seg_lines, seg_extents = self._break_segment(
                    segment, primary, secondary, cur_size, direction, lang, hyphenate,
                )
                if not seg_lines:
                    # empty segment from consecutive \n — keep as a blank line
                    seg_lines, seg_extents = [""], [0]
                lines.extend(seg_lines)
                extents.extend(seg_extents)
                if forced_break_after[seg_i]:
                    # the last line of this segment is a forced break boundary;
                    # nothing to append, the next segment starts fresh.
                    pass

            # Check secondary-axis (perpendicular) capacity: number of lines
            # must fit within `secondary` given the per-line pitch.
            pitch = self._line_pitch(cur_size)
            if lines and pitch > 0 and len(lines) * pitch > secondary:
                overflow = True

            if not overflow or cur_size <= self.MIN_FONT_SIZE:
                return LineBreakPlan(lines, extents, cur_size)

            cur_size = max(int(cur_size * self.SHRINK_FACTOR), self.MIN_FONT_SIZE)

    # -- to be implemented by subclasses ---------------------------------

    def _break_segment(
        self,
        segment: str,
        primary: int,
        secondary: int,
        font_size: int,
        direction: str,
        lang: str,
        hyphenate: bool,
    ) -> Tuple[List[str], List[int]]:
        raise NotImplementedError

    def _line_pitch(self, font_size: int) -> int:
        """Per-line spacing along the secondary axis (height for horizontal,
        column pitch for vertical). Used only for shrink-to-fit capacity check.
        Subclasses may override; default returns ``font_size``."""
        return font_size


class GreedyCharStrategy(BaseBreakStrategy):
    """Character-greedy breaking, used for vertical CJK rendering.

    Wraps :func:`text_render.calc_vertical` for the per-segment logic and adds
    the secondary-axis capacity check the original vertical path lacked.
    """

    def _break_segment(
        self,
        segment: str,
        primary: int,
        secondary: int,
        font_size: int,
        direction: str,
        lang: str,
        hyphenate: bool,
    ) -> Tuple[List[str], List[int]]:
        # calc_vertical returns (line_text_list, line_height_list). `primary`
        # is the bubble height (max_height) for vertical layout.
        return text_render.calc_vertical(font_size, segment, primary)

    def _line_pitch(self, font_size: int) -> int:
        # column pitch: font_size + spacing_x (default 0.2 * font_size)
        return int(font_size * 1.2)


class WordHyphenStrategy(BaseBreakStrategy):
    """Word + syllable + hyphen breaking, used for horizontal rendering.

    Wraps :func:`text_render.calc_horizontal`, which already performs its own
    shrink-to-fit on `primary` (width). This strategy adds a secondary-axis
    (height) capacity check so that an excessive number of lines also triggers
    shrinking — matching the contract the horizontal renderer implicitly relied
    on via its own canvas sizing.
    """

    def _break_segment(
        self,
        segment: str,
        primary: int,
        secondary: int,
        font_size: int,
        direction: str,
        lang: str,
        hyphenate: bool,
    ) -> Tuple[List[str], List[int]]:
        # calc_horizontal already shrinks font_size to fit (primary, secondary)
        # and returns the possibly-shrunk size. We trust its width logic and
        # only add the line-count capacity check at the BaseBreakStrategy level.
        lines, extents, _shrunk = text_render.calc_horizontal(
            font_size, segment, primary, secondary, lang, hyphenate,
        )
        return lines, extents

    def _line_pitch(self, font_size: int) -> int:
        # line height: font_size + spacing_y (default 0.01 * font_size)
        return int(font_size * 1.01)


# registry ----------------------------------------------------------------

_STRATEGIES = {
    "char": GreedyCharStrategy,
    "word_hyphen": WordHyphenStrategy,
}


def select_strategy(direction: str, lang: str = "en_US", *, forced: str = "auto") -> BreakStrategy:
    """Pick a break strategy.

    ``forced`` is one of ``auto``/``char``/``word_hyphen``. ``auto`` selects
    ``char`` for vertical directions and ``word_hyphen`` for horizontal.
    """
    if forced in _STRATEGIES:
        return _STRATEGIES[forced]()
    if direction.startswith("v"):
        return GreedyCharStrategy()
    return WordHyphenStrategy()
