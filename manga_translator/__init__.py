from .manga_translator import MangaTranslator, TranslationInterrupt
from .manga_translator import load_dictionary, apply_dictionary
from .config import Config
from .config import Detector, Ocr, Translator, Inpainter, Renderer
from .utils import Context
from .polish import polish_translations
from .glossary import (
    load_glossary,
    load_glossary_mapping,
    create_glossary,
    update_entries,
    delete_entry,
    delete_glossary,
    list_glossaries,
    set_glossary_dir,
    create_default_glossary,
    apply_glossary,
)
