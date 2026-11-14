import { motion } from 'framer-motion'
import { Boxes, BrainCircuit, Database, FileScan, GitBranch, Languages, Layers, Network, Search, ServerCog, ShieldCheck, Workflow } from 'lucide-react'

// One diagram of the whole agentic workflow, drawn from the actual LangGraph wiring in vidhigya_agent.py:
// START -> understand -> retrieve -> build_pool -> assess_coverage -(gap)-> followup -> assess_coverage ... -> synthesize -> verify -> gate -> END
const TEAL = '#3fe6d2', GOLD = '#ffbf57', INK = '#0f1a22', LINE = '#4b6470', TXT = '#e2e8f0', SUB = '#94a3b8'

type N = { x: number; y: number; w?: number; t: string; s: string; llm?: boolean }
const NODES: Record<string, N> = {
  understand: { x: 50, y: 220, t: 'understand', s: 'split into tasks', llm: true },
  retrieve: { x: 205, y: 220, t: 'retrieve', s: 'search per task' },
  build_pool: { x: 360, y: 220, t: 'build_pool', s: 'evidence ≤ 8, E001…' },
  assess: { x: 515, y: 220, t: 'assess_coverage', s: 'task covered?', llm: true },
  followup: { x: 515, y: 352, t: 'followup', s: 'new query for gaps', llm: true },
  synthesize: { x: 720, y: 220, t: 'synthesize', s: 'cited answer (JSON)', llm: true },
  verify: { x: 870, y: 220, t: 'verify', s: 'check every claim', llm: true },
  gate: { x: 1020, y: 220, t: 'gate', s: 'case check / abstain' },
}
const W = 135, H = 64

function Node({ n }: { n: N }) {
  return (
    <g>
      <rect x={n.x} y={n.y} width={n.w ?? W} height={H} rx={12} fill={INK} stroke={n.llm ? GOLD : TEAL} strokeOpacity={0.75} strokeWidth={1.4} />
      {n.llm && <circle cx={n.x + (n.w ?? W) - 12} cy={n.y + 12} r={4} fill={GOLD} />}
      <text x={n.x + (n.w ?? W) / 2} y={n.y + 28} textAnchor="middle" fontSize={14} fontFamily="ui-monospace,monospace" fill={TXT}>{n.t}</text>
      <text x={n.x + (n.w ?? W) / 2} y={n.y + 48} textAnchor="middle" fontSize={11.5} fill={SUB}>{n.s}</text>
    </g>
  )
}
const Box = ({ x, y, w, h, t, s, c = LINE }: { x: number; y: number; w: number; h: number; t: string; s?: string; c?: string }) => (
  <g>
    <rect x={x} y={y} width={w} height={h} rx={10} fill={INK} stroke={c} strokeOpacity={0.8} />
    <text x={x + 14} y={y + (s ? 24 : h / 2 + 5)} fontSize={13} fill={TXT} fontWeight={600}>{t}</text>
    {s && s.split('\n').map((l, i) => <text key={i} x={x + 14} y={y + 44 + i * 16} fontSize={11.5} fill={SUB}>{l}</text>)}
  </g>
)

