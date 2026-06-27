"""Tests for the unified line-break abstraction.

Covers the behaviour the unified ``BreakStrategy`` layer adds on top of the
raw ``calc_*`` breakers, in particular that explicit ``\\n`` forces a break in
BOTH directions (previously only horizontal honoured it).
"""
import os
import sys

import numpy as np
import pytest

# font setup is expensive (~14s); do it once at import.
from manga_translator.rendering import text_render
text_render.set_font('')

from manga_translator.rendering.line_break import (
    LineBreakPlan,
    GreedyCharStrategy,
    WordHyphenStrategy,
    select_strategy,
)


def test_select_strategy_auto_by_direction():
    assert isinstance(select_strategy('v'), GreedyCharStrategy)
    assert isinstance(select_strategy('h'), WordHyphenStrategy)
    assert isinstance(select_strategy('vr'), GreedyCharStrategy)
    assert isinstance(select_strategy('hr'), WordHyphenStrategy)


def test_select_strategy_forced_overrides_direction():
    # horizontal direction but forced char strategy
    assert isinstance(select_strategy('h', forced='char'), GreedyCharStrategy)
    # vertical direction but forced word_hyphen strategy
    assert isinstance(select_strategy('v', forced='word_hyphen'), WordHyphenStrategy)


def test_vertical_honours_explicit_newline():
    """Regression: vertical rendering used to silently drop '\\n'.

    '第一行\\n第二行' must produce TWO columns, not one column containing the
    literal newline character.
    """
    strat = GreedyCharStrategy()
    plan = strat.break_text('第一行\n第二行', primary=300, secondary=200,
                            font_size=40, direction='v', lang='CHS', hyphenate=False)
    assert plan.lines == ['第一行', '第二行']
    assert len(plan.line_extents) == 2


def test_vertical_shrink_to_fit_when_too_many_columns():
    """Long text in a narrow bubble must shrink the font rather than overflow.

    With a tiny secondary (width) budget, the char strategy should reduce
    font_size so the column count fits.
    """
    strat = GreedyCharStrategy()
    long_text = '一二三四五六七八九十' * 4
    plan = strat.break_text(long_text, primary=200, secondary=60,
                            font_size=40, direction='v', lang='CHS', hyphenate=False)
    # font must have shrunk
    assert plan.font_size < 40
    # column pitch (1.2 * font_size) must fit within secondary budget
    assert len(plan.lines) * int(plan.font_size * 1.2) <= 60


def test_horizontal_explicit_newline_splits_segments():
    strat = WordHyphenStrategy()
    # CJK so select_hyphenator returns None (no dict-load hang)
    plan = strat.break_text('第一段\n第二段', primary=200, secondary=400,
                            font_size=40, direction='h', lang='CHS', hyphenate=False)
    assert plan.lines == ['第一段', '第二段']


def test_horizontal_shrink_to_fit():
    """Text too tall (too many lines for secondary) must shrink font."""
    strat = WordHyphenStrategy()
    # Narrow width forces many lines; small secondary (height) can't fit them
    # at the original font size, so the strategy must shrink.
    text = '一二三四五六七八九十一二三四五六七八九十'
    plan = strat.break_text(text, primary=100, secondary=80,
                            font_size=40, direction='h', lang='CHS', hyphenate=False)
    assert plan.font_size < 40
def test_plan_renders_via_put_text_vertical():
    strat = GreedyCharStrategy()
    plan = strat.break_text('第一行\n第二行', primary=300, secondary=200,
                            font_size=40, direction='v', lang='CHS', hyphenate=False)
    box = text_render.put_text_vertical(40, '第一行\n第二行', 300, 'center',
                                        (0, 0, 0), (255, 255, 255), 0, plan)
    assert box is not None
    assert box.ndim == 3 and box.shape[2] == 4


def test_plan_renders_via_put_text_horizontal():
    strat = WordHyphenStrategy()
    text = '这是横排测试文字要换行'
    plan = strat.break_text(text, primary=200, secondary=200,
                            font_size=40, direction='h', lang='CHS', hyphenate=False)
    box = text_render.put_text_horizontal(40, text, 200, 200, 'center', False,
                                          (0, 0, 0), (255, 255, 255), 'CHS', False, 0, plan)
    assert box is not None
    assert box.ndim == 3 and box.shape[2] == 4


def test_empty_text_returns_empty_plan():
    strat = GreedyCharStrategy()
    plan = strat.break_text('', primary=300, secondary=200,
                            font_size=40, direction='v', lang='CHS', hyphenate=False)
    # an empty string splits into [''] -> one blank line
    assert plan.lines == ['']
    assert plan.line_extents == [0]
