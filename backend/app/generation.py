"""Validated generation, claim verification and abstention gate - ported from k06_fix2.py (the K10a final-test pipeline).
Prompts, schemas, segmentation (claim_split v2), the VERIFY prompt, the abstention sentence and the deterministic case gate
are copied verbatim; only the I/O around them changed (one question at a time, progress callbacks)."""
from __future__ import annotations
import json, re, sqlite3, time, urllib.request
from . import config as C
from .frozen.prompt import build_prompt
from .frozen import structured_citations as SC

VERIFY = ("Decide whether the CLAIM is fully supported by the EVIDENCE passages (which may contain PDF-extraction errors). "
          "Supported means every fact in the claim is stated in, or directly follows from, the evidence. Return only the JSON object.\n\n"
          "CLAIM:\n{c}\n\nEVIDENCE:\n{e}\n\nJSON response:")
ABSTAIN = 'उपलब्ध पुराव्यांमध्ये या प्रश्नाचे विश्वासार्ह उत्तर आढळले नाही.'
_DEVD = str.maketrans('०१२३४५६७८९', '0123456789')
_NUM = re.compile(r'(\d{1,6})\s*(?:/|of|च्या|सन)\s*(\d{4})')
_STOP = set('आणि इतर इत्यादी व विरुद्ध यांच्या यांच्यातील या खटल्यात खटल्यामध्ये प्रकरणात प्रकरणामध्ये याचिकेत याचिकेमध्ये मध्ये श्री श्रीमती सौ राज्य महाराष्ट्र सरकार शासन कंपनी लिमिटेड लि मर्यादित संस्था मंडळ'.split())
_skel = lambda w: re.sub(r'[ऺ-ॏ॑-ॗॢॣऀ-ः\s]', '', w)


class GenerationError(RuntimeError):
    pass


def api(path, body=None, timeout=C.OLLAMA_TIMEOUT_S):
    req = urllib.request.Request(C.OLLAMA_URL.rstrip('/') + path, data=json.dumps(body, ensure_ascii=False).encode() if body is not None else None,
                                 headers={'Content-Type': 'application/json'})
    return json.loads(urllib.request.urlopen(req, timeout=timeout).read())


def model_status():
    try:
        tags = api('/api/tags', timeout=5)['models']
        m = next((t for t in tags if t['name'] == C.GEN_MODEL), None)
        return {'ollama': 'up', 'model': C.GEN_MODEL, 'available': bool(m), 'digest': m and m['digest']}
    except Exception as exc:
        return {'ollama': 'down', 'model': C.GEN_MODEL, 'available': False, 'error': type(exc).__name__}


def gen(prompt, schema, npred, ctx=C.NUM_CTX, T=C.TEMPERATURE):
    body = {'model': C.GEN_MODEL, 'prompt': prompt, 'stream': False, 'keep_alive': '30m', 'format': schema,
            'options': {'temperature': T, 'num_predict': npred, 'num_ctx': ctx, 'seed': C.SEED}}
    if C.GEN_MODEL.startswith('qwen3') and 'instruct' not in C.GEN_MODEL:
        body['think'] = False
    try:
        return api('/api/generate', body)
    except Exception as exc:
        raise GenerationError(f'{type(exc).__name__}: {exc}'[:300])


def head2(docs):
    con = sqlite3.connect(C.DB_PATH); out = {}
    for d in docs:
        if d.startswith('up_'):   # uploaded judgment: ACPMC puts the caption in chunk 0000
            from . import ingest
            rows = [(t,) for t, _ in ingest.texts([d + '_chunk_0000', d + '_chunk_0001']).values()]
        else:
            rows = con.execute("SELECT text FROM chunks WHERE document_id=? AND chunk_id IN (?, ?)", (d, d + '_chunk_0000', d + '_chunk_0001')).fetchall()
        out[d] = ' ' + ' '.join((r[0] or '').translate(_DEVD).replace('\n', ' ') for r in rows)
    return out


def det_gate(question, docs):
    h = head2(docs); qn = question.translate(_DEVD); nums = {(a.lstrip('0'), y) for a, y in _NUM.findall(qn)}
    if nums and not any(re.search(r'(?<!\d)0*' + re.escape(a) + r'(?!\d)', h.get(d, '')) and y in h.get(d, '') for d in docs for a, y in nums):
        return True, 'case_number_not_in_retrieved_judgments'
    if 'विरुद्ध' in qn:
        left, right = qn.split('विरुद्ध', 1)
        side = lambda s: [_skel(w) for w in re.findall(r'[ऀ-ॿ]{3,}', s) if w not in _STOP and len(_skel(w)) >= 3]
        L, Rt = side(left)[-3:], side(right)[:3]
        if L and Rt and not any(any(w in _skel(h.get(d, '')) for w in L) and any(w in _skel(h.get(d, '')) for w in Rt) for d in docs):
            return True, 'party_names_not_in_retrieved_judgments'
    return False, None


