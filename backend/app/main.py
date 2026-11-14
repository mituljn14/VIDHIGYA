"""VIDHIGYA_AI_PROD API (FastAPI). All answers come from the validated pipeline; evaluation numbers are read from the
research result files at request time (never hard-coded)."""
from __future__ import annotations
import os
os.environ.setdefault('HF_HUB_OFFLINE', '1')  # cached models only: no network checks at start-up
import asyncio, csv, json, os, threading
from pathlib import Path
from datetime import datetime, timezone
from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from . import config as C, pipeline as P, retrieval as R, generation as G, ingest as U, auth as A

app = FastAPI(title='VIDHIGYA API', version='1.0.0', description='Evidence-grounded Marathi legal research (validated K10a configuration).')
app.add_middleware(CORSMiddleware, allow_origins=os.environ.get('CORS_ORIGINS', 'http://localhost:5173').split(','), allow_methods=['*'], allow_headers=['*'])


@app.on_event('startup')
def _startup():
    P.start(); U.start()
    if os.environ.get('PRELOAD', '1') == '1':
        threading.Thread(target=R.load, daemon=True).start()


class ResearchIn(BaseModel):
    question: str = Field(min_length=5, max_length=2000)


def _run_json(run_id):
    con = P.db(); r = con.execute('SELECT * FROM research_runs WHERE run_id=?', (run_id,)).fetchone()
    if not r:
        raise HTTPException(404, 'run not found')
    d = dict(r)
    for k in ('citations', 'gate', 'config', 'timings', 'agent'):
        d[k] = json.loads(d[k]) if d.get(k) else None
    ev = [dict(x) for x in con.execute('SELECT * FROM run_evidence WHERE run_id=? ORDER BY rank', (run_id,))]
    meta = {m['document_id']: dict(m) for m in con.execute(
        f"SELECT * FROM judgments WHERE document_id IN ({','.join('?' * len(ev))})", [e['document_id'] for e in ev])} if ev else {}
    for e in ev:
        if e['document_id'].startswith('up_') and e['document_id'] not in meta:
            meta[e['document_id']] = U.judgment(e['document_id'])
    for e in ev:
        e['judgment'] = meta.get(e['document_id'])
    d['evidence'] = ev
    d['claims'] = [dict(x, cited=json.loads(x['cited'])) for x in con.execute('SELECT * FROM run_claims WHERE run_id=? ORDER BY idx', (run_id,))]
    d['events'] = [dict(x) for x in con.execute('SELECT ts, stage, message FROM run_events WHERE run_id=? ORDER BY ts', (run_id,))]
    return d


@app.get('/api/health')
def health():
    con = P.db()
    return {'status': 'ok', 'retrieval_ready': R.ready(), 'retrieval': R._state.get('status'), 'generator': G.model_status(),
            'registry': {'judgments': con.execute('SELECT COUNT(*) FROM judgments').fetchone()[0], 'chunks': con.execute('SELECT COUNT(*) FROM chunks').fetchone()[0]},
            'configuration': C.SELECTED, 'validated_generator': C.VALIDATED_MODEL, 'using_validated_generator': C.GEN_MODEL == C.VALIDATED_MODEL}


@app.post('/api/research', status_code=202)
def research(body: ResearchIn):
    return {'run_id': P.submit(body.question)}


NON_CHAT = ('embed', 'bge-', 'moondream', 'vl:', 'coder')   # embedding, vision and code models cannot run the agent


@app.get('/api/models')
def models():
    """LLM-agnostic generator choice: every chat model installed in the local Ollama, the active one, and the validated one."""
    try:
        tags = G.api('/api/tags', timeout=5)['models']
    except Exception as exc:
        raise HTTPException(503, f'Ollama not reachable: {type(exc).__name__}')
    out = [{'name': t['name'], 'size_gb': round(t['size'] / 1e9, 1), 'family': (t.get('details') or {}).get('family'),
            'parameters': (t.get('details') or {}).get('parameter_size'), 'validated': t['name'] == C.VALIDATED_MODEL}
           for t in tags if not any(x in t['name'] for x in NON_CHAT)]
    return {'active': C.GEN_MODEL, 'validated': C.VALIDATED_MODEL, 'models': sorted(out, key=lambda m: (not m['validated'], -m['size_gb']))}


