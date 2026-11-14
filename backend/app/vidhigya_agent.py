"""VIDHIGYA improved bounded agent (LangGraph). Design follows AGENTIC_FAILURE_ANALYSIS.md section 3.

Nodes (all do measurable work; every decision is written to state['trace']):
  understand        LLM (JSON schema): is the question multi-part? -> <= 3 self-contained Marathi sub-questions.
                    Validated: a sub-question may not introduce a number absent from the question and must be Devanagari
                    when the question is; fallback = the original question only. The original question is always kept.
  retrieve          validated EXP07b stack per query (original + each sub-question): BM25 + E5 -> RRF -> bge-reranker
                    -> in-judgment paragraph selection (injected as tools.retrieve).
  build_pool        document-level expansion result merged into ONE bounded evidence pool (<= POOL_MAX passages x
                    PASSAGE_CHARS) by interleaving the per-query rankings (original first); stable IDs E001...
  assess_coverage   LLM (JSON schema, IDs restricted to the pool): per task supported / partial / missing + supporting
                    IDs + what is missing. 'supported'/'partial' without a valid ID is downgraded to 'missing'.
  followup          (conditional) for each task not 'supported': LLM writes one targeted Marathi search query from the
                    gap; retrieve; add up to FOLLOWUP_ADD new passages per task (replacing passages that support no task
                    when the pool is full). <= MAX_FOLLOWUP rounds, <= MAX_RETRIEVALS calls in total.
  synthesize        frozen-B structured citation generation (JSON schema, citations restricted to pool IDs) over the
                    question plus its sub-questions.
  verify            claim_split v2 + per-claim check against exactly the cited passages (validated K06/K10 method).
  gate              fail-closed: abstain if (a) the deterministic case gate blocks, (b) no task is at least partially
                    covered, or (c) no claim survives verification.
Edges: START->understand->retrieve->build_pool->assess_coverage -(gap & budget)-> followup->assess_coverage
       -(else)-> synthesize -> verify -> gate -> END.   (verify/gate skipped for ablation arms via config)
Experiment hook: `checkpoint` is called after the FIRST coverage assessment (arm C = no follow-up) and before synthesis.
"""
from __future__ import annotations
import json, re, time
from dataclasses import dataclass, field
from typing import Any, Callable, TypedDict

DEVA = re.compile(r'[ऀ-ॿ]'); DIGITS = str.maketrans('०१२३४५६७८९', '0123456789')
ABSTAIN = 'उपलब्ध पुराव्यांमध्ये या प्रश्नाचे विश्वासार्ह उत्तर आढळले नाही.'
VERIFY = ("Decide whether the CLAIM is fully supported by the EVIDENCE passages (which may contain PDF-extraction errors). "
          "Supported means every fact in the claim is stated in, or directly follows from, the evidence. Return only the JSON object.\n\n"
          "CLAIM:\n{c}\n\nEVIDENCE:\n{e}\n\nJSON response:")  # verbatim from the validated pipeline
UNDERSTAND = ("You analyse a legal research question about Indian (Maharashtra) court judgments, written in Marathi or mixed script.\n"
              "Decide whether it asks for MORE THAN ONE distinct piece of information (multi-part). If it does, rewrite it as at most 3 "
              "self-contained sub-questions in the same language as the question, each answerable from a court judgment. Do not add any fact, "
              "name, number or date that is not in the question. If it asks for one thing, return is_multi_part=false and an empty list.\n"
              "Return only the JSON object.\n\nQUESTION:\n{q}\n\nJSON response:")
COVERAGE = ("You check whether retrieved court-judgment passages contain the information needed for each research task. Passages may have "
            "PDF-extraction errors. For every task return: status 'supported' (the passages state the needed information), 'partial' (some of it), "
            "or 'missing'; supporting_ids = the passage IDs that contain it (only IDs listed below); missing = a short description of what is "
            "still missing (empty if supported). Do not answer the tasks. Return only the JSON object.\n\nTASKS:\n{t}\n\nPASSAGES:\n{e}\n\nJSON response:")