export function AgentWorkflowDiagram() {
  const N = NODES, mid = (n: N) => n.x + W / 2, cy = 252
  return (
    <div className="glass overflow-x-auto p-4 md:p-6">
      <svg viewBox="0 0 1200 700" className="min-w-[900px] w-full" role="img"
        aria-label="VIDHIGYA agentic workflow: question, Marathi translation, LangGraph agent with follow-up loop, tools, answer or abstention">
        <defs>
          <marker id="aw-a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill={TEAL} /></marker>
          <marker id="aw-g" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill={GOLD} /></marker>
          <marker id="aw-m" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill={SUB} /></marker>
        </defs>

        {/* 1. input + full-Marathi mode */}
        <Box x={20} y={24} w={230} h={64} t="Question" s="Marathi · English · mixed" c={TEAL} />
        <Box x={300} y={24} w={190} h={64} t="Language check" s="Devanagari share" />
        <Box x={540} y={24} w={330} h={64} t="Translate once to Marathi (gemma3:12b)" s="legal glossary · numbers kept · else original" c={GOLD} />
        <path d="M250 56H298" stroke={TEAL} strokeWidth={1.6} markerEnd="url(#aw-a)" />
        <path d="M490 56H538" stroke={TEAL} strokeWidth={1.6} markerEnd="url(#aw-a)" />
        <text x={395} y={108} textAnchor="middle" fontSize={11} fill={SUB}>Marathi → as is</text>
        <path d="M395 88V96M395 116V148" stroke={SUB} strokeDasharray="4 4" />
        <path d="M705 88V150H117V206" fill="none" stroke={TEAL} strokeWidth={1.6} markerEnd="url(#aw-a)" />
        <text x={720} y={112} fontSize={11} fill={SUB}>Marathi question → whole agent runs in Marathi</text>

        {/* 2. LangGraph agent */}
        <rect x={20} y={168} width={1160} height={268} rx={18} fill="none" stroke={TEAL} strokeOpacity={0.35} strokeDasharray="6 6" />
        <text x={150} y={196} fontSize={12.5} fill={TEAL} fontFamily="ui-monospace,monospace">LangGraph StateGraph · shared state: tasks, evidence pool, coverage, trace · recursion limit 40</text>
        {Object.values(N).map((n) => <Node key={n.t} n={n} />)}
        {[['understand', 'retrieve'], ['retrieve', 'build_pool'], ['build_pool', 'assess'], ['synthesize', 'verify'], ['verify', 'gate']].map(([a, b]) => (
          <path key={a} d={`M${N[a].x + W} ${cy}H${N[b].x - 2}`} stroke={TEAL} strokeWidth={1.6} markerEnd="url(#aw-a)" />))}
        {/* conditional edge */}
        <path d={`M${N.assess.x + W} ${cy}H${N.synthesize.x - 2}`} stroke={GOLD} strokeWidth={1.6} markerEnd="url(#aw-g)" />
        <text x={(N.assess.x + W + N.synthesize.x) / 2} y={cy - 10} textAnchor="middle" fontSize={11} fill={GOLD}>covered</text>
        <text x={(N.assess.x + W + N.synthesize.x) / 2} y={cy + 20} textAnchor="middle" fontSize={11} fill={GOLD}>or limit</text>
        <path d={`M${mid(N.assess) - 22} ${N.assess.y + H}V${N.followup.y - 2}`} stroke={GOLD} strokeWidth={1.6} markerEnd="url(#aw-g)" />
        <path d={`M${mid(N.followup) + 22} ${N.followup.y}V${N.assess.y + H + 2}`} stroke={TEAL} strokeWidth={1.6} markerEnd="url(#aw-a)" />
        <text x={N.assess.x - 10} y={N.assess.y + H + 34} textAnchor="end" fontSize={11} fill={GOLD}>gap & round &lt; 2</text>
        <text x={N.assess.x + W + 10} y={N.assess.y + H + 34} fontSize={11} fill={SUB}>re-assess</text>
        <text x={N.followup.x + W + 14} y={N.followup.y + 28} fontSize={11.5} fill={SUB}>up to 2 follow-up rounds;</text>
        <text x={N.followup.x + W + 14} y={N.followup.y + 44} fontSize={11.5} fill={SUB}>new evidence joins the same pool</text>
        <circle cx={40} cy={cy} r={6} fill={TEAL} /><text x={28} y={cy + 24} fontSize={10} fill={SUB}>START</text>
        <path d={`M${N.gate.x + W} ${cy}H1166V586`} fill="none" stroke={TEAL} strokeWidth={1.6} markerEnd="url(#aw-a)" />
        <text x={1160} y={cy + 30} textAnchor="end" fontSize={10} fill={SUB}>END</text>

        {/* 3. tools */}
        <text x={20} y={466} fontSize={12} fill={SUB} letterSpacing={1.5}>TOOLS CALLED BY THE NODES</text>
        <Box x={20} y={478} w={330} h={84} t="Hybrid retriever" s={'BM25 + E5-large → RRF(60)\n→ bge-reranker-v2-m3 → in-judgment paragraphs'} />
        <Box x={360} y={478} w={180} h={84} t="Judgment store" s={'SQLite 98,509 passages\n+ uploads (Qdrant, BM25)'} />
        <Box x={550} y={478} w={290} h={84} t="Local LLM · Ollama gemma3:12b" s={'JSON-schema outputs (gold nodes)\nclaim splitter · temperature 0.1'} c={GOLD} />
        <Box x={850} y={478} w={300} h={84} t="Deterministic case/party gate" s={'case no. + parties from judgment header\nwrong case → abstain'} />
        <path d={`M${mid(N.retrieve)} ${N.retrieve.y + H}V476`} stroke={SUB} strokeDasharray="3 4" markerEnd="url(#aw-m)" />
        <path d={`M${mid(N.build_pool)} ${N.build_pool.y + H}V476`} stroke={SUB} strokeDasharray="3 4" markerEnd="url(#aw-m)" />
        <path d={`M${mid(N.synthesize)} ${N.synthesize.y + H}V476`} stroke={SUB} strokeDasharray="3 4" markerEnd="url(#aw-m)" />
        <path d={`M${mid(N.verify)} ${N.verify.y + H}V476`} stroke={SUB} strokeDasharray="3 4" markerEnd="url(#aw-m)" />
        <path d={`M${mid(N.gate) + 20} ${N.gate.y + H}V476`} stroke={SUB} strokeDasharray="3 4" markerEnd="url(#aw-m)" />

        {/* 4. upload ingestion + output */}
        <Box x={20} y={598} w={520} h={78} t="Admin upload → indexed (searchable at once)" s={'PDF → text layer / EasyOCR on damaged pages → ACPMC chunks\n→ E5 vectors → Qdrant + BM25'} />
        <path d="M450 598V564" stroke={SUB} strokeDasharray="3 4" markerEnd="url(#aw-m)" />
        <Box x={560} y={598} w={620} h={78} t="Answer or honest abstention" c={TEAL}
          s={'every sentence cited [E001] to a judgment passage · unsupported claims removed\nEnglish question → English reading copy (citation markers must match)'} />

        <g transform="translate(900 30)">
          <rect width={14} height={14} rx={3} fill="none" stroke={TEAL} y={0} /><text x={22} y={12} fontSize={11} fill={SUB}>graph node</text>
          <rect width={14} height={14} rx={3} fill="none" stroke={GOLD} y={22} /><text x={22} y={34} fontSize={11} fill={SUB}>node that calls the LLM</text>
          <path d="M0 52H14" stroke={GOLD} strokeWidth={1.6} /><text x={22} y={56} fontSize={11} fill={SUB}>conditional edge</text>
        </g>
      </svg>
    </div>
  )
}