class ModelChoice(BaseModel):
    model: str


@app.post('/api/models/select')
def select_model(body: ModelChoice):
    """Switch the generator for NEW questions. Refused while a question is queued or running, so no answer mixes two models."""
    names = {m['name'] for m in models()['models']}
    if body.model not in names:
        raise HTTPException(404, f'model {body.model} is not installed in Ollama (install it with: ollama pull {body.model})')
    busy = P.db().execute("SELECT COUNT(*) FROM research_runs WHERE status IN ('queued','running')").fetchone()[0]
    if busy:
        raise HTTPException(409, f'{busy} question(s) still running; switch the model after they finish')
    C.GEN_MODEL = body.model; C.SELECTED['generator'] = body.model
    C.LLM_CHOICE_FILE.parent.mkdir(parents=True, exist_ok=True)
    json.dump({'model': body.model, 'chosen_at': datetime.now(timezone.utc).isoformat()}, open(C.LLM_CHOICE_FILE, 'w', encoding='utf-8'))
    return {'active': C.GEN_MODEL, 'validated': C.GEN_MODEL == C.VALIDATED_MODEL}


@app.delete('/api/research/{run_id}')
def delete_run(run_id: str):
    """Delete one question from the history: the run and its evidence, claim checks, events and translations (owner request
    2026-11-14). A queued or running question cannot be deleted (it is still being worked on)."""
    con = P.db(); r = con.execute('SELECT status FROM research_runs WHERE run_id=?', (run_id,)).fetchone()
    if not r:
        raise HTTPException(404, 'question not found')
    if r['status'] in ('queued', 'running'):
        raise HTTPException(409, 'this question is still running; delete it after it finishes')
    for t in ('run_evidence', 'run_claims', 'run_events', 'run_translations', 'research_runs'):
        con.execute(f'DELETE FROM {t} WHERE run_id=?', (run_id,))
    con.commit()
    return {'deleted': run_id}


@app.get('/api/research')
def history(saved: bool = False, limit: int = 50):
    con = P.db(); w = 'WHERE saved=1' if saved else ''
    return [dict(r) for r in con.execute(f'SELECT run_id, created_at, question, status, stage, outcome, saved FROM research_runs {w} ORDER BY created_at DESC LIMIT ?', (limit,))]


@app.get('/api/research/{run_id}')
def get_run(run_id: str):
    return _run_json(run_id)


@app.get('/api/research/{run_id}/events')
async def events(run_id: str):
    async def gen():
        seen = 0
        while True:
            con = P.db(); ev = con.execute('SELECT ts, stage, message FROM run_events WHERE run_id=? ORDER BY ts', (run_id,)).fetchall()
            for e in ev[seen:]:
                yield f"data: {json.dumps(dict(e), ensure_ascii=False)}\n\n"
            seen = len(ev)
            st = con.execute('SELECT status FROM research_runs WHERE run_id=?', (run_id,)).fetchone()
            if not st or st[0] in ('done', 'error', 'interrupted'):
                yield 'event: end\ndata: {}\n\n'; return
            await asyncio.sleep(1)
    return StreamingResponse(gen(), media_type='text/event-stream')


@app.post('/api/research/{run_id}/save')
def save(run_id: str, saved: bool = True):
    con = P.db(); con.execute('UPDATE research_runs SET saved=? WHERE run_id=?', (int(saved), run_id)); con.commit(); return {'saved': saved}


LANGS = {'en': 'English', 'mr': 'Marathi (Devanagari script)', 'hi': 'Hindi (Devanagari script)'}
TRANSLATE = ("Translate the legal research answer below into {lang}. Keep every citation marker such as [E001] exactly as written and "
             "in the same place. Do not add, remove, explain or soften any information; keep legal terms precise. "
             "Return only the JSON object.\n\nANSWER:\n{a}\n\nJSON response:")


