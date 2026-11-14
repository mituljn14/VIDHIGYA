"""Judgment upload & ingestion (2026-11-14). A user uploads a judgment PDF; a background worker runs the research data
pipeline on it and makes it searchable by the agent, WITHOUT touching the frozen corpus indexes:

  PDF -> text layer per page (pypdfium2) -> corruption score per page (EXP14/EXP11 signatures, per 1,000 Devanagari letters)
      -> damaged pages (> OCR_THRESHOLD per 1,000, or < 50 Devanagari letters) re-read by OCR (EasyOCR mr+en; research V2 used
         Tesseract - comparable on the D4 sample) -> V2 page text -> ACPMC chunks (chunking.py; header chunk first)
      -> multilingual-e5-large 'passage: ' vectors -> Qdrant collection 'vidhigya_uploads' (embedded local store, or a server via
         QDRANT_URL) + BM25 over the uploaded chunks + SQLite registry (database/uploads.db).

Uploaded documents get IDs 'up_<sha256[:16]>' and chunk IDs 'up_..._chunk_0000', so every reader keyed on '_chunk_' works.
retrieval.retrieve() adds the uploads' BM25 and dense lists to the RRF fusion only when at least one upload is indexed; with no
uploads, retrieval is byte-for-byte the frozen configuration (CONFIG_FREEZE_2026-11-13.json)."""
from __future__ import annotations
import hashlib, json, queue, re, sqlite3, threading, time, traceback, unicodedata
from pathlib import Path
import numpy as np
from . import config as C, chunking

DEVA = re.compile(r'[ऀ-ॿ]')
S_INIT = re.compile(r'(?:(?<=\s)|^)[ऀ-ःऺ-ौॎॏॕ-ॗॢॣ]')
S_GLYPH = re.compile(r'[ऀ-ॿ][\x00-\x08\x0b-\x1f!-/:-@\[-`{-~]+[ऀ-ॿ]')
S_DOUBLE = re.compile(r'(?<!्)([क-ह])\1(?![्])')
S_BAD = re.compile(r'[�-]')
SCHEMA = """
CREATE TABLE IF NOT EXISTS upload_judgments (
  document_id TEXT PRIMARY KEY, case_title TEXT, case_number TEXT, court TEXT, decision_date TEXT, case_type TEXT, language TEXT,
  page_count INTEGER, file_name TEXT, source_url TEXT, translation_status TEXT,
  original_name TEXT, sha256 TEXT, status TEXT, stage TEXT, error TEXT, created_at TEXT, updated_at TEXT,
  ocr_pages INTEGER, corruption_before REAL, corruption_after REAL, chunks INTEGER, chunker TEXT, ocr_engine TEXT, seconds REAL);
CREATE TABLE IF NOT EXISTS upload_chunks (
  chunk_id TEXT PRIMARY KEY, document_id TEXT NOT NULL, chunk_index INTEGER, text TEXT, index_text TEXT, pages TEXT, part TEXT);
CREATE INDEX IF NOT EXISTS upload_chunks_doc ON upload_chunks(document_id, chunk_index);
"""
_q: queue.Queue = queue.Queue(); _lock = threading.RLock(); _S: dict = {'bm25': None, 'ids': [], 'qdrant': None, 'ocr': None, 'started': False}


def db():
    Path(C.UPLOADS_DIR).mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(C.UPLOADS_DB, check_same_thread=False, timeout=30); con.row_factory = sqlite3.Row
    con.executescript(SCHEMA); return con


def corruption(text):
    """(signatures per 1,000 Devanagari letters or None, Devanagari letters)."""
    t = text or ''; d = len(DEVA.findall(t))
    if d < 50:
        return None, d
    n = len(S_INIT.findall(t)) + len(S_GLYPH.findall(t)) + len(S_DOUBLE.findall(t)) + len(S_BAD.findall(t))
    return 1000 * n / d, d


def _mean_corr(pages):
    s = d = 0
    for t in pages.values():
        c, n = corruption(t)
        if c is not None:
            s += c * n; d += n
    return round(s / d, 2) if d else None