const TECH = [
  { icon: Workflow, t: 'LangGraph', d: 'StateGraph with 8 nodes and one conditional edge (coverage → follow-up loop). Typed shared state; every node logged to the run trace.' },
  { icon: BrainCircuit, t: 'Ollama · gemma3:12b', d: 'Local generator for task splitting, coverage checks, follow-up queries, the cited answer and claim checks. JSON-schema constrained outputs.' },
  { icon: Search, t: 'Hybrid retrieval', d: 'rank-bm25 + multilingual-e5-large (Sentence-Transformers), Reciprocal Rank Fusion (k = 60).' },
  { icon: Layers, t: 'Cross-encoder reranking', d: 'BAAI bge-reranker-v2-m3 over the top 30, then in-judgment paragraph selection (3 judgments + document prior).' },
  { icon: Database, t: 'Qdrant + SQLite', d: 'Qdrant vector store for uploaded judgments; SQLite registry of 98,509 corpus passages and the full audit log of every run.' },
  { icon: FileScan, t: 'OCR + ACPMC chunking', d: 'pypdfium2 text layer; EasyOCR (Marathi + English) only for damaged pages; header / paragraph / order chunks with case context.' },
  { icon: Languages, t: 'Full-Marathi mode', d: 'English and mixed questions are translated once to Marathi with a legal glossary; the answer is translated back for English readers.' },
  { icon: ShieldCheck, t: 'Verification & gate', d: 'Claim splitter + per-claim support check; deterministic case/party gate; abstains instead of guessing.' },
  { icon: ServerCog, t: 'FastAPI + SSE', d: 'Background worker runs the agent; every node streams live to the UI as Server-Sent Events.' },
  { icon: Network, t: 'React · Vite · Tailwind', d: 'Live agent trace, evidence and claim views, judgment reader with PDF, admin upload page.' },
  { icon: GitBranch, t: 'Bounded autonomy', d: 'Evidence pool ≤ 8, follow-up rounds ≤ 2, recursion limit 40: the agent cannot loop or search without limit.' },
  { icon: Boxes, t: 'Runs fully local', d: 'All models run on the machine (CPU); no question or judgment is sent to an outside service.' },
]

export function AgentTech() {
  return (
    <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {TECH.map(({ icon: I, t, d }, i) => (
        <motion.div key={t} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: (i % 4) * 0.06 }} className="glass p-5">
          <I size={20} className="text-electric-300" />
          <div className="mt-3 font-display text-base text-white">{t}</div>
          <p className="mt-1.5 text-sm text-slate-400">{d}</p>
        </motion.div>))}
    </div>
  )
}

