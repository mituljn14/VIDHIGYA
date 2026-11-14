"""Validated retrieval (EXP07 + EXP07b), ported line-for-line from exp07_retrieval.py / exp07b_passage.py:
BM25 top-100 (production index) + E5-large dense top-100 over the cleaned-text corpus vectors -> RRF(k=60, keep 100)
-> bge-reranker-v2-m3 rescoring of the fused top 30 (rest appended) -> within-judgment paragraph rerank of the top 3
judgments with a document prior (score + 0.5 / judgment rank). Online port of an offline experiment: the only change is
that rankings are computed per query instead of read from the experiment's saved run files.
"""
from __future__ import annotations
import pickle, sqlite3, threading, time
from pathlib import Path
import numpy as np
from . import config as C
from .frozen.text_utils import tokenise_for_bm25

_lock = threading.Lock()
_state: dict = {}


def _db():
    con = sqlite3.connect(C.DB_PATH, check_same_thread=False); con.row_factory = sqlite3.Row; return con


def load(log=lambda m: None):
    """Load indexes and models once (thread-safe). Returns component status."""
    with _lock:
        if _state.get('ready'):
            return _state['status']
        st = {}
        t = time.perf_counter(); con = _db()
        rows = con.execute('SELECT chunk_id, vec_row FROM chunks ORDER BY vec_row').fetchall()
        _state['chunk_ids'] = [r[0] for r in rows]; _state['row_of'] = {r[0]: r[1] for r in rows}
        st['registry_chunks'] = len(rows); log(f'registry {len(rows)} chunks')
        d = Path(C.BM25_INDEX_DIR)
        with open(d / 'bm25_index.pkl', 'rb') as f:
            _state['bm25'] = pickle.load(f)
        with open(d / 'bm25_meta.pkl', 'rb') as f:
            meta = pickle.load(f)
        _state['bm25_ids'] = [m['chunk_id'] for m in meta]; del meta
        st['bm25_chunks'] = len(_state['bm25_ids']); log('bm25 loaded')
        V = np.load(C.E5_VECTORS, mmap_mode='r')
        assert V.shape[0] == len(rows), f'vector rows {V.shape[0]} != registry rows {len(rows)}'
        _state['V'] = np.asarray(V, dtype=np.float32); st['dense_vectors'] = list(V.shape); log('E5 corpus vectors loaded')
        _load_models(log)
        st.update(dense_model=C.DENSE_MODEL_ID, reranker=C.RERANKER_MODEL, load_seconds=round(time.perf_counter() - t, 1),
                  low_memory=C.LOW_MEMORY)
        _state['status'] = st; _state['ready'] = True
        return st


def _load_models(log=lambda m: None):
    """Neural models (E5 query encoder, bge reranker). Same weights every time; reloaded from disk in low-memory mode."""
    if _state.get('enc') is None:
        from sentence_transformers import SentenceTransformer
        _state['enc'] = SentenceTransformer(C.DENSE_MODEL, device=C.DEVICE); log('E5 query encoder loaded')
    if _state.get('ce') is None:
        from sentence_transformers import CrossEncoder
        _state['ce'] = CrossEncoder(C.RERANKER_MODEL, device=C.DEVICE, max_length=512); log('bge reranker loaded')


def release_models():
    """LOW_MEMORY mode: free the ~5 GB of neural retrieval models before generation so a local LLM fits in RAM.
    Results are unchanged (identical weights are reloaded for the next question); only latency increases."""
    import gc
    _state['enc'] = None; _state['ce'] = None; gc.collect()


def ready():
    return bool(_state.get('ready'))


def _texts(chunk_ids):
    con = _db(); q = ','.join('?' * len(chunk_ids))
    m = {r['chunk_id']: (r['text'], r['document_id']) for r in con.execute(f'SELECT chunk_id, text, document_id FROM chunks WHERE chunk_id IN ({q})', chunk_ids)}
    if any(c.startswith('up_') for c in chunk_ids):   # uploaded judgments live in the separate uploads store
        from . import ingest
        m.update(ingest.texts(chunk_ids))
    return m


def _doc_chunks(doc):
    if doc.startswith('up_'):
        from . import ingest
        return ingest.doc_chunks(doc)
    return [r[0] for r in _db().execute('SELECT chunk_id FROM chunks WHERE document_id=? ORDER BY chunk_id', (doc,))]