@app.post('/api/research/{run_id}/translate')
def translate(run_id: str, lang: str):
    """Machine translation of the VERIFIED answer for reading only. The original answer stays authoritative; a translation is
    rejected unless it carries exactly the same citation markers. Cached per run and language."""
    import re
    from datetime import datetime, timezone
    if lang not in LANGS:
        raise HTTPException(400, 'lang must be one of ' + ', '.join(LANGS))
    con = P.db(); hit = con.execute('SELECT text, model FROM run_translations WHERE run_id=? AND lang=?', (run_id, lang)).fetchone()
    if hit:
        return {'lang': lang, 'text': hit['text'], 'model': hit['model'], 'cached': True}
    r = con.execute('SELECT answer, status FROM research_runs WHERE run_id=?', (run_id,)).fetchone()
    if not r or r['status'] != 'done' or not r['answer']:
        raise HTTPException(409, 'the research run has no finished answer to translate')
    marks = lambda t: sorted(re.findall(r'\[E\d{3}\]', t or ''))
    try:
        out = json.loads(G.gen(TRANSLATE.format(lang=LANGS[lang], a=r['answer']), {'type': 'object', 'properties': {'translation': {'type': 'string'}},
                               'required': ['translation']}, 1024, 8192, 0.0).get('response') or '{}').get('translation') or ''
    except Exception as exc:
        raise HTTPException(503, f'translation model unavailable: {type(exc).__name__}')
    if not out.strip() or marks(out) != marks(r['answer']):
        raise HTTPException(422, 'translation rejected: citation markers changed or empty output')
    con.execute('INSERT OR REPLACE INTO run_translations VALUES (?,?,?,?,?)', (run_id, lang, out, C.GEN_MODEL, datetime.now(timezone.utc).isoformat())); con.commit()
    return {'lang': lang, 'text': out, 'model': C.GEN_MODEL, 'cached': False}


@app.get('/api/research/{run_id}/export', response_class=PlainTextResponse)
def export(run_id: str):
    d = _run_json(run_id)
    L = [f"# VIDHIGYA research report", '', f"**Question:** {d['question']}", f"**Run:** {d['run_id']}  ·  {d['created_at']}  ·  outcome: {d['outcome']}",
         f"**Configuration:** {json.dumps(d['config'], ensure_ascii=False)}", '', '## Answer', '', d['answer'] or '(no answer)', '', '## Evidence']
    for e in d['evidence']:
        j = e.get('judgment') or {}
        L += ['', f"### [{e['evidence_id']}] {j.get('case_title') or e['document_id']}", f"{j.get('court', '')} · {j.get('case_number', '')} · {j.get('decision_date', '')} · chunk {e['chunk_id']}", '', e['passage']]
    L += ['', '## Claim verification', ''] + [f"- {'SUPPORTED' if c['supported'] else 'REMOVED'} ({c['reason']}; cites {', '.join(c['cited']) or '-'}): {c['claim']}" for c in d['claims']]
    L += ['', '_Automatic evidence-grounded research output. Not legal advice; verify against the cited judgments._']
    return '\n'.join(L)


@app.get('/api/judgments/{doc}')
def judgment(doc: str):
    if doc.startswith('up_'):
        j = U.judgment(doc)
        if not j:
            raise HTTPException(404, 'judgment not found')
        ch = [dict(r) for r in U.db().execute('SELECT chunk_id, chunk_index, text FROM upload_chunks WHERE document_id=? ORDER BY chunk_id', (doc,))]
        return {'judgment': j, 'chunks': ch, 'pdf_available': (Path(C.UPLOADS_DIR) / 'pdfs' / f'{doc}.pdf').exists()}
    con = P.db(); j = con.execute('SELECT * FROM judgments WHERE document_id=?', (doc,)).fetchone()
    if not j:
        raise HTTPException(404, 'judgment not found')
    ch = [dict(r) for r in con.execute('SELECT chunk_id, chunk_index, text FROM chunks WHERE document_id=? ORDER BY chunk_id', (doc,))]
    return {'judgment': dict(j), 'chunks': ch, 'pdf_available': (Path(C.PDF_DIR) / (j['file_name'] or '_')).exists()}


