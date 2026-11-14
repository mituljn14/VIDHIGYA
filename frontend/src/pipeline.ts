// Nodes of the VIDHIGYA LangGraph agent (backend/app/vidhigya_agent.py). `id` = the stage name the backend emits as a run
// event, so the architecture view and the live research timeline show the same real graph.
import { Search, Layers, ListChecks, Repeat, PenLine, ShieldCheck, Scale, Flag, Split } from 'lucide-react'

export type Stage = { id: string; title: string; short: string; icon: typeof Search; detail: string; config?: string; evidence?: string }

export const STAGES: Stage[] = [
  { id: 'understand', title: 'Query understanding agent', short: 'Decompose', icon: Split,
    detail: 'The model decides whether the question asks for more than one thing and, if so, writes up to three self-contained sub-questions in the language of the question. Sub-questions that introduce a number not in the question, or switch away from Devanagari, are rejected; if the output is unusable the original question is used. The original question is always kept.',
    config: 'gemma3:12b · JSON schema · ≤ 3 sub-questions', evidence: 'Replaces the regex split of the original agent (AGENTIC_FAILURE_ANALYSIS.md).' },
  { id: 'retrieval', title: 'Retrieval agent', short: 'Hybrid search', icon: Search,
    detail: 'For the question and every sub-question: BM25 on the production index and multilingual-e5-large dense search, fused with Reciprocal Rank Fusion (k = 60), then rescored by BAAI/bge-reranker-v2-m3.',
    config: 'BM25 + E5-large → RRF 60 → bge-reranker-v2-m3 (top 30)', evidence: 'EXP07: best judgment MRR 0.79 (production 0.75).' },
  { id: 'selection', title: 'Document expansion & evidence pool', short: 'Evidence pool', icon: Layers,
    detail: 'Inside the three best judgments for each query, every paragraph is rescored, with a prior for higher-ranked judgments. The per-query paragraph lists are interleaved into one bounded pool, so passages from several judgments can be combined, each with a stable ID (E001…).',
    config: 'inDoc3 + docprior · pool ≤ 8 × 1,500 chars', evidence: 'EXP07b: paragraph Recall@10 0.59 → 0.74. Pool cap prevents the context overflow seen in the original agent.' },
  { id: 'coverage', title: 'Evidence coverage agent', short: 'Coverage', icon: ListChecks,
    detail: 'For every research task the model states whether the pool supports it (supported / partial / missing), which passage IDs contain the information, and what is still missing. A task cannot be "supported" without a real passage ID.',
    config: 'gemma3:12b · JSON schema · IDs restricted to the pool' },
  { id: 'followup', title: 'Follow-up research agent', short: 'Follow-up', icon: Repeat,
    detail: 'Only when a task is not supported: the model writes one targeted search from the stated gap, the retrieval agent runs it, and up to two new passages per task join the pool (replacing passages that support nothing). Coverage is then reassessed.',
    config: '≤ 2 rounds · ≤ 10 retrievals per question' },
  { id: 'generation', title: 'Answer synthesis agent', short: 'Cited answer', icon: PenLine,
    detail: 'The answer is written only from the pool, every factual sentence ends with evidence markers, and a JSON schema restricts citations to IDs that exist. Sub-questions are passed with the question so every part is addressed.',
    config: 'gemma3:12b · frozen-B citation prompt · T 0.1 · ctx 16,384' },
  { id: 'verification', title: 'Claim verification agent', short: 'Verify', icon: ShieldCheck,
    detail: 'The answer is split into claims; each claim is checked against exactly the passages it cites. Unsupported claims are removed.',
    config: 'claim_split v2 · per-claim JSON check · T 0', evidence: 'DEV (fixed pipeline): unsupported-claim rate 0.07 → 0.01.' },
  { id: 'gate', title: 'Final evidence gate', short: 'Gate', icon: Scale,
    detail: 'Fail-closed: the system abstains if the question names a case that none of the retrieved judgments contain, if no task is at least partly covered, or if no claim survived verification.',
    config: 'case gate + coverage gate + ≥ 1 verified claim', evidence: 'DEV (fixed pipeline): correct abstention 0.24 → 0.86.' },
  { id: 'done', title: 'Research report', short: 'Report', icon: Flag,
    detail: 'The verified answer with clickable citations, the sub-questions and their coverage, follow-up searches, every supporting passage with its judgment, and the claim-by-claim verification record — all stored for audit.' },
]
const ALIAS: Record<string, string> = { query: 'understand', loading: 'understand', queued: 'understand', reranking: 'retrieval', evidence: 'selection' }
export const stageIndex = (id: string) => Math.max(0, STAGES.findIndex((s) => s.id === (ALIAS[id] ?? id)))
