"""One research run = retrieval -> evidence -> generation -> claim verification -> gate, persisted to SQLite as it goes.
Runs execute one at a time on a worker thread (models are large; the laptop has no GPU)."""
from __future__ import annotations
import json, queue, sqlite3, threading, time, traceback, uuid
from datetime import datetime, timezone
from . import config as C, retrieval as R, generation as G
from .frozen import structured_citations as SC

_q: "queue.Queue[str]" = queue.Queue()


def db():
    con = sqlite3.connect(C.DB_PATH, check_same_thread=False, timeout=30); con.row_factory = sqlite3.Row; return con


def init_db():
    con = db(); con.executescript(open(C.ROOT / 'backend/app/schema.sql', encoding='utf-8').read()); con.commit()
    # runs interrupted by a server restart are marked, never silently re-run
    if 'agent' not in [r[1] for r in con.execute('PRAGMA table_info(research_runs)')]:
        con.execute('ALTER TABLE research_runs ADD COLUMN agent TEXT')  # agent trace (tasks, coverage, follow-ups, node trace)
    con.execute("UPDATE research_runs SET status='interrupted' WHERE status IN ('queued','running')"); con.commit()


def event(run_id, stage, msg):
    con = db(); con.execute('INSERT INTO run_events VALUES (?,?,?,?)', (run_id, time.time(), stage, msg))
    con.execute('UPDATE research_runs SET stage=? WHERE run_id=?', (stage, run_id)); con.commit()


def submit(question: str) -> str:
    run_id = uuid.uuid4().hex[:12]
    con = db()
    con.execute('INSERT INTO research_runs (run_id, created_at, question, status, stage, config) VALUES (?,?,?,?,?,?)',
                (run_id, datetime.now(timezone.utc).isoformat(), question, 'queued', 'queued', json.dumps(C.SELECTED)))
    con.commit(); event(run_id, 'queued', f'queued (position {_q.qsize() + 1})'); _q.put(run_id)
    return run_id


def _run(run_id):
    con = db(); q = con.execute('SELECT question FROM research_runs WHERE run_id=?', (run_id,)).fetchone()['question']
    con.execute("UPDATE research_runs SET status='running' WHERE run_id=?", (run_id,)); con.commit()
    emit = lambda s, m: event(run_id, s, m); T = {}; t0 = time.perf_counter()
    try:
        emit('query', 'normalising question (Unicode NFC)')
        import unicodedata
        q = unicodedata.normalize('NFC', ' '.join(q.split()))
        from . import qtranslate
        qi = qtranslate.to_marathi(q) if qtranslate.language(q) != 'mr' else {'original': q, 'language': 'mr', 'used': q, 'translated': False}
        if qi['language'] != 'mr':
            emit('query', f"{'English' if qi['language'] == 'en' else 'mixed-script'} question: {qi.get('reason')}"
                 + (f" -> {qi['used'][:120]}" if qi['translated'] else ''))
        q = unicodedata.normalize('NFC', qi['used'])
        if not R.ready():
            emit('loading', 'loading retrieval models (first request only)')
        R.load(lambda m: emit('loading', m))
        if C.ARCHITECTURE == 'agentic':
            return _run_agent(run_id, q, emit, T, t0, qi)
        ret = R.retrieve(q, emit); T.update(ret['timings'])
        tx = R._texts(ret['chunks'][:40])   # corpus registry + uploaded judgments
        ev, seen = [], set()
        for c in ret['chunks']:
            if c in seen or c not in tx:
                continue
            seen.add(c)
            ev.append({'document_id': tx[c][1], 'judgment_id': None, 'chunk_id': c, 'judgment_title': None, 'page_start': None, 'page_end': None,
                       'original_passage': tx[c][0][:C.PASSAGE_CHARS], 'retrieval_rank': len(ev) + 1})
            if len(ev) == C.TOP_N:
                break
        ev = SC.assign_evidence_ids(run_id, ev)
        con = db()
        for e in ev:
            con.execute('INSERT OR REPLACE INTO run_evidence VALUES (?,?,?,?,?,?,?)', (run_id, e['evidence_id'], e['retrieval_rank'], e['chunk_id'],
                        e['document_id'], e['original_passage'], ret['paragraph_scores'].get(e['chunk_id'])))
        con.commit(); emit('evidence', f'{len(ev)} passages selected from {len({e["document_id"] for e in ev})} judgments')
        if C.LOW_MEMORY:
            R.release_models(); emit('evidence', 'low-memory mode: retrieval models released before generation')
        out = G.answer(q, ev, emit); T.update(out['timings'])
        con = db()
        for i, r in enumerate(out['reviews']):
            con.execute('INSERT OR REPLACE INTO run_claims VALUES (?,?,?,?,?,?)', (run_id, i, r['claim'], json.dumps(r.get('cited', [])), int(r['supported']), r['reason']))
        T['total_ms'] = round((time.perf_counter() - t0) * 1000)
        con.execute('UPDATE research_runs SET status=?, stage=?, outcome=?, answer=?, citations=?, raw_answer=?, gate=?, timings=? WHERE run_id=?',
                    ('done', 'done', out['outcome'], out['final']['answer'], json.dumps(out['final'].get('citations') or []),
                     out['raw'], json.dumps(out['gate']), json.dumps(T), run_id))
        con.commit(); emit('done', out['outcome'])
    except Exception as exc:
        db().execute("UPDATE research_runs SET status='error', error=?, timings=? WHERE run_id=?",
                     (f'{type(exc).__name__}: {exc}'[:500], json.dumps(T), run_id)).connection.commit()
        emit('error', f'{type(exc).__name__}: {exc}'[:300]); traceback.print_exc()