// How an uploaded PDF becomes searchable (backend/app/ingest.py: submit -> queue -> process -> rebuild_bm25).
export function UploadWorkflowDiagram() {
  const A = (d: string, c = TEAL) => <path d={d} fill="none" stroke={c} strokeWidth={1.6} markerEnd={`url(#uw-${c === GOLD ? 'g' : c === SUB ? 'm' : 'a'})`} />
  const Num = ({ x, y, n }: { x: number; y: number; n: number }) => (
    <g><circle cx={x} cy={y} r={11} fill={TEAL} /><text x={x} y={y + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#06231f">{n}</text></g>)
  return (
    <div className="glass overflow-x-auto p-4 md:p-6">
      <svg viewBox="0 0 1200 640" className="min-w-[900px] w-full" role="img"
        aria-label="Upload workflow: admin sign-in, PDF checks, queue, text extraction, page damage check, OCR of damaged pages, ACPMC chunking, embeddings, Qdrant and BM25 indexing, searchable by the agent">
        <defs>
          <marker id="uw-a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill={TEAL} /></marker>
          <marker id="uw-g" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill={GOLD} /></marker>
          <marker id="uw-m" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill={SUB} /></marker>
        </defs>

        {/* row 1: receive */}
        <text x={38} y={22} fontSize={12} fill={SUB} letterSpacing={1.5}>RECEIVE (FastAPI, admin only)</text>
        <Box x={20} y={34} w={260} h={84} t="Admin sign-in" s={'password checked against salted\nPBKDF2 hash · 12 h session token'} c={TEAL} />
        <Box x={313} y={34} w={260} h={84} t="Upload PDF" s={'drag & drop · must start with %PDF\nmax 50 MB'} />
        <Box x={606} y={34} w={260} h={84} t="De-duplicate (SHA-256)" s={'id = up_<hash> · same file twice\n→ existing judgment returned'} />
        <Box x={899} y={34} w={261} h={84} t="Background queue" s={'one document at a time · resumes\nafter a server restart'} />
        {A('M280 76H311')}{A('M573 76H604')}{A('M866 76H897')}
        {A('M1030 118V146H145V174')}

        {/* row 2: clean text */}
        <text x={38} y={166} fontSize={12} fill={SUB} letterSpacing={1.5}>CLEAN THE TEXT, PAGE BY PAGE</text>
        <Box x={20} y={178} w={250} h={84} t="Read text layer" s={'pypdfium2, every page\nUnicode NFC'} />
        <Box x={300} y={178} w={250} h={84} t="Damage score per page" s={'broken-Marathi signatures\nper 1,000 Devanagari letters'} />
        <polygon points="660,180 740,222 660,264 580,222" fill={INK} stroke={GOLD} strokeOpacity={0.85} />
        <text x={660} y={218} textAnchor="middle" fontSize={11.5} fill={TXT}>score &gt; 10 or</text>
        <text x={660} y={234} textAnchor="middle" fontSize={11.5} fill={TXT}>&lt; 50 letters?</text>
        <Box x={790} y={168} w={370} h={64} t="Yes → OCR this page (EasyOCR, Marathi + English)" s="200 DPI · line order rebuilt · if OCR fails, text layer kept" c={GOLD} />
        <Box x={790} y={248} w={370} h={52} t="No → keep the PDF's own text" />
        {A('M270 220H298')}{A('M550 222H578')}
        {A('M740 222H760V200H788', GOLD)}<text x={752} y={192} fontSize={11} fill={GOLD}>yes</text>
        {A('M740 222H760V274H788', SUB)}<text x={752} y={292} fontSize={11} fill={SUB}>no</text>
        <text x={20} y={300} fontSize={11.5} fill={SUB}>The damage score and the routing rule come from the corpus text-quality study (EXP11): only damaged pages are OCR'd.</text>
        {A('M1160 200H1180V330H200V354')}
        <path d="M1160 274H1180" stroke={SUB} strokeWidth={1.6} />

        {/* row 3: index */}
        <text x={38} y={346} fontSize={12} fill={SUB} letterSpacing={1.5}>CHUNK AND INDEX</text>
        <Box x={20} y={358} w={380} h={100} t="ACPMC chunking" s={'header chunk (case no., parties) · numbered paragraphs\nmerged to 900–1,800 chars · order chunk · disclaimer\nsearch text prefixed [case no. | parties | paras]'} c={TEAL} />
        <Box x={420} y={358} w={230} h={100} t="Embed" s={'multilingual-e5-large\n"passage:" vectors\n(same model as the corpus)'} />
        <Box x={670} y={358} w={240} h={100} t="Store" s={'Qdrant: vectors + payload\nSQLite uploads.db: text,\npages, case, parties'} />
        <Box x={930} y={358} w={230} h={100} t="Keyword index" s={'BM25 rebuilt over\nall uploaded chunks'} />
        {A('M400 408H418')}{A('M650 408H668')}{A('M910 408H928')}

        {/* row 4: searchable */}
        {A('M790 458V528')}{A('M1045 458V528')}
        <Box x={20} y={530} w={1140} h={92} c={TEAL} t="Searchable immediately — no restart, the frozen corpus index is never changed"
          s={'agent retrieval fuses 4 lists with RRF: corpus BM25 + corpus E5 + upload BM25 + upload vectors → reranker → cited like any judgment\nthe Upload page shows the live stage (OCR page k/n, chunks, damage before → after) · delete removes it from Qdrant, SQLite and BM25'} />
        <Num x={22} y={18} n={1} /><Num x={22} y={162} n={2} /><Num x={22} y={342} n={3} /><Num x={22} y={514} n={4} />
      </svg>
    </div>
  )
}
