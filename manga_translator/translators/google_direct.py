from typing import List
from urllib.parse import quote

import httpx

from .common import CommonTranslator

# Map MIT language codes → Google short codes
_GOOGLE_LANG = {
    "CHS": "zh-CN",
    "CHT": "zh-TW",
    "CSY": "cs",
    "NLD": "nl",
    "ENG": "en",
    "FRA": "fr",
    "DEU": "de",
    "HUN": "hu",
    "ITA": "it",
    "JPN": "ja",
    "KOR": "ko",
    "POL": "pl",
    "PTB": "pt",
    "ROM": "ro",
    "RUS": "ru",
    "ESP": "es",
    "TRK": "tr",
    "UKR": "uk",
    "VIN": "vi",
}

_ENDPOINT = "https://translate.googleapis.com/translate_a/single"


class GoogleDirectTranslator(CommonTranslator):
    """Google Translate via public web endpoint (no API key needed)."""

    _LANGUAGE_CODE_MAP = _GOOGLE_LANG

    def __init__(self):
        super().__init__()

    def supports_languages(self, from_lang: str, to_lang: str, fatal: bool = False) -> bool:
        return True

    async def _translate(self, from_lang: str, to_lang: str, queries: List[str]) -> List[str]:
        if not queries:
            return []

        results: list[str] = []
        # parse_language_codes already converted to Google short code
        to_lang_code = to_lang if to_lang in _GOOGLE_LANG.values() else _GOOGLE_LANG.get(to_lang, to_lang)
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            "Accept": "*/*",
        }
        async with httpx.AsyncClient(timeout=30.0, headers=headers) as client:
            for text in queries:
                if not text or not text.strip():
                    results.append(text)
                    continue
                try:
                    url = (
                        f"{_ENDPOINT}?client=gtx&sl=auto&tl={to_lang_code}"
                        f"&dt=t&q={quote(text, safe='')}"
                    )
                    resp = await client.get(url)
                    resp.raise_for_status()
                    data = resp.json()
                    # data[0] is list of translation fragments
                    translated = "".join(
                        part[0] for part in data[0] if part and part[0]
                    )
                    results.append(translated if translated else text)
                except Exception:
                    self.logger.exception("Google Direct translate failed for %r", text)
                    results.append(text)
        return results