# ---------------- Qdrant + BM25 over uploaded chunks ----------------
def _qdrant():
    with _lock:
        if _S['qdrant'] is None:
            from qdrant_client import QdrantClient
            from qdrant_client.models import Distance, VectorParams
            cl = QdrantClient(url=C.QDRANT_URL) if C.QDRANT_URL else QdrantClient(path=str(C.QDRANT_PATH))
            if C.QDRANT_COLLECTION not in [c.name for c in cl.get_collections().collections]:
                cl.create_collection(C.QDRANT_COLLECTION, vectors_config=VectorParams(size=1024, distance=Distance.COSINE))
            _S['qdrant'] = cl
        return _S['qdrant']


def _point_id(chunk_id):  # stable unsigned 63-bit integer id per chunk
    return int(hashlib.sha256(chunk_id.encode()).hexdigest()[:15], 16)


def rebuild_bm25():
    from rank_bm25 import BM25Okapi
    from .frozen.text_utils import tokenise_for_bm25
    rows = db().execute("SELECT c.chunk_id, c.index_text FROM upload_chunks c JOIN upload_judgments j USING(document_id) WHERE j.status='ready' ORDER BY c.chunk_id").fetchall()
    with _lock:
        if rows:
            toks = [tokenise_for_bm25(r['index_text'] or '') or ['_'] for r in rows]
            _S['bm25'] = BM25Okapi(toks, k1=1.5, b=0.75, epsilon=0.25); _S['ids'] = [r['chunk_id'] for r in rows]
        else:
            _S['bm25'] = None; _S['ids'] = []


def has_uploads():
    if _S['bm25'] is None and not _S.get('checked'):
        _S['checked'] = True; rebuild_bm25()
    return bool(_S['ids'])


def search(query, qvec, k):
    """Upload-only candidate lists (BM25 ids, dense ids), each up to k, for RRF fusion with the corpus lists."""
    from .frozen.text_utils import tokenise_for_bm25
    bm = []
    with _lock:
        if _S['bm25'] is not None:
            toks = tokenise_for_bm25(query)
            if toks:
                sc = _S['bm25'].get_scores(toks); idx = np.argsort(sc)[::-1][:k]
                bm = [_S['ids'][i] for i in idx if sc[i] > 0]
    hits = _qdrant().search(C.QDRANT_COLLECTION, query_vector=[float(x) for x in qvec], limit=k, with_payload=['chunk_id'])
    ready = set(_S['ids'])
    dense = [h.payload['chunk_id'] for h in hits if h.payload.get('chunk_id') in ready]
    return bm, dense


def texts(chunk_ids):
    ids = [c for c in chunk_ids if c.startswith('up_')]
    if not ids:
        return {}
    q = ','.join('?' * len(ids))
    return {r['chunk_id']: (r['text'], r['document_id']) for r in db().execute(f'SELECT chunk_id, text, document_id FROM upload_chunks WHERE chunk_id IN ({q})', ids)}


def doc_chunks(doc):
    return [r[0] for r in db().execute('SELECT chunk_id FROM upload_chunks WHERE document_id=? ORDER BY chunk_id', (doc,))]


def judgment(doc):
    r = db().execute('SELECT * FROM upload_judgments WHERE document_id=?', (doc,)).fetchone()
    return dict(r) if r else None


# ---------------- ingestion ----------------
def _set(doc, **kw):
    kw['updated_at'] = time.strftime('%Y-%m-%dT%H:%M:%S')
    con = db(); con.execute(f"UPDATE upload_judgments SET {', '.join(k + '=?' for k in kw)} WHERE document_id=?", [*kw.values(), doc]); con.commit()


