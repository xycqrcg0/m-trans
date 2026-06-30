from __future__ import annotations

import os
import sys
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


def _resolve_base_dir() -> Path:
    """Resolve the writable base directory.

    - When running from source (dev), this is the project root (the parent of
      this file's package dir).
    - When frozen by PyInstaller, ``__file__`` points into a temporary
      ``_MEIPASS`` extraction dir that is read-only and gets torn down on
      exit. We must anchor user-writable data (storage, models, fonts,
      glossaries) to the directory containing the executable instead.
    - ``M_TRANS_DATA_DIR`` env var overrides both (useful for portable
      builds that should keep data next to a specific path).
    """
    env = os.environ.get("M_TRANS_DATA_DIR")
    if env:
        return Path(env).resolve()
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent


BASE_DIR = _resolve_base_dir()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    use_gpu: bool = False

    # polish / llm
    anthropic_api_key: str = ""

    # translators
    deepseek_api_key: str = ""
    openai_api_key: str = ""
    baidu_app_id: str = ""
    baidu_secret_key: str = ""
    youdao_app_key: str = ""
    youdao_app_secret: str = ""
    deepl_auth_key: str = ""
    gemini_api_key: str = ""
    groq_api_key: str = ""

    # storage — all under storage/, organized by task ID
    upload_dir: Path = BASE_DIR / "storage" / "uploads"
    result_dir: Path = BASE_DIR / "storage" / "results"
    task_dir: Path = BASE_DIR / "storage" / "tasks"
    # manga_translator library debug/intermediate output (verbose mode)
    mt_result_dir: Path = BASE_DIR / "storage" / "mt_debug"
    # application logs
    log_dir: Path = BASE_DIR / "storage" / "logs"
    log_retention_days: int = 7
    cache_dir: Path = BASE_DIR / "storage" / "cache"
    glossary_dir: Path = BASE_DIR / "glossaries"
    # model weights (downloaded on demand)
    model_dir: Path = BASE_DIR / "models"
    # user-writable fonts root (user_fonts/ + font_notes.json live here)
    fonts_dir: Path = BASE_DIR / "fonts"
    # built-in fonts: in dev it's the project's fonts/, in frozen mode it's
    # _MEIPASS/fonts (read-only bundled). ``_builtin_fonts_dir`` is resolved
    # lazily so it picks up sys._MEIPASS at runtime.
    @property
    def builtin_fonts_dir(self) -> Path:
        if getattr(sys, "frozen", False):
            meipass = getattr(sys, "_MEIPASS", None)
            if meipass:
                return Path(meipass) / "fonts"
        return self.fonts_dir

    # service
    host: str = "0.0.0.0"
    port: int = 8000
    def ensure_dirs(self) -> None:
        for d in (self.upload_dir, self.result_dir, self.task_dir, self.mt_result_dir, self.log_dir, self.cache_dir, self.glossary_dir, self.model_dir, self.fonts_dir):
            d.mkdir(parents=True, exist_ok=True)


settings = Settings()
settings.ensure_dirs()
