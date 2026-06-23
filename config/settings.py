from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


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

    # storage
    upload_dir: Path = BASE_DIR / "storage" / "uploads"
    result_dir: Path = BASE_DIR / "storage" / "results"
    task_dir: Path = BASE_DIR / "storage" / "tasks"
    glossary_dir: Path = BASE_DIR / "glossaries"

    # service
    host: str = "0.0.0.0"
    port: int = 8000

    def ensure_dirs(self) -> None:
        for d in (self.upload_dir, self.result_dir, self.task_dir, self.glossary_dir):
            d.mkdir(parents=True, exist_ok=True)


settings = Settings()
settings.ensure_dirs()