@app.get('/api/judgments/{doc}/pdf')
def judgment_pdf(doc: str):
    if doc.startswith('up_'):
        p = Path(C.UPLOADS_DIR) / 'pdfs' / f'{doc}.pdf'
        if not U.judgment(doc) or not p.exists():
            raise HTTPException(404, 'PDF not available')
        return FileResponse(p, media_type='application/pdf')
    j = P.db().execute('SELECT file_name FROM judgments WHERE document_id=?', (doc,)).fetchone()
    p = Path(C.PDF_DIR) / (j['file_name'] if j else '_')
    if not j or not p.exists():
        raise HTTPException(404, 'PDF not available')
    return FileResponse(p, media_type='application/pdf')


@app.get('/api/judgments')
def search_judgments(q: str = '', limit: int = 30):
    con = P.db(); like = f'%{q}%'
    return [dict(r) for r in con.execute('SELECT document_id, case_title, case_number, court, decision_date, language FROM judgments '
                                         'WHERE case_title LIKE ? OR case_number LIKE ? OR document_id LIKE ? ORDER BY decision_date DESC LIMIT ?', (like, like, like, limit))]


def admin(authorization: str | None = Header(default=None)):
    """Upload side requires the admin session token (POST /api/uploads/login)."""
    if not A.configured():
        raise HTTPException(503, 'upload admin password is not set on the server (python -m app.auth set)')
    if not A.check(authorization):
        raise HTTPException(401, 'admin login required')


class LoginIn(BaseModel):
    password: str = Field(min_length=1, max_length=200)


@app.post('/api/uploads/login')
def upload_login(body: LoginIn, request: Request):
    try:
        return {'token': A.login(body.password, request.client.host if request.client else '?'), 'expires_hours': C.ADMIN_SESSION_HOURS}
    except RuntimeError as exc:
        raise HTTPException(503, str(exc))
    except PermissionError as exc:
        raise HTTPException(401, str(exc))


@app.post('/api/uploads/logout')
def upload_logout(authorization: str | None = Header(default=None)):
    A.logout(authorization); return {'logged_out': True}


@app.post('/api/uploads', status_code=202, dependencies=[Depends(admin)])
async def upload(file: UploadFile = File(...)):
    """Upload a judgment PDF. It is processed in the background (text layer -> corruption score -> OCR of damaged pages ->
    chunking -> E5 vectors in Qdrant + BM25) and becomes searchable when its status is 'ready'."""
    data = await file.read()
    try:
        return U.submit(data, file.filename or 'upload.pdf')
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@app.get('/api/uploads', dependencies=[Depends(admin)])
def uploads():
    return U.listing()


@app.get('/api/uploads/{doc}', dependencies=[Depends(admin)])
def upload_status(doc: str):
    j = U.judgment(doc)
    if not j:
        raise HTTPException(404, 'upload not found')
    return j


@app.delete('/api/uploads/{doc}', dependencies=[Depends(admin)])
def upload_delete(doc: str):
    if not doc.startswith('up_') or not U.delete(doc):
        raise HTTPException(404, 'upload not found')
    return {'deleted': doc}


@app.get('/api/experiments')
def experiments():
    """Every experiment: the October manuscript series, the 9-11 Nov series, the current series and the proposed new ones,
    read at request time from the experiment register (VIDHIGYA_FINAL_RESEARCH/12_NOVELTY_AND_EXPERIMENT_REPORT)."""
    p = Path(C.EXPERIMENTS_JSON)
    if not p.exists():
        raise HTTPException(404, 'experiment register not found')
    d = json.load(open(p, encoding='utf-8'))
    keep_p = ('id', 'series', 'title', 'date', 'status', 'data', 'objective', 'method', 'results', 'finding', 'limits', 'why', 'artifact')
    keep_n = ('id', 'group', 'title', 'status', 'priority', 'problem', 'hypothesis', 'method', 'metrics', 'why', 'compute', 'human', 'result')
    # superseded (HIST) and invalid/failed (INV) experiments are hidden from the page on owner request (2026-11-14);
    # they stay in the experiment register and the research report as evidence
    HIDE = ('HIST', 'INV')
    prior = [x for x in d['PRIOR'] if str(x.get('status', '')).upper() not in HIDE]
    return {'status_legend': {k: v for k, v in d['STATUS'].items() if k not in HIDE}, 'previous': [{k: x.get(k) for k in keep_p} for x in prior],
            'hidden': {s: sum(1 for x in d['PRIOR'] if str(x.get('status', '')).upper() == s) for s in HIDE},
            'proposed': [{k: x.get(k) for k in keep_n} for x in d['NEW']], 'source': str(p.name), 'updated': p.stat().st_mtime,
            'label': 'Accuracy figures are automatic 3-LLM-judge majorities, not human legal review.'}