def rrf(a, b, k=C.RRF_K, keep=C.CANDIDATES_K):
    return rrf_many([a, b], k, keep)


def rrf_many(lists, k=C.RRF_K, keep=C.CANDIDATES_K):
    s = {}
    for lst in lists:
        for r, c in enumerate(lst):
            s[c] = s.get(c, 0.0) + 1.0 / (k + r + 1)
    return [c for c, _ in sorted(s.items(), key=lambda x: -x[1])][:keep]


def retrieve(query: str, emit=lambda stage, msg: None) -> dict:
    load(); _load_models(lambda m: emit('loading', m))
    T = {}
    t = time.perf_counter()
    toks = tokenise_for_bm25(query)
    bm = []
    if toks:
        sc = _state['bm25'].get_scores(toks)
        idx = np.argsort(sc)[::-1][:C.CANDIDATES_K]
        bm = [_state['bm25_ids'][i] for i in idx if sc[i] > 0]
    T['bm25_ms'] = round((time.perf_counter() - t) * 1000); emit('retrieval', f'BM25: {len(bm)} candidates')
    t = time.perf_counter()
    q = _state['enc'].encode([C.DENSE_QUERY_PREFIX + query], normalize_embeddings=True, convert_to_numpy=True)[0].astype(np.float32)
    s = _state['V'] @ q; top = np.argpartition(-s, C.CANDIDATES_K)[:C.CANDIDATES_K]; top = top[np.argsort(-s[top])]
    dense = [_state['chunk_ids'][i] for i in top]
    T['dense_ms'] = round((time.perf_counter() - t) * 1000); emit('retrieval', f'E5 dense: {len(dense)} candidates')
    fused = rrf(bm, dense)
    if C.UPLOADS_IN_SEARCH:
        from . import ingest
        if ingest.has_uploads():   # uploaded judgments: own BM25 + Qdrant lists join the same RRF; skipped entirely when none exist
            t = time.perf_counter(); ub, ud = ingest.search(query, q, C.CANDIDATES_K)
            fused = rrf_many([bm, dense, ub, ud])
            T['uploads_ms'] = round((time.perf_counter() - t) * 1000); emit('retrieval', f'uploaded judgments: {len(ub)} BM25 + {len(ud)} Qdrant candidates')
    t = time.perf_counter()
    tx = _texts(fused[:C.RERANK_POOL])
    pool = [c for c in fused[:C.RERANK_POOL] if c in tx]
    scores = _state['ce'].predict([(query, tx[c][0]) for c in pool], batch_size=16, show_progress_bar=False) if pool else []
    ranked = [c for _, c in sorted(zip(scores, pool), key=lambda x: -x[0])] + fused[C.RERANK_POOL:]
    T['rerank_ms'] = round((time.perf_counter() - t) * 1000); emit('reranking', f'bge-reranker rescored {len(pool)} passages')
    final, para = ranked, {}
    if C.RANK_MODE == 'indoc':
        t = time.perf_counter(); docs = []
        for c in ranked:
            d = c.rsplit('_chunk_', 1)[0]
            if d not in docs:
                docs.append(d)
        cand = [(c, di) for di, d in enumerate(docs[:C.INDOC_JUDGMENTS]) for c in _doc_chunks(d)]
        tx2 = _texts([c for c, _ in cand])
        cand = [(c, di) for c, di in cand if c in tx2]
        sc2 = _state['ce'].predict([(query, tx2[c][0][:C.INDOC_CHARS]) for c, _ in cand], batch_size=16, show_progress_bar=False) if cand else []
        prior = sorted(zip(cand, sc2), key=lambda x: -(x[1] + C.DOCPRIOR_WEIGHT / (x[0][1] + 1)))
        para = {c: float(s_ + C.DOCPRIOR_WEIGHT / (di + 1)) for (c, di), s_ in prior}
        head = [c for (c, _), _ in prior]
        final = head + [c for c in ranked if c not in set(head)]
        T['indoc_ms'] = round((time.perf_counter() - t) * 1000)
        emit('selection', f'paragraph rerank inside top {C.INDOC_JUDGMENTS} judgments: {len(cand)} paragraphs scored')
    return {'chunks': final[:100], 'bm25': bm[:20], 'dense': dense[:20], 'paragraph_scores': para, 'timings': T}
