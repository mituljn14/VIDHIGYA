// Typed client for the VIDHIGYA FastAPI backend. Every value shown in the UI comes from these endpoints.
export type Judgment = { document_id: string; case_title?: string | null; case_number?: string | null; court?: string | null;
  decision_date?: string | null; case_type?: string | null; language?: string | null; page_count?: number | null; file_name?: string | null }
export type Evidence = { evidence_id: string; rank: number; chunk_id: string; document_id: string; passage: string; score: number | null; judgment: Judgment | null }
export type Claim = { idx: number; claim: string; cited: string[]; supported: number; reason: string }
export type RunEvent = { ts: number; stage: string; message: string }
export type Run = { run_id: string; created_at: string; question: string; status: 'queued' | 'running' | 'done' | 'error' | 'interrupted';
  stage: string; outcome: string | null; answer: string | null; citations: string[] | null; raw_answer: string | null;
  gate: { blocked: boolean; reason: string | null; mode?: string; case_gate?: string | null } | null; config: Record<string, string> | null;
  timings: Record<string, number> | null; error: string | null; saved: number; agent: AgentInfo | null; evidence: Evidence[]; claims: Claim[]; events: RunEvent[] }
export type AgentTask = { task_id: string; question: string; followup_queries?: string[] }
export type Coverage = { task_id: string; status: 'supported' | 'partial' | 'missing'; supporting_ids: string[]; missing: string }
export type AgentInfo = { tasks: AgentTask[]; analysis: { is_multi_part: boolean; accepted: string[]; rejected: string[]; fallback: boolean } | null;
  coverage: Coverage[] | null; followup_rounds: number; retrievals: number; llm_calls: number;
  pool: { evidence_id: string; chunk_id: string; document_id: string; origin: string }[]; trace: { node: string; t: number }[]
  query_translation?: { original: string; language: 'mr' | 'en' | 'mixed'; marathi?: string | null; used: string; translated: boolean; reason?: string | null } }
export type RunSummary = Pick<Run, 'run_id' | 'created_at' | 'question' | 'status' | 'stage' | 'outcome' | 'saved'>
export type Health = { status: string; retrieval_ready: boolean; retrieval: Record<string, unknown> | null;
  generator: { ollama: string; model: string; available: boolean; digest?: string | null }; registry: { judgments: number; chunks: number };
  configuration: Record<string, string>; validated_generator: string; using_validated_generator: boolean }
export type SystemSummary = { n: number; e2e_accuracy: number | null; e2e_ci95: [number, number] | null; correct_abstention_unanswerable: number | null;
  false_answer_unanswerable: number; precision_when_answered: number | null; claim_support_rate: number | null; unsupported_claim_rate: number | null;
  faithful_answer_rate: number | null; latency_p50_ms: number | null; missing_majority: number }
export type MetricRow = { experiment: string; metric: string; split: string; system: string; value: string; ci95: string; target: string;
  target_met: string; frozen_baseline: string; note: string }
export type Evaluation = { status: 'final' | 'provisional'; label: string; systems?: Record<string, SystemSummary | null>;
  judge_agreement?: Record<string, { fleiss_kappa?: number | null; unanimous?: number | null; items_with_3_judges: number }>;
  metric_matrix: MetricRow[] | null; retrieval: Record<string, string>[]; ocr: Record<string, unknown>[] | null; agentic?: Agentic | null }
export type AgenticTestRow = { system: string; n: number; e2e_accuracy: number | null; ci95: (number | null)[]; correct_abstention_unanswerable: number | null;
  precision_when_answered: number | null; claim_support_rate: number | null; unsupported_claim_rate: number | null }
export type Agentic = { dev: Record<string, string>[]; selection: { selected_arm: string; selected_at: string; test_judging_started: string | null } | null;
  test: { test_systems: AgenticTestRow[]; paired_tests: { comparison: string; diff: number; agent_better: number; agent_worse: number; p_holm: number; 'significant_0.05': boolean }[]; n_test_questions: number } | null }

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...init })
  if (!r.ok) {
    let detail = r.statusText
    try { const b = await r.json(); detail = typeof b.detail === 'string' ? b.detail : JSON.stringify(b.detail) } catch { /* not JSON */ }
    throw new Error(`${r.status}: ${detail}`)
  }
  return r.json() as Promise<T>
}