def split_claims(answer):  # claim_split v2, verbatim from k06_fix2.py
    _txt = re.sub(r'([।.!?])(\s*)((?:\[E\d{3}\][ \t]*)+)', lambda mm: ' ' + mm.group(3).strip() + mm.group(1) + ' ', answer or '')
    _cl = []
    for _s in re.split(r'(?<=[।.!?])\s+|\n+', _txt):
        _s = _s.strip()
        if not _s:
            continue
        if re.fullmatch(r'(?:\[E\d{3}\][ \t]*)+[\s।.!?,;:]*', _s):
            if _cl:
                _cl[-1] = _cl[-1] + ' ' + ' '.join(re.findall(r'\[E\d{3}\]', _s))
            continue
        _cl.append(_s)
    return _cl


def answer(question, ev, emit=lambda s, m: None):
    """ev: evidence records with evidence_id/original_passage. Returns raw, verified and final (gated) answers + reviews."""
    T = {}; t = time.perf_counter()
    emit('generation', f'{C.GEN_MODEL} is writing a cited answer from {len(ev)} passages')
    r = gen(build_prompt(question, ev), SC.output_schema(ev), C.NUM_PREDICT)
    raw = r.get('response'); parsed = SC.parse_structured_response(raw or '', ev) if raw else None
    T['generation_ms'] = round((time.perf_counter() - t) * 1000)
    reviews, keep = [], []
    if C.VERIFY and parsed and parsed.get('schema_valid') and parsed.get('citations'):
        by = {e['evidence_id']: e for e in ev}; cls = split_claims(parsed['answer']); t = time.perf_counter()
        for i, cl in enumerate(cls, 1):
            ids = [x for x in re.findall(r'\[(E\d{3})\]', cl) if x in by] or [x for x in parsed['citations'] if x in by]
            if not ids:
                reviews.append({'claim': cl, 'supported': False, 'cited': [], 'reason': 'no_citation'}); continue
            emit('verification', f'checking claim {i}/{len(cls)} against {", ".join(ids)}')
            vr = gen(VERIFY.format(c=cl, e='\n\n'.join(f"[{x}] {by[x]['original_passage']}" for x in ids)),
                     {'type': 'object', 'properties': {'supported': {'type': 'boolean'}}, 'required': ['supported']}, 30, 8192, 0.0)
            ok = bool(json.loads(vr.get('response') or '{}').get('supported'))
            reviews.append({'claim': cl, 'supported': ok, 'cited': ids, 'reason': 'verified' if ok else 'not_supported_by_cited_evidence'})
            if ok:
                keep.append(cl if re.search(r'\[E\d{3}\]', cl) else cl.rstrip('।. ') + ' ' + ' '.join(f'[{x}]' for x in ids) + '.')
        T['verification_ms'] = round((time.perf_counter() - t) * 1000)
    elif not C.VERIFY and parsed:
        keep = [parsed.get('answer') or '']
    kept_ids = sorted({x for c in keep for x in re.findall(r'\[(E\d{3})\]', c)})
    verified = SC.parse_structured_response(json.dumps({'answer': ' '.join(keep) if keep else ABSTAIN, 'citations': kept_ids}, ensure_ascii=False), ev)
    blocked, why = det_gate(question, [e['document_id'] for e in ev]) if C.GATE == 'det' else (False, None)
    emit('gate', 'case gate: abstain - ' + why if blocked else 'case gate: retrieved judgments match the question')
    final = SC.parse_structured_response(json.dumps({'answer': ABSTAIN, 'citations': []}, ensure_ascii=False), ev) if blocked else verified
    if final['answer'] == ABSTAIN:
        outcome = 'abstained_gate' if blocked else ('abstained_no_verified_claim' if parsed and parsed.get('schema_valid') else 'abstained_invalid_output')
    else:
        outcome = 'answered'
    return {'raw': raw, 'parsed': parsed, 'final': final, 'reviews': reviews, 'gate': {'blocked': blocked, 'reason': why, 'mode': C.GATE},
            'outcome': outcome, 'timings': T}
