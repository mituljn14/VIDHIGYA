"""Chunkers for uploaded judgments (input: {page_number: page_text}).

'acpmc'     - Adaptive Context-Preserving Multi-Strategy Chunking, ported unchanged from the EXP-NEW-05 research builder
              (VIDHIGYA_FINAL_RESEARCH/11_EXPERIMENT_SERIES_V2/EXP_NEW05_CHUNKING/scripts/build_chunks.py, scheme S3):
              header chunk (caption: court, case number, parties) first, numbered judgment paragraphs merged to 900-1,800
              characters without crossing paragraph boundaries, the operative order as its own chunk, the Marathi translation
              disclaimer isolated, and a context prefix [case number | parties | paragraph range] on every chunk's index text.
'paragraph' - the corpus chunker (S0): whole blank-line paragraphs accumulated to 1,800 characters, ~250 characters overlap.
Each chunk: {'text': display/LLM text, 'index_text': text used for BM25 and E5, 'pages': [..], 'part': header|body|order|boilerplate}.
The header chunk is always chunk 0, so the deterministic case gate (generation.head2, chunks 0-1) sees the caption."""
from __future__ import annotations
import re

NUM = re.compile(r'^\s*\(?([०-९]{1,3}|\d{1,3})\s*[.)]\s')
DISC = re.compile(r'या न्यायनिर्णयाच्या मराठी भाषेतील|मातृभाषेमध्ये त्याचा अर्थ')
ORD = re.compile(r'^\s*(अंतिम\s+)?आदेश\s*[:\-–.]?\s*$|^\s*(अंतिम\s+)?आदेश\s*[:\-–]')
SENT = re.compile(r'(?<=[।.?!])\s+')
CASE = re.compile(r'([^\n]{0,40}?(?:क्र(?:मांक|\.)?|No\.?)\s*[०-९0-9]+\s*/\s*[०-९0-9]{2,4})')
ROLE = re.compile(r'^(याचिकाकर्त[ाे]|अपीलकर्त[ाे]|अर्जदार|प्रतिवादी|प्रतिसादक|उत्तरवादी|गैरअर्जदार|वि\.?|विरुद्ध|आणि इतर)\W*$')


def _lines(pages):
    return [(pg, ln) for pg in sorted(pages) for ln in (pages[pg] or '').split('\n')]


def _blocks(L):
    out, cur = [], []
    for pg, ln in L + [(None, '')]:
        if ln.strip():
            cur.append((pg, ln))
        elif cur:
            out.append(({p for p, _ in cur}, '\n'.join(x for _, x in cur))); cur = []
    return out


def _split_long(pages, text, limit=2500):
    if len(text) <= limit:
        return [(pages, text)]
    out, buf = [], ''
    for s in SENT.split(text):
        if buf and len(buf) + len(s) + 1 > limit:
            out.append((pages, buf)); buf = ''
        while len(s) > limit:
            out.append((pages, s[:limit])); s = s[limit:]
        buf = (buf + ' ' + s).strip()
    if buf:
        out.append((pages, buf))
    return out


def header_info(pages):
    """Case number and parties from the caption (also used as metadata for the uploaded judgment)."""
    L = _lines(pages); starts = [i for i, (_, ln) in enumerate(L) if NUM.match(ln)]
    if len(starts) >= 3:
        head = L[:starts[0]]
    else:
        head, acc = [], 0
        for pg, ln in L:
            if acc > 2500:
                break
            head.append((pg, ln)); acc += len(ln) + 1
    htext = '\n'.join(x for _, x in head)
    m = CASE.search(htext)
    if m and m.start() > 0 and not htext[m.start() - 1].isspace():
        parts = m.group(1).split(' ', 1); case = parts[1] if len(parts) > 1 else parts[0]
    else:
        case = m.group(1) if m else ''
    hl = [x.strip() for x in htext.split('\n') if x.strip()]
    isname = lambda x: len(re.findall(r'[ऀ-ॿ]', x)) >= 4 and not ROLE.match(x)
    vi = next((i for i, x in enumerate(hl) if re.match(r'^(वि\.?|विरुद्ध)\W*$', x) or ' विरुद्ध ' in f' {x} '), None)
    parties = ''
    if vi is not None:
        left = next((hl[j] for j in range(vi - 1, max(-1, vi - 4), -1) if isname(hl[j])), '')
        right = next((hl[j] for j in range(vi + 1, min(len(hl), vi + 4)) if isname(hl[j])), '')
        parties = (f'{left} विरुद्ध {right}' if left and right else '')[:160]
    return case.strip(), parties