def _read_csv(p):
    return list(csv.DictReader(open(p, encoding='utf-8'))) if p.exists() else None


@app.get('/api/evaluation')
def evaluation():
    """Research results, read from the result files. 'final' if the final scoring has run, else 'provisional'."""
    R0 = Path(C.RESULTS_DIR); fin = R0 / '08_IMPROVEMENT_EXPERIMENTS/final/results_final'
    src = fin if (fin / 'final_summary.json').exists() else R0 / '08_IMPROVEMENT_EXPERIMENTS/final/results_provisional'
    out = {'status': 'final' if src == fin else 'provisional', 'label': 'Automatic 3-LLM-judge majority; not human legal review.'}
    if (src / 'final_summary.json').exists():
        S = json.load(open(src / 'final_summary.json', encoding='utf-8'))
        keys = ['B_FROZEN_live|dev|mr', 'B_FROZEN_live|test|mr', 'K6_gemma312b_gated3|dev|mr', 'K6_qwen257b_gated3|dev|mr', 'K6_gemma312b_raw|dev|mr',
                'K6_gemma312b_verified2|dev|mr', 'K10_gemma312b_gated|test|mr', 'K10_qwen257b_gated|test|mr']
        out['systems'] = {k: S['summary'].get(k) for k in keys}; out['judge_agreement'] = S.get('judge_agreement'); out['coverage'] = S.get('coverage')
    mm = R0 / 'METRIC_COMPLETION_MATRIX.csv'
    out['metric_matrix'] = _read_csv(mm) or _read_csv(src / 'METRIC_COMPLETION_MATRIX.csv')
    ret = _read_csv(R0 / '08_IMPROVEMENT_EXPERIMENTS/exp07b/results/exp07_summary.csv') or []
    keep = {'hybrid_prod+ce_mmarco', 'hybrid_e5_clean+bge_reranker_v2m3', 'hybrid_e5_clean+bge_reranker_v2m3|inDoc3+docprior'}
    out['retrieval'] = [r for r in ret if r['config'] in keep and r['subset'] in ('silver_all_mr', 'silver_all_en', 'silver_all_mixed', 'silver_all_mr_paraphrase', 'silver_all_mr_spell')]
    o = R0 / '08_IMPROVEMENT_EXPERIMENTS/exp02_ocr/results_exp02b/exp02b_summary.json'
    out['ocr'] = json.load(open(o, encoding='utf-8'))['paired'] if o.exists() else None
    # agentic: K12 A-F same-model comparison (DEV), the DEV selection record, and the K14 TEST confirmation of the selected arm
    ag = R0 / '08_IMPROVEMENT_EXPERIMENTS/agentic'; sel = ag / 'SELECTION_K12.json'; k14 = ag / 'results_k14_test/report/k14_comparison.json'
    t14 = json.load(open(k14, encoding='utf-8')) if k14.exists() else None
    out['agentic'] = {'dev': _read_csv(ag / 'results_k12/k12_arms.csv') or [], 'selection': json.load(open(sel, encoding='utf-8')) if sel.exists() else None,
                      'test': {k: t14[k] for k in ('test_systems', 'paired_tests', 'n_test_questions')} if t14 else None}
    return out


dist = C.ROOT / 'frontend/dist'
if dist.exists():
    # built React app: static assets + index.html for every client-side route (React Router)
    app.mount('/assets', StaticFiles(directory=dist / 'assets'), name='assets')

    @app.get('/{path:path}', include_in_schema=False)
    def spa(path: str):
        if path.startswith('api/'):
            raise HTTPException(404, 'not found')
        f = dist / path
        if path and f.is_file():
            return FileResponse(f)
        # index.html must never be cached: it names the current hashed bundle, so a stale copy would show an old interface
        return FileResponse(dist / 'index.html', headers={'Cache-Control': 'no-cache, must-revalidate'})
