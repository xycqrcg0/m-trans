# m-trans Commit Log

记录每次 commit 的操作内容和修改摘要。

---

## commit 1 — `562b01d`

**feat: add polish.py and glossary.py modules**

修改文件：
- `manga_translator/__init__.py` (+13 行) — 显式导出 polish_translations 和 glossary CRUD 函数
- `manga_translator/polish.py` (+222 行) — **新建** LLM 润色层
  - POLISH_SYSTEM_PROMPT（二次元语境润色规则）
  - `apply_glossary_map()` / `apply_glossary_to_regions()` — 术语预替换
  - `_call_claude()` — 通过 httpx 调用 Claude API，零新依赖
  - `polish_translations()` — 主入口，原地修改 text_regions[].translation，失败静默降级
- `manga_translator/glossary.py` (+254 行) — **新建** 术语库模块
  - GlossaryEntry / Glossary 数据类
  - CRUD：list / load / create / update_entries / delete_entry / delete_glossary
  - `set_glossary_dir()` — 可配置存储路径
  - `apply_glossary()` — 最长匹配优先替换
  - `create_default_glossary()` — 20 条内置二次元术语

---

## commit 2 — `c20881c`

**feat: add _polish_fn callback and polishing stage**

修改文件：
- `manga_translator/manga_translator.py` (+15 行)
  - `_translate()` 方法：在 translation → **polishing** → mask_refinement 之间插入润色步骤
    - 调用 `self._polish_fn(ctx.text_regions)`，异常时降级
  - 新增 `set_polish_fn(fn)` 公开方法
  - `_add_logger_hook()` 注册 `'polishing': 'Running LLM polish'`

---

## commit 3 — `b2831bc`

**refactor: remove constructor side effects**

修改文件：
- `manga_translator/manga_translator.py` (-139 行)
  - 修复 `params=None` 调用崩溃（加 `params = params or {}` 守卫）
  - 删除两行 `torch.backends.cuda.*.allow_tf32 = True`（全局 TF32 设置）
  - 删除 `_setup_log_file()` 整个方法（~120 行）
    - 含 `builtins.print` 猴子补丁
    - Rich Console 重定向
    - 自动在 `result/` 目录创建日志文件
  - 新增 `self._polish_fn = None` 属性插槽
  - 构造函数从 ~140 行压缩到 ~50 行

---

## commit 4 — `a730bcc`

**feat: init m-trans fork from manga-image-translator**

修改文件：
- `manga_translator/__init__.py` (-2 行, +5 行)
  - 删除 `import colorama` / `from dotenv import load_dotenv` / `colorama.init()` / `load_dotenv()` / `from .manga_translator import *`
  - 改为显式导入：`MangaTranslator`, `TranslationInterrupt`, `load_dictionary`, `apply_dictionary`, `Config`, `Detector`, `Ocr`, `Translator`, `Inpainter`, `Renderer`, `Context`

---

## commit 5 — `550d1eb`

**chore: trim unused offline translators**

删除文件：
- `manga_translator/translators/nllb.py`
- `manga_translator/translators/m2m100.py`
- `manga_translator/translators/mbart50.py`
- `manga_translator/translators/qwen2.py`
- `manga_translator/translators/selective.py`

修改文件：
- `manga_translator/translators/__init__.py` — 清理 imports 和 OFFLINE_TRANSLATORS 字典
- `manga_translator/config.py` — 从 Translator 枚举中移除 offline, nllb, nllb_big, m2m100, m2m100_big, mbart50, qwen2, qwen2_big

保留：sugoi / jparacrawl（常见离线日英），sakura（日→中），papago（韩语）

---

## commit 6 — `1b8d21e`

**chore: remove docker scripts entry points and duplicates**

删除文件/目录：
- Dockerfile / docker-compose / .dockerignore / docker_prepare.py
- run.sh / run.bat / colab / kaggle 入口脚本
- pip-modules/（本地 wheel）
- examples/（示例配置）
- sakura_dict.txt（与 dict/ 重复）
- pytest.ini / setup.cfg / requirements-dev.txt

---

## commit 7 — `8aef85a`

**chore: remove MangaStudio training demo devscripts CI**

删除文件/目录：
- MangaStudio_Data/ + MangaStudioMain.py*（桌面应用，无关）
- training/（训练脚本，推理不需要）
- demo/ devscripts/ .github/（示例 / CI）

共 54 个文件，-11078 行

---

## commit 8 — `347993f`

**chore: remove CLI entry and frontend**

删除文件/目录：
- `manga_translator/__main__.py`（CLI 入口）
- `manga_translator/args.py`（argparse 参数解析）
- front/（自带的 React 前端，我们另建）

---

## commit 9 — `dd2055d`

**chore: remove mode/ and server/ directories**

删除文件/目录：
- `manga_translator/mode/`（local / ws / share 三种 CLI 运行模式）
- server/（自带的 FastAPI + Web UI 服务）

共 15 个文件，+3 -4027 行

---

## commit 10 — `(current)`

**build: add pyproject.toml build config + py.typed**

修改文件：
- `pyproject.toml` — 添加 `[build-system]`（hatchling）、`[tool.hatch.build.targets.wheel]` 指定 `manga_translator` 包
- `manga_translator/py.typed` — **新建** PEP 561 类型标记空文件
---

## commit 11 — `a1282e0`

**chore: remove save.py and clean requirements.txt**

删除文件：
- `manga_translator/save.py`（输出格式分发，只被已删的 args.py 引用）

修改文件：
- `requirements.txt` — 删除 6 个无引用依赖
  - cryptography / websockets / nest-asyncio / uvicorn / fastapi / python-multipart