def submit(data: bytes, name: str) -> dict:
    if not data.startswith(b'%PDF'):
        raise ValueError('not a PDF file')
    if len(data) > C.MAX_UPLOAD_MB * 1024 * 1024:
        raise ValueError(f'file larger than {C.MAX_UPLOAD_MB} MB')
    sha = hashlib.sha256(data).hexdigest(); doc = 'up_' + sha[:16]
    ex = judgment(doc)
    if ex and ex['status'] in ('queued', 'processing', 'ready'):
        return {'document_id': doc, 'status': ex['status'], 'duplicate': True}
    d = Path(C.UPLOADS_DIR) / 'pdfs'; d.mkdir(parents=True, exist_ok=True); (d / f'{doc}.pdf').write_bytes(data)
    safe = re.sub(r'[^\w.\- ()]+', '_', unicodedata.normalize('NFC', name or 'upload.pdf'))[:150]
    now = time.strftime('%Y-%m-%dT%H:%M:%S'); con = db()
    con.execute('INSERT OR REPLACE INTO upload_judgments (document_id, file_name, original_name, sha256, status, stage, created_at, updated_at, '
                "court, language, translation_status, chunker, ocr_engine) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (doc, f'{doc}.pdf', safe, sha, 'queued', 'queued', now, now, 'Uploaded document', 'mr', 'user upload', C.UPLOAD_CHUNKER, C.OCR_ENGINE))
    con.commit()
    if not start():   # worker already running: queue this job (a fresh start() resumes it from the database itself)
        _q.put(doc)
    return {'document_id': doc, 'status': 'queued', 'duplicate': False}


def _ocr_page(page):
    with _lock:
        if _S['ocr'] is None:
            import easyocr
            _S['ocr'] = easyocr.Reader(['mr', 'en'], gpu=C.DEVICE == 'cuda', download_enabled=False, verbose=False)
    img = np.asarray(page.render(scale=C.OCR_DPI / 72).to_pil().convert('RGB'))
    try:
        return _lines_from_boxes(_S['ocr'].readtext(img, detail=1, paragraph=False))
    except Exception:   # EasyOCR can crash on a degenerate (empty) crop box; retry ignoring tiny boxes
        return _lines_from_boxes(_S['ocr'].readtext(img, detail=1, paragraph=False, min_size=20))


def _lines_from_boxes(res):
    """Rebuild a line layout (like Tesseract's) from EasyOCR word boxes: words whose vertical centres are within half a median line
    height form one line (sorted left to right); a gap larger than 1.5 normal line pitches (~2.4 heights) starts a new paragraph. The ACPMC
    chunker relies on line starts (paragraph numbers, caption lines, आदेश), so merged paragraph output would degrade it."""
    if not res:
        return ''
    items = []
    for box, text, _ in res:
        ys = [p[1] for p in box]; xs = [p[0] for p in box]
        items.append(((min(ys) + max(ys)) / 2, min(xs), max(ys) - min(ys), text))
    h = float(np.median([it[2] for it in items])) or 1.0
    items.sort(key=lambda it: (it[0], it[1])); rows, cur, cy = [], [], None
    for it in items:
        if cy is None or abs(it[0] - cy) <= 0.5 * h:
            cur.append(it); cy = it[0] if cy is None else (cy * (len(cur) - 1) + it[0]) / len(cur)
        else:
            rows.append((cy, sorted(cur, key=lambda x: x[1]))); cur, cy = [it], it[0]
    rows.append((cy, sorted(cur, key=lambda x: x[1])))
    out, prev = [], None
    for y, r in rows:
        if prev is not None and y - prev > 1.5 * h * 1.6:
            out.append('')
        out.append(' '.join(x[3] for x in r)); prev = y
    return '\n'.join(out)


def process(doc):
    import pypdfium2 as pdfium
    j = judgment(doc)
    if not j or j['status'] == 'ready':   # deleted meanwhile, or already indexed (duplicate queue entry)
        return
    t0 = time.time(); _set(doc, status='processing', stage='extracting text')
    pdf = pdfium.PdfDocument(str(Path(C.UPLOADS_DIR) / 'pdfs' / f'{doc}.pdf')); n = len(pdf); layer = {}
    for i in range(n):
        tp = pdf[i].get_textpage(); layer[i + 1] = unicodedata.normalize('NFC', (tp.get_text_range() or '').replace('\r\n', '\n').replace('\r', '\n'))
    route = {p: (lambda c, d: c is None or c > C.OCR_THRESHOLD)(*corruption(t)) for p, t in layer.items()}
    before = _mean_corr(layer); v2 = dict(layer); todo = [p for p, r in route.items() if r]
    _set(doc, page_count=n, corruption_before=before, stage=f'OCR on {len(todo)} of {n} pages')
    failed = []
    for k, p in enumerate(todo, 1):
        _set(doc, stage=f'OCR page {k}/{len(todo)}')
        try:
            v2[p] = unicodedata.normalize('NFC', _ocr_page(pdf[p - 1]))
        except Exception as exc:   # one unreadable page must not fail the document: keep its text layer and record it
            failed.append(p); traceback.print_exc()
    after = _mean_corr(v2)
    _set(doc, ocr_pages=len(todo) - len(failed), corruption_after=after, stage='chunking',
         error=(f'OCR failed on page(s) {failed}; text layer kept for them' if failed else None))
    ch = chunking.chunk(v2, C.UPLOAD_CHUNKER)
    if not ch:
        raise ValueError('no text could be extracted from this PDF')
    case, parties = chunking.header_info(v2)
    ids = [f'{doc}_chunk_{i:04d}' for i in range(len(ch))]
    _set(doc, stage=f'embedding {len(ch)} chunks')
    from . import retrieval as R
    R._load_models()
    V = R._state['enc'].encode([C.DENSE_PASSAGE_PREFIX + c['index_text'] for c in ch], batch_size=16, normalize_embeddings=True, convert_to_numpy=True)
    from qdrant_client.models import PointStruct
    _qdrant().upsert(C.QDRANT_COLLECTION, points=[PointStruct(id=_point_id(cid), vector=[float(x) for x in v], payload={'chunk_id': cid, 'document_id': doc, 'part': c['part'], 'pages': c['pages']})
                                                for cid, v, c in zip(ids, V, ch)])
    con = db(); con.execute('DELETE FROM upload_chunks WHERE document_id=?', (doc,))
    con.executemany('INSERT INTO upload_chunks VALUES (?,?,?,?,?,?,?)', [(cid, doc, i, c['text'], c['index_text'], json.dumps(c['pages']), c['part']) for i, (cid, c) in enumerate(zip(ids, ch))])
    con.commit()
    title = parties or (Path(judgment(doc)['original_name'] or doc).stem)
    _set(doc, status='ready', stage='indexed', chunks=len(ch), case_number=case or None, case_title=title, seconds=round(time.time() - t0, 1))
    rebuild_bm25()


def _worker():
    while True:
        doc = _q.get()
        try:
            process(doc)
        except Exception as exc:
            _set(doc, status='error', stage='failed', error=f'{type(exc).__name__}: {exc}'[:500]); traceback.print_exc()
        finally:
            if C.LOW_MEMORY:
                with _lock:
                    _S['ocr'] = None


def start():
    """Start the single ingestion worker once; returns True if this call started it (and queued all pending jobs)."""
    with _lock:
        if _S['started']:
            return False
        _S['started'] = True; threading.Thread(target=_worker, daemon=True, name='ingest').start()
        for r in db().execute("SELECT document_id FROM upload_judgments WHERE status IN ('queued','processing') ORDER BY created_at"):
            _q.put(r[0])  # pending jobs, including ones interrupted by a restart
        return True


def delete(doc):
    if not judgment(doc):
        return False
    from qdrant_client.models import PointIdsList
    ids = doc_chunks(doc)
    if ids:
        _qdrant().delete(C.QDRANT_COLLECTION, points_selector=PointIdsList(points=[_point_id(c) for c in ids]))
    con = db(); con.execute('DELETE FROM upload_chunks WHERE document_id=?', (doc,)); con.execute('DELETE FROM upload_judgments WHERE document_id=?', (doc,)); con.commit()
    (Path(C.UPLOADS_DIR) / 'pdfs' / f'{doc}.pdf').unlink(missing_ok=True); rebuild_bm25(); return True


def listing():
    return [dict(r) for r in db().execute('SELECT document_id, case_title, case_number, original_name, page_count, status, stage, error, created_at, '
                                          'ocr_pages, corruption_before, corruption_after, chunks, chunker, ocr_engine, seconds FROM upload_judgments ORDER BY created_at DESC')]