def acpmc(pages):
    L = _lines(pages); starts = [i for i, (_, ln) in enumerate(L) if NUM.match(ln)]
    numbered = len(starts) >= 3
    di = next((i for i, (_, ln) in enumerate(L) if DISC.search(ln)), None)
    disc = L[di:] if di is not None else []
    if numbered:
        hl = L[:starts[0]]
    else:
        hl, acc = [], 0
        for pg, ln in L:
            if acc > 2500:
                break
            hl.append((pg, ln)); acc += len(ln) + 1
    htext = '\n'.join(x for _, x in hl); hpages = {p for p, _ in hl}; nhead = len(hl)
    case, parties = header_info(pages)
    end = di if di is not None else len(L)
    oi = next((i for i in range(end - 1, -1, -1) if ORD.match(L[i][1])), None)
    order = L[oi:end] if (oi is not None and not (numbered and oi < nhead)) else []
    cut = set(range(oi, end)) if order else set(); disc_idx = set(range(di, len(L))) if di is not None else set()
    units = []
    if numbered:
        for a, b in zip(starts, starts[1:] + [len(L)]):
            seg = [L[i] for i in range(a, b) if i not in cut and i not in disc_idx]
            if seg:
                units.append((NUM.match(L[a][1]).group(1), {p for p, _ in seg}, '\n'.join(x for _, x in seg)))
    else:
        keep = [L[i] for i in range(nhead, len(L)) if i not in cut and i not in disc_idx]
        units = [(None, p, t) for p, t in _blocks(keep)]
    out = [(hpages, htext, 'header', '')]
    cur = []

    def flush():
        if cur:
            nums = [n for n, _, _ in cur if n]
            out.append((set().union(*[p for _, p, _ in cur]), '\n'.join(t for _, _, t in cur), 'body', f'परि. {nums[0]}–{nums[-1]}' if nums else ''))
    for n, p, t in units:
        if len(t) > 2500:
            flush(); cur = []
            out.extend((pp, tt, 'body', f'परि. {n}' if n else '') for pp, tt in _split_long(p, t)); continue
        if cur and sum(len(x) for _, _, x in cur) + len(t) > 1800 and sum(len(x) for _, _, x in cur) >= 900:
            flush(); cur = []
        cur.append((n, p, t))
    flush()
    if order:
        out.extend(({p for p, _ in order}, tt, 'order', 'आदेश') for _, tt in _split_long(None, '\n'.join(x for _, x in order)))
    if disc:
        out.append(({p for p, _ in disc}, '\n'.join(x for _, x in disc), 'boilerplate', 'boilerplate'))
    res = []
    for p, t, part, tag in out:
        if not t.strip():
            continue
        pre = '[' + ' | '.join(x for x in (case, parties, tag if part != 'header' else 'header') if x) + ']'
        res.append({'text': t, 'index_text': pre + '\n' + t, 'pages': sorted(x for x in (p or hpages) if x is not None), 'part': part})
    return res


def paragraph(pages):
    out, cur = [], []
    for pages_, t in _blocks(_lines(pages)):
        for pg, piece in _split_long(pages_, t, 1800):
            if cur and sum(len(x) for _, x in cur) + len(piece) > 1800:
                out.append(cur); carry, n = [], 0
                for item in reversed(cur):
                    if n + len(item[1]) > 250:
                        break
                    carry.insert(0, item); n += len(item[1])
                cur = carry
            cur.append((pg, piece))
    if cur:
        out.append(cur)
    return [{'text': '\n\n'.join(x for _, x in c), 'index_text': '\n\n'.join(x for _, x in c),
             'pages': sorted(x for x in set().union(*[p for p, _ in c]) if x is not None), 'part': 'body'} for c in out]


def chunk(pages, scheme='acpmc'):
    return acpmc(pages) if scheme == 'acpmc' else paragraph(pages)
