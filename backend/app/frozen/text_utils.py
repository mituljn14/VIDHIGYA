"""
text_utils.py — Text pre/post-processing utilities for the Marathi Legal RAG system.

Handles:
- Page marker removal  (<!-- PAGE N --> artifacts from PDF extraction)
- Whitespace normalisation
- Basic Devanagari-aware token splitting (for BM25 indexing)
- Language ratio detection

No changes are made to legal content itself. All transformations are
surface-level and reversible (original text is always preserved in Qdrant).
"""

import re
import unicodedata
from typing import List


# ─────────────────────────────────────────────
# Page marker removal
# ─────────────────────────────────────────────

# Pattern: <!-- PAGE 1 --> or <!-- PAGE 12 -->
_PAGE_MARKER_RE = re.compile(r"<!--\s*PAGE\s+\d+\s*-->", re.IGNORECASE)


def strip_page_markers(text: str) -> str:
    """
    Remove <!-- PAGE N --> markers injected by the PDF extraction pipeline.

    These markers are useful for traceability within raw extraction outputs
    but must be removed before sending text to a language model or BM25 index.

    Args:
        text: Raw chunk text, possibly containing page markers.

    Returns:
        Cleaned text with page markers removed and excess blank lines collapsed.
    """
    text = _PAGE_MARKER_RE.sub("", text)
    # Collapse multiple consecutive blank lines to at most one
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# ─────────────────────────────────────────────
# Whitespace normalisation
# ─────────────────────────────────────────────

def normalise_whitespace(text: str) -> str:
    """
    Collapse multiple spaces/tabs within lines; keep single newlines.
    Does NOT remove Devanagari characters or legal punctuation.
    """
    lines = text.splitlines()
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in lines]
    # Remove blank lines at start/end, collapse interior blank lines
    result = "\n".join(lines)
    result = re.sub(r"\n{3,}", "\n\n", result)
    return result.strip()


def restore_line_breaks(text: str) -> str:
    """
    Display/LLM-input repair for the original corpus snapshot, whose chunks store line breaks as the two
    characters backslash + n (double-escaping defect of the extraction pipeline). Not used for BM25 tokenisation
    or embeddings, so frozen retrieval scores are unchanged. Text from the cleaned corpus is returned unchanged.
    """
    return text.replace("\\n", "\n")


def clean_chunk_text(text: str) -> str:
    """
    Full surface clean for a chunk before display or LLM consumption:
    1. Strip page markers.
    2. Normalise whitespace.
    3. NFC Unicode normalisation (handles Devanagari composition).
    """
    text = strip_page_markers(text)
    text = normalise_whitespace(text)
    text = unicodedata.normalize("NFC", text)
    return text


# ─────────────────────────────────────────────
# Token splitting for BM25
# ─────────────────────────────────────────────

# Split on whitespace and common punctuation; keep Devanagari words intact.
_TOKENISE_RE = re.compile(
    r"[^\u0900-\u097F\u0000-\u007F]+|[\u0900-\u097F]+|[A-Za-z0-9]+"
)


def tokenise_for_bm25(text: str) -> List[str]:
    """
    Tokenise text for BM25 indexing.

    Strategy:
    - Keep Devanagari word sequences as tokens.
    - Keep ASCII alphanumeric tokens.
    - Lowercase ASCII tokens for normalisation.
    - Discard pure punctuation tokens.
    - Minimum token length: 2 characters.

    This approach preserves Marathi legal terminology, statute numbers,
    case references, and English legal terms.
    """
    text = clean_chunk_text(text)
    tokens: List[str] = []
    for m in re.finditer(r"[\u0900-\u097F]+|[A-Za-z0-9]+", text):
        token = m.group()
        if len(token) < 2:
            continue
        # Lowercase only ASCII tokens; preserve Devanagari case
        if token.isascii():
            token = token.lower()
        tokens.append(token)
    return tokens


# ─────────────────────────────────────────────
# Language detection (lightweight, ratio-based)
# ─────────────────────────────────────────────

def detect_language(text: str) -> str:
    """
    Classify text language based on Devanagari vs. Latin character ratio.

    Returns:
        One of: 'Marathi-dominant', 'English-dominant', 'mixed', 'unknown'
    """
    devanagari = len(re.findall(r"[\u0900-\u097F]", text))
    latin = len(re.findall(r"[A-Za-z]", text))
    total = devanagari + latin
    if total == 0:
        return "unknown"
    if devanagari / total >= 0.60:
        return "Marathi-dominant"
    if latin / total >= 0.60:
        return "English-dominant"
    return "mixed"


# ─────────────────────────────────────────────
# Truncation for display
# ─────────────────────────────────────────────

def truncate_for_display(text: str, max_chars: int = 400) -> str:
    """
    Truncate text to max_chars for display purposes, appending '...' if cut.
    Tries to break at a word boundary.
    """
    if len(text) <= max_chars:
        return text
    cut = text[:max_chars]
    # Walk back to last space or Devanagari word break
    for i in range(len(cut) - 1, max(0, len(cut) - 40), -1):
        if cut[i] in (" ", "\n", "\u200b"):
            cut = cut[:i]
            break
    return cut + "…"