FOLLOWUP = ("Write ONE short search query (in the language of the task, at most 20 words) to find court-judgment passages containing the "
            "missing information below. Use only names, numbers and legal terms from the task or the missing description. Return only the JSON object.\n\n"
            "TASK:\n{t}\n\nMISSING:\n{m}\n\nJSON response:")


@dataclass
class AgentConfig:
    pool_max: int = 8
    passage_chars: int = 1500
    max_tasks: int = 3
    max_followup: int = 2
    followup_add: int = 2
    max_retrievals: int = 10
    followup: bool = True
    verify: bool = True
    gate: bool = True
    num_ctx: int = 16384
    num_predict: int = 1024


@dataclass
class Tools:
    retrieve: Callable[[str], list[str]]                 # ranked chunk ids (validated stack incl. in-judgment selection)
    text: Callable[[str], tuple[str, str]]               # chunk id -> (passage text, document id)
    llm: Callable[..., str]                              # (prompt, schema, num_predict, num_ctx, temperature) -> raw text
    build_prompt: Callable[[str, list[dict]], str]       # frozen-B prompt
    sc: Any                                              # frozen structured_citations module
    det_gate: Callable[[str, list[str]], tuple[bool, str | None]]
    split_claims: Callable[[str], list[str]]
    emit: Callable[[str, str], None] = lambda stage, msg: None
    checkpoint: Callable[[dict], None] | None = None


class State(TypedDict, total=False):
    question: str; tasks: list[dict]; analysis: dict; rankings: dict; pool: list[dict]; coverage: list[dict]
    followup_rounds: int; retrievals: int; raw: str | None; parsed: dict | None; reviews: list[dict]; kept: list[str]; final: dict
    outcome: str; gate: dict; trace: list[dict]; timings: dict; llm_calls: int


def _t(state, node, **kw):
    state.setdefault('trace', []).append({'node': node, 't': round(time.time(), 2), **kw})


def _json(raw):
    try:
        return json.loads(raw or '{}')
    except json.JSONDecodeError:
        return {}