export const api = {
  health: () => j<Health>('/api/health'),
  evaluation: () => j<Evaluation>('/api/evaluation'),
  submit: (question: string) => j<{ run_id: string }>('/api/research', { method: 'POST', body: JSON.stringify({ question }) }),
  run: (id: string) => j<Run>(`/api/research/${id}`),
  history: (saved = false) => j<RunSummary[]>(`/api/research?saved=${saved}`),
  remove: (id: string) => j<{ deleted: string }>(`/api/research/${id}`, { method: 'DELETE' }),
  save: (id: string, saved: boolean) => j<{ saved: boolean }>(`/api/research/${id}/save?saved=${saved}`, { method: 'POST' }),
  judgment: (doc: string) => j<{ judgment: Judgment; chunks: { chunk_id: string; chunk_index: number; text: string }[]; pdf_available: boolean }>(`/api/judgments/${doc}`),
  searchJudgments: (q: string) => j<Judgment[]>(`/api/judgments?q=${encodeURIComponent(q)}`),
  translate: (id: string, lang: string) => j<{ lang: string; text: string; model: string; cached: boolean }>(`/api/research/${id}/translate?lang=${lang}`, { method: 'POST' }),
  exportUrl: (id: string) => `/api/research/${id}/export`,
  pdfUrl: (doc: string) => `/api/judgments/${doc}/pdf`,
  // live stage events (Server-Sent Events); returns a function that closes the stream
  events: (id: string, onEvent: (e: RunEvent) => void, onEnd: () => void) => {
    const es = new EventSource(`/api/research/${id}/events`)
    es.onmessage = (m) => onEvent(JSON.parse(m.data))
    es.addEventListener('end', () => { es.close(); onEnd() })
    es.onerror = () => { es.close(); onEnd() }
    return () => es.close()
  },
}

export type PrevExp = { id: string; series: string; title: string; date: string; status: string; data: string; objective: string; method: string;
  results: string; finding: string; limits: string; why: string; artifact: string }
export type NewExp = { id: string; group: string; title: string; status: string; priority: string; problem: string; hypothesis: string; method: string;
  metrics: string; why: string; compute: string; human: boolean; result?: string | null }
export type ExperimentRegister = { status_legend: Record<string, string>; previous: PrevExp[]; proposed: NewExp[]; source: string; updated: number; label: string; hidden?: Record<string, number> }
export const experimentsApi = { all: () => j<ExperimentRegister>('/api/experiments') }

export type UploadDoc = { document_id: string; case_title: string | null; case_number: string | null; original_name: string | null; page_count: number | null;
  status: 'queued' | 'processing' | 'ready' | 'error'; stage: string | null; error: string | null; created_at: string; ocr_pages: number | null;
  corruption_before: number | null; corruption_after: number | null; chunks: number | null; chunker: string | null; ocr_engine: string | null; seconds: number | null }

// Upload side is admin-only: the session token from /api/uploads/login is kept for this browser tab only.
const TOKEN_KEY = 'vidhigya_upload_token'
export const adminToken = {
  get: () => { try { return sessionStorage.getItem(TOKEN_KEY) } catch { return null } },
  set: (t: string | null) => { try { if (t) sessionStorage.setItem(TOKEN_KEY, t); else sessionStorage.removeItem(TOKEN_KEY) } catch { /* storage blocked */ } },
}
const authH = (): Record<string, string> => { const t = adminToken.get(); return t ? { Authorization: `Bearer ${t}` } : {} }
export class AuthError extends Error {}
const ja = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  try { return await j<T>(path, { ...init, headers: { 'Content-Type': 'application/json', ...authH(), ...(init?.headers || {}) } }) }
  catch (e) { if ((e as Error).message.startsWith('401')) { adminToken.set(null); throw new AuthError((e as Error).message) } throw e }
}

export const uploadsApi = {
  login: async (password: string) => {
    const r = await j<{ token: string; expires_hours: number }>('/api/uploads/login', { method: 'POST', body: JSON.stringify({ password }) })
    adminToken.set(r.token); return r
  },
  logout: async () => { try { await ja('/api/uploads/logout', { method: 'POST' }) } finally { adminToken.set(null) } },
  list: () => ja<UploadDoc[]>('/api/uploads'),
  get: (doc: string) => ja<UploadDoc>(`/api/uploads/${doc}`),
  remove: (doc: string) => ja<{ deleted: string }>(`/api/uploads/${doc}`, { method: 'DELETE' }),
  // multipart upload: no JSON content-type header (the browser sets the multipart boundary)
  upload: async (file: File) => {
    const fd = new FormData(); fd.append('file', file)
    const r = await fetch('/api/uploads', { method: 'POST', body: fd, headers: authH() })
    if (r.status === 401) { adminToken.set(null); throw new AuthError('401: admin login required') }
    if (!r.ok) {
      let detail = r.statusText
      try { const b = await r.json(); detail = typeof b.detail === 'string' ? b.detail : JSON.stringify(b.detail) } catch { /* not JSON */ }
      throw new Error(`${r.status}: ${detail}`)
    }
    return r.json() as Promise<{ document_id: string; status: string; duplicate: boolean }>
  },
}

export const fmt = (v: number | null | undefined, d = 2) => (v === null || v === undefined || Number.isNaN(v) ? '—' : v.toFixed(d))
export const isDeva = (s?: string | null) => !!s && /[ऀ-ॿ]/.test(s)

// LLM-agnostic generator choice (any chat model installed in the local Ollama)
export type LlmModel = { name: string; size_gb: number; family: string | null; parameters: string | null; validated: boolean }
export const modelsApi = {
  list: () => j<{ active: string; validated: string; models: LlmModel[] }>('/api/models'),
  select: (model: string) => j<{ active: string; validated: boolean }>('/api/models/select', { method: 'POST', body: JSON.stringify({ model }) }),
}
