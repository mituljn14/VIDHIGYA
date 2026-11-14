"""Production wiring of the VIDHIGYA LangGraph agent (vidhigya_agent.py, byte-identical to the experiment copy).
Tools = the production validated retrieval (retrieval.retrieve, in-judgment ranking), the registry (SQLite text), Ollama,
the frozen prompt / structured citations, claim_split v2 and the deterministic case gate. Every agent step is emitted as a
run event (SSE to the UI) and the full trace is stored with the run."""
from __future__ import annotations
import json, sqlite3
from . import config as C, retrieval as R, generation as G
from .frozen import structured_citations as SC
from .frozen.prompt import build_prompt
from . import vidhigya_agent as AG


def _text(cid):
    if cid.startswith('up_'):   # uploaded judgment
        r = R._texts([cid]).get(cid)
        return (r[0] or '', r[1]) if r else ('', cid.rsplit('_chunk_', 1)[0])
    r = sqlite3.connect(C.DB_PATH).execute('SELECT text, document_id FROM chunks WHERE chunk_id=?', (cid,)).fetchone()
    return (r[0] or '', r[1]) if r else ('', cid.rsplit('_chunk_', 1)[0])


def _llm(prompt, schema, npred, ctx, T):
    return G.gen(prompt, schema, npred, ctx, T).get('response')


def run(question: str, emit) -> dict:
    tools = AG.Tools(retrieve=lambda q: R.retrieve(q, lambda s, m: None)['chunks'], text=_text, llm=_llm, build_prompt=build_prompt, sc=SC,
                     det_gate=G.det_gate, split_claims=G.split_claims, emit=emit)
    cfg = AG.AgentConfig(pool_max=C.AGENT_POOL_MAX, passage_chars=C.PASSAGE_CHARS, max_followup=C.AGENT_MAX_FOLLOWUP,
                         followup=C.AGENT_FOLLOWUP, verify=C.VERIFY, gate=C.GATE == 'det', num_ctx=C.NUM_CTX, num_predict=C.NUM_PREDICT)
    st = AG.run(AG.build(tools, cfg), question)
    ev = [dict(p, retrieval_rank=i + 1) for i, p in enumerate(st['pool'])]
    return {'evidence': ev, 'raw': st.get('raw'), 'final': st['final'], 'reviews': st.get('reviews') or [], 'gate': st.get('gate'),
            'outcome': st['outcome'], 'timings': {k.replace('_s', '_ms'): round(v * 1000) for k, v in (st.get('timings') or {}).items()},
            'agent': {'tasks': st['tasks'], 'analysis': st.get('analysis'), 'coverage': st.get('coverage'), 'followup_rounds': st.get('followup_rounds', 0),
                      'retrievals': st.get('retrievals'), 'llm_calls': st.get('llm_calls'),
                      'pool': [{k: p.get(k) for k in ('evidence_id', 'chunk_id', 'document_id', 'origin')} for p in st['pool']], 'trace': st.get('trace')}}