def build(tools: Tools, cfg: AgentConfig):
    from langgraph.graph import StateGraph, START, END

    def llm(state, *a, **k):
        state['llm_calls'] = state.get('llm_calls', 0) + 1
        return tools.llm(*a, **k)

    def understand(state: State):
        q = state['question']; t0 = time.time(); tools.emit('understand', 'analysing the question and splitting it into research tasks')
        schema = {'type': 'object', 'properties': {'is_multi_part': {'type': 'boolean'}, 'legal_issue': {'type': 'string'},
                  'sub_questions': {'type': 'array', 'items': {'type': 'string'}, 'maxItems': cfg.max_tasks}}, 'required': ['is_multi_part', 'sub_questions']}
        a = _json(llm(state, UNDERSTAND.format(q=q), schema, 400, 4096, 0.0))
        qnums = set(re.findall(r'\d+', q.translate(DIGITS))); kept, rejected = [], []
        for s in (a.get('sub_questions') or [])[:cfg.max_tasks] if a.get('is_multi_part') else []:
            s = (s or '').strip()
            bad = (not s) or (set(re.findall(r'\d+', s.translate(DIGITS))) - qnums) or (DEVA.search(q) and not DEVA.search(s))
            (rejected if bad else kept).append(s)
        tasks = [{'task_id': f'T{i}', 'question': s} for i, s in enumerate(kept or [q], 1)]
        state.update(tasks=tasks, analysis={'is_multi_part': bool(a.get('is_multi_part')), 'legal_issue': a.get('legal_issue'),
                                            'accepted': kept, 'rejected': rejected, 'fallback': not kept})
        state.setdefault('timings', {})['understand_s'] = round(time.time() - t0, 2)
        _t(state, 'understand', tasks=[t['question'] for t in tasks], rejected=rejected)
        tools.emit('understand', f'{len(tasks)} research task(s)' + (f'; {len(rejected)} sub-question(s) rejected by validation' if rejected else ''))
        return state

    def retrieve(state: State):
        t0 = time.time(); R = dict(state.get('rankings') or {})
        for q in [state['question']] + [t['question'] for t in state['tasks'] if t['question'] != state['question']]:
            if q not in R and state.get('retrievals', 0) < cfg.max_retrievals:
                tools.emit('retrieval', f'hybrid retrieval + reranking for: {q[:80]}')
                R[q] = tools.retrieve(q); state['retrievals'] = state.get('retrievals', 0) + 1
        state['rankings'] = R; state.setdefault('timings', {})['retrieve_s'] = round(time.time() - t0, 2)
        _t(state, 'retrieve', queries=list(R)); return state

    def _add(state, cid, origin):
        pool = state.setdefault('pool', [])
        if any(p['chunk_id'] == cid for p in pool):
            return False
        txt, doc = tools.text(cid)
        pool.append({'chunk_id': cid, 'document_id': doc, 'judgment_id': None, 'judgment_title': None, 'page_start': None, 'page_end': None,
                     'original_passage': txt[:cfg.passage_chars], 'origin': origin}); return True

    def _ids(state):  # stable evidence IDs in pool order
        ev = tools.sc.assign_evidence_ids('agent', [dict(p, retrieval_rank=i + 1) for i, p in enumerate(state['pool'])])
        for p, e in zip(state['pool'], ev):
            p['evidence_id'] = e['evidence_id']
        return ev

    def build_pool(state: State):
        R = state['rankings']; order = [state['question']] + [t['question'] for t in state['tasks'] if t['question'] != state['question']]
        state['pool'] = []; depth = 0
        while len(state['pool']) < cfg.pool_max and depth < 100:
            for q in order:
                if depth < len(R.get(q, [])) and len(state['pool']) < cfg.pool_max:
                    _add(state, R[q][depth], 'original' if q == state['question'] else 'subquestion')
            depth += 1
        _ids(state); _t(state, 'build_pool', passages=[p['chunk_id'] for p in state['pool']],
                         judgments=sorted({p['document_id'] for p in state['pool']}))
        tools.emit('selection', f"evidence pool: {len(state['pool'])} passages from {len({p['document_id'] for p in state['pool']})} judgments")
        return state

    def assess(state: State):
        t0 = time.time(); ids = [p['evidence_id'] for p in state['pool']]
        tools.emit('coverage', f"checking evidence coverage for {len(state['tasks'])} task(s)")
        schema = {'type': 'object', 'properties': {'tasks': {'type': 'array', 'items': {'type': 'object', 'properties': {
            'task_id': {'type': 'string', 'enum': [t['task_id'] for t in state['tasks']]}, 'status': {'type': 'string', 'enum': ['supported', 'partial', 'missing']},
            'supporting_ids': {'type': 'array', 'items': {'type': 'string', 'enum': ids}}, 'missing': {'type': 'string'}},
            'required': ['task_id', 'status', 'supporting_ids', 'missing']}}}, 'required': ['tasks']}
        a = _json(llm(state, COVERAGE.format(t='\n'.join(f"{t['task_id']}: {t['question']}" for t in state['tasks']),
                                             e='\n\n'.join(f"[{p['evidence_id']}] {p['original_passage']}" for p in state['pool'])), schema, 600, cfg.num_ctx, 0.0))
        got = {x.get('task_id'): x for x in a.get('tasks') or []}; cov = []
        for t in state['tasks']:
            x = got.get(t['task_id'], {}); sup = [i for i in x.get('supporting_ids') or [] if i in ids]; st = x.get('status', 'missing')
            if st in ('supported', 'partial') and not sup:
                st = 'missing'  # never "supported" without an actual passage
            cov.append({'task_id': t['task_id'], 'status': st, 'supporting_ids': sup, 'missing': (x.get('missing') or '') if st != 'supported' else ''})
        state['coverage'] = cov; state.setdefault('timings', {}).setdefault('coverage_s', 0)
        state['timings']['coverage_s'] = round(state['timings']['coverage_s'] + time.time() - t0, 2)
        _t(state, 'assess_coverage', round=state.get('followup_rounds', 0), coverage=cov)
        tools.emit('coverage', ', '.join(f"{c['task_id']} {c['status']}" for c in cov))
        if state.get('followup_rounds', 0) == 0 and tools.checkpoint:
            tools.checkpoint(state)
        return state

    def need_followup(state: State):
        gap = [c for c in state['coverage'] if c['status'] != 'supported']
        return 'followup' if (cfg.followup and gap and state.get('followup_rounds', 0) < cfg.max_followup
                              and state.get('retrievals', 0) < cfg.max_retrievals) else 'synthesize'

    def followup(state: State):
        t0 = time.time(); state['followup_rounds'] = state.get('followup_rounds', 0) + 1; added = []
        task_of = {t['task_id']: t for t in state['tasks']}
        support = {i for c in state['coverage'] for i in c['supporting_ids']}
        for c in [c for c in state['coverage'] if c['status'] != 'supported']:
            if state.get('retrievals', 0) >= cfg.max_retrievals:
                break
            t = task_of[c['task_id']]
            fq = (_json(llm(state, FOLLOWUP.format(t=t['question'], m=c['missing'] or t['question']),
                            {'type': 'object', 'properties': {'query': {'type': 'string'}}, 'required': ['query']}, 80, 4096, 0.0)).get('query') or '').strip()
            if not fq or (DEVA.search(t['question']) and not DEVA.search(fq)):
                fq = (t['question'] + ' ' + (c['missing'] or '')).strip()
            tools.emit('followup', f"targeted follow-up search for {c['task_id']}: {fq[:80]}")
            ranked = tools.retrieve(fq); state['retrievals'] = state.get('retrievals', 0) + 1; n = 0
            for cid in ranked:
                if n >= cfg.followup_add:
                    break
                if any(p['chunk_id'] == cid for p in state['pool']):
                    continue
                if len(state['pool']) >= cfg.pool_max:  # replace the last passage that supports no task
                    drop = next((i for i in range(len(state['pool']) - 1, -1, -1) if state['pool'][i].get('evidence_id') not in support), None)
                    if drop is None:
                        break
                    state['pool'].pop(drop)
                if _add(state, cid, f"followup:{c['task_id']}"):
                    n += 1; added.append(cid)
            t.setdefault('followup_queries', []).append(fq)
        _ids(state); state.setdefault('timings', {})['followup_s'] = round(state['timings'].get('followup_s', 0) + time.time() - t0, 2)
        _t(state, 'followup', round=state['followup_rounds'], added=added)
        return state

    def synthesize(state: State):
        t0 = time.time(); tools.emit('generation', f"writing a cited answer from {len(state['pool'])} passages")
        state['raw'], state['parsed'] = synth(state)
        state.setdefault('timings', {})['synthesis_s'] = round(time.time() - t0, 2); _t(state, 'synthesize', citations=(state['parsed'] or {}).get('citations'))
        return state

    def synth(state):
        ev = _ids(state); q = state['question']
        if len(state['tasks']) > 1:
            q = q + '\nउप-प्रश्न:\n' + '\n'.join(f"{i}. {t['question']}" for i, t in enumerate(state['tasks'], 1))
        raw = llm(state, tools.build_prompt(q, ev), tools.sc.output_schema(ev), cfg.num_predict, cfg.num_ctx, 0.1)
        return raw, (tools.sc.parse_structured_response(raw or '', ev) if raw else None)

    def verify(state: State):
        t0 = time.time(); parsed = state.get('parsed'); reviews, keep = [], []
        if cfg.verify and parsed and parsed.get('schema_valid') and parsed.get('citations'):
            by = {p['evidence_id']: p for p in state['pool']}; cls = tools.split_claims(parsed['answer'])
            for i, cl in enumerate(cls, 1):
                ids = [x for x in re.findall(r'\[(E\d{3})\]', cl) if x in by] or [x for x in parsed['citations'] if x in by]
                if not ids:
                    reviews.append({'claim': cl, 'supported': False, 'cited': [], 'reason': 'no_citation'}); continue
                tools.emit('verification', f'checking claim {i}/{len(cls)} against {", ".join(ids)}')
                ok = bool(_json(llm(state, VERIFY.format(c=cl, e='\n\n'.join(f"[{x}] {by[x]['original_passage']}" for x in ids)),
                                    {'type': 'object', 'properties': {'supported': {'type': 'boolean'}}, 'required': ['supported']}, 30, 8192, 0.0)).get('supported'))
                reviews.append({'claim': cl, 'supported': ok, 'cited': ids, 'reason': 'verified' if ok else 'not_supported_by_cited_evidence'})
                if ok:
                    keep.append(cl if re.search(r'\[E\d{3}\]', cl) else cl.rstrip('।. ') + ' ' + ' '.join(f'[{x}]' for x in ids) + '.')
        elif not cfg.verify and parsed and parsed.get('schema_valid'):
            keep = [parsed.get('answer') or '']
        state['reviews'] = reviews; state['kept'] = keep
        state.setdefault('timings', {})['verify_s'] = round(time.time() - t0, 2); _t(state, 'verify', reviews=reviews)
        return state

    def gate(state: State):
        ev = _ids(state); keep = state.get('kept') or []
        blocked, why = tools.det_gate(state['question'], [p['document_id'] for p in state['pool']]) if cfg.gate else (False, None)
        covered = any(c['status'] in ('supported', 'partial') for c in state.get('coverage') or [])
        reason = 'case_gate:' + why if blocked else ('no_task_covered' if not covered else ('no_verified_claim' if not keep else None))
        ans = ABSTAIN if reason else ' '.join(keep)
        cites = [] if reason else sorted({x for c in keep for x in re.findall(r'\[(E\d{3})\]', c)})
        state['final'] = tools.sc.parse_structured_response(json.dumps({'answer': ans, 'citations': cites}, ensure_ascii=False), ev)
        state['outcome'] = 'answered' if not reason else 'abstained_' + reason.split(':')[0]
        state['gate'] = {'blocked': bool(reason), 'reason': reason, 'case_gate': why, 'tasks_covered': covered}
        _t(state, 'gate', outcome=state['outcome']); tools.emit('gate', state['outcome'])
        return state

    g = StateGraph(State)
    for n, f in (('understand', understand), ('retrieve', retrieve), ('build_pool', build_pool), ('assess_coverage', assess),
                 ('followup', followup), ('synthesize', synthesize), ('verify', verify), ('gate', gate)):
        g.add_node(n, f)
    g.add_edge(START, 'understand'); g.add_edge('understand', 'retrieve'); g.add_edge('retrieve', 'build_pool')
    g.add_edge('build_pool', 'assess_coverage')
    g.add_conditional_edges('assess_coverage', need_followup, {'followup': 'followup', 'synthesize': 'synthesize'})
    g.add_edge('followup', 'assess_coverage'); g.add_edge('synthesize', 'verify'); g.add_edge('verify', 'gate'); g.add_edge('gate', END)
    graph = g.compile()
    graph.synth = synth  # used by the experiment checkpoint (arm C)
    return graph


def run(graph, question: str) -> State:
    return graph.invoke({'question': question, 'trace': [], 'timings': {}, 'llm_calls': 0}, {'recursion_limit': 40})