def _run_agent(run_id, q, emit, T, t0, qi=None):
    from . import agent
    out = agent.run(q, emit); T.update(out['timings'])
    if qi:
        out['agent']['query_translation'] = qi   # original question, Marathi translation, validation result
    con = db()
    for e in out['evidence']:
        con.execute('INSERT OR REPLACE INTO run_evidence VALUES (?,?,?,?,?,?,?)', (run_id, e['evidence_id'], e['retrieval_rank'], e['chunk_id'],
                    e['document_id'], e['original_passage'], None))
    for i, r in enumerate(out['reviews']):
        con.execute('INSERT OR REPLACE INTO run_claims VALUES (?,?,?,?,?,?)', (run_id, i, r['claim'], json.dumps(r.get('cited', [])), int(r['supported']), r['reason']))
    T['total_ms'] = round((time.perf_counter() - t0) * 1000)
    con.execute('UPDATE research_runs SET status=?, stage=?, outcome=?, answer=?, citations=?, raw_answer=?, gate=?, timings=?, agent=? WHERE run_id=?',
                ('done', 'done', out['outcome'], out['final']['answer'], json.dumps(out['final'].get('citations') or []), out['raw'],
                 json.dumps(out['gate']), json.dumps(T), json.dumps(out['agent'], ensure_ascii=False), run_id))
    con.commit()
    if qi and qi.get('language') == 'en' and out['outcome'] == 'answered' and out['final'].get('answer'):
        from . import qtranslate
        emit('translation', 'translating the verified Marathi answer into English (reading copy)')
        en = qtranslate.answer_to_english(out['final']['answer'])
        if en:
            con.execute('INSERT OR REPLACE INTO run_translations VALUES (?,?,?,?,?)', (run_id, 'en', en, C.GEN_MODEL, datetime.now(timezone.utc).isoformat()))
            con.commit()
        else:
            emit('translation', 'English copy rejected (citation markers changed); Marathi answer shown')
    emit('done', out['outcome'])


def worker():
    while True:
        _run(_q.get())


def start():
    init_db(); threading.Thread(target=worker, daemon=True).start()
