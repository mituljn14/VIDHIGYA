import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Bookmark, BookmarkCheck, CheckCircle2, ChevronDown, Download, ExternalLink, FileText, Gavel, Loader2, ScrollText, ShieldAlert, ShieldCheck, Timer, XCircle } from 'lucide-react'
import { api, isDeva, type Evidence, type Run, type RunEvent } from '../api'
import PipelineViz from './PipelineViz'
import AgentTrace from './AgentTrace'
import { stageIndex } from '../pipeline'
import { outcomeChip } from '../pages/Workspace'
import { LANG_NAMES, useI18n, type Lang } from '../i18n'
import { Languages } from 'lucide-react'

// Release decision shown in the gate box. It follows the run's final outcome, because runs stored by the older pipeline
// recorded only the case check in gate.blocked: a run could abstain (every claim removed by verification) with blocked = false.
const GATE_REASONS: Record<string, string> = {
  case_gate: 'the evidence does not name the case the question asks about',
  gate: 'the evidence does not name the case the question asks about',
  no_task_covered: 'the evidence covered none of the tasks of the question',
  no_verified_claim: 'no claim of the draft answer was supported by the passages it cited',
  invalid_output: 'the model did not return an answer in the required cited format',
}
function gateText(run: Run): string {
  if (run.status === 'error' || run.status === 'interrupted') return 'Not reached — the run stopped before the release decision.'
  if (!run.outcome) return 'Waiting — the decision is made after claim verification.'
  if (run.outcome === 'answered') return 'Passed — case check, coverage check and claim verification all allowed the answer.'
  const code = (run.gate?.blocked && run.gate.reason ? run.gate.reason : run.outcome.replace(/^abstained_/, '')).split(':')[0]
  const detail = run.gate?.reason?.startsWith('case_gate:') ? ` (${run.gate.reason.slice('case_gate:'.length).replace(/_/g, ' ')})` : ''
  return `Blocked — ${GATE_REASONS[code] ?? code.replace(/_/g, ' ')}${detail}. The system abstained instead of answering.`
}

// Render an answer with [E001] markers turned into clickable citation chips.
function CitedText({ text, onCite, active }: { text: string; onCite: (id: string) => void; active: string | null }) {
  const parts = text.split(/(\[E\d{3}\])/g)
  return (<>{parts.map((p, i) => { const m = p.match(/^\[(E\d{3})\]$/)
    return m ? <button key={i} onClick={() => onCite(m[1])} className={`cite ${active === m[1] ? 'bg-electric-500/40 text-white' : ''}`}>{m[1]}</button> : <span key={i}>{p}</span> })}</>)
}

// Read the verified answer in another language (machine translation; citation markers must be preserved, else the backend rejects it).
function AnswerLanguage({ runId, original, onCite, active, prefer }: { runId: string; original: string; onCite: (id: string) => void; active: string | null; prefer?: Lang }) {
  const { t } = useI18n(); const [sel, setSel] = useState<'orig' | Lang>('orig'); const [txt, setTxt] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  const pick = async (l: 'orig' | Lang) => {
    setSel(l); setErr(null)
    if (l === 'orig' || txt[l]) return
    setBusy(true)
    try { const r = await api.translate(runId, l); setTxt((x) => ({ ...x, [l]: r.text })) } catch (e) { setErr((e as Error).message); setSel('orig') } finally { setBusy(false) }
  }
  // English question: open the stored English reading copy of the verified Marathi answer (falls back to Marathi if none)
  useEffect(() => { if (prefer) pick(prefer) }, [runId, prefer]) // eslint-disable-line react-hooks/exhaustive-deps
  const shown = sel === 'orig' ? original : txt[sel]
  return (<>
    <div className="mt-4 flex flex-wrap items-center gap-2 text-xs"><Languages size={14} className="text-electric-300" /><span className="text-slate-500">{t('answer_lang')}:</span>
      {(['orig', 'en', 'mr', 'hi'] as const).map((l) => (
        <button key={l} onClick={() => pick(l)} className={`rounded-full border px-3 py-1 transition ${sel === l ? 'border-electric-400/60 bg-electric-500/15 text-electric-300' : 'border-white/10 text-slate-400 hover:text-white'}`}>
          <span className={l === 'mr' || l === 'hi' ? 'deva' : ''}>{l === 'orig' ? t('original') : LANG_NAMES[l]}</span></button>))}
      {busy && <span className="flex items-center gap-1 text-slate-500"><Loader2 size={12} className="animate-spin" />{t('translating')}</span>}
    </div>
    {err && <p className="mt-2 text-xs text-bad">{err}</p>}
    {shown && <p className={`mt-4 text-lg leading-relaxed text-slate-100 ${isDeva(shown) ? 'deva' : ''}`}><CitedText text={shown} onCite={onCite} active={active} /></p>}
    {sel !== 'orig' && shown && <p className="mt-2 text-xs text-violet-300">{t('mt_note')}</p>}
  </>)
}

function EvidenceCard({ e, on, cited, onSelect }: { e: Evidence; on: boolean; cited: boolean; onSelect: () => void }) {
  const { t } = useI18n(); const [open, setOpen] = useState(false); const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (on) { setOpen(true); ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) } }, [on])
  const j = e.judgment
  return (
    <motion.div ref={ref} layout className={`rounded-xl border p-4 transition ${on ? 'border-electric-400/70 bg-electric-500/[0.08] shadow-glow' : cited ? 'border-white/15 bg-white/[0.03]' : 'border-white/[0.07] bg-white/[0.015] opacity-80'}`}>
      <button onClick={onSelect} className="flex w-full items-start gap-3 text-left">
        <span className="rounded-md bg-ink-800 px-2 py-1 font-mono text-xs text-electric-300">{e.evidence_id}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-white">{j?.case_title || `Judgment ${e.document_id}`}</span>
          <span className="mt-0.5 block text-xs text-slate-400">{[j?.court, j?.case_number, j?.decision_date].filter(Boolean).join(' · ') || 'metadata not available in registry'}</span>
          <span className="mt-0.5 block font-mono text-[10px] text-slate-500">{e.chunk_id} · rank {e.rank}{e.score !== null ? ` · reranker+prior ${e.score.toFixed(2)}` : ''}{cited ? '' : ' · not cited in final answer'}</span>
        </span>
      </button>
      <div className={`deva mt-3 whitespace-pre-wrap text-sm text-slate-300 ${open ? '' : 'line-clamp-3'}`}>{e.passage}</div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        <button onClick={() => setOpen(!open)} className="text-electric-300 hover:underline">{open ? t('show_less') : t('show_full')}</button>
        <Link to={`/judgments/${e.document_id}?chunk=${e.chunk_id}`} className="inline-flex items-center gap-1 text-slate-400 hover:text-white"><FileText size={12} />{t('open_judgment')}</Link>
        <a href={api.pdfUrl(e.document_id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-slate-400 hover:text-white"><ExternalLink size={12} />PDF</a>
      </div>
    </motion.div>
  )
}

export default function RunView({ runId, onChange }: { runId: string; onChange: () => void }) {
  const { t } = useI18n()
  const [run, setRun] = useState<Run | null>(null); const [err, setErr] = useState<string | null>(null)
  const [events, setEvents] = useState<RunEvent[]>([]); const [active, setActive] = useState<string | null>(null)
  const [claimSel, setClaimSel] = useState<number | null>(null); const [showRaw, setShowRaw] = useState(false)
  useEffect(() => {
    let stop = () => {}; setRun(null); setEvents([]); setErr(null)
    api.run(runId).then((r) => {
      setRun(r); setEvents(r.events)
      if (r.status === 'queued' || r.status === 'running') {
        stop = api.events(runId, (e) => setEvents((x) => (x.some((y) => y.ts === e.ts && y.message === e.message) ? x : [...x, e])),
          () => api.run(runId).then((r2) => { setRun(r2); onChange() }))
      }
    }).catch((e) => setErr((e as Error).message))
    return () => stop()
  }, [runId]) // eslint-disable-line react-hooks/exhaustive-deps
  const cited = useMemo(() => new Set(run?.citations ?? []), [run])
  const claimCites = claimSel !== null ? new Set(run?.claims[claimSel]?.cited ?? []) : null
  if (err) return <div className="glass p-8 text-bad">Could not load this answer: {err}</div>
  if (!run) return <div className="grid h-96 place-items-center"><Loader2 className="animate-spin text-slate-500" /></div>
  const live = run.status === 'queued' || run.status === 'running'
  const last = events[events.length - 1]; const [ol, oc] = outcomeChip(run.outcome, run.status)
  const supported = run.claims.filter((c) => c.supported).length
  const toggleSave = async () => { const r = await api.save(run.run_id, !run.saved); setRun({ ...run, saved: r.saved ? 1 : 0 }); onChange() }

  return (
    <div className="space-y-5">
      <div className="glass-strong p-6">
        <div className="flex flex-wrap items-center gap-2"><span className={`chip ${oc}`}>{live ? <Loader2 size={12} className="animate-spin" /> : run.outcome === 'answered' ? <CheckCircle2 size={12} /> : <ShieldAlert size={12} />}{live ? `Running · ${last?.stage ?? run.stage}` : ol}</span>
          <span className="font-mono text-xs text-slate-500">run {run.run_id} · {new Date(run.created_at).toLocaleString()}</span>
          <div className="ml-auto flex gap-2">
            <button onClick={toggleSave} className="btn-ghost px-3 py-1.5 text-xs">{run.saved ? <BookmarkCheck size={14} className="text-electric-300" /> : <Bookmark size={14} />}{run.saved ? t('saved') : t('save')}</button>
            {!live && <a href={api.exportUrl(run.run_id)} download={`vidhigya_${run.run_id}.md`} className="btn-ghost px-3 py-1.5 text-xs"><Download size={14} />{t('export')}</a>}
          </div></div>
        <h1 className={`mt-4 text-2xl font-semibold text-white md:text-3xl ${isDeva(run.question) ? 'deva' : 'font-display'}`}>{run.question}</h1>
        {run.agent?.query_translation && run.agent.query_translation.language !== 'mr' && (
          <div className="mt-3 rounded-xl border border-electric-400/25 bg-electric-500/[0.06] px-4 py-3 text-sm">
            <div className="flex items-center gap-2 text-xs text-electric-300"><Languages size={13} />
              {run.agent.query_translation.translated ? t('qt_used') : t('qt_kept')}</div>
            {run.agent.query_translation.translated && <div className="deva mt-1 text-slate-100">{run.agent.query_translation.used}</div>}
            {!run.agent.query_translation.translated && <div className="mt-1 text-xs text-slate-400">{run.agent.query_translation.reason}</div>}
          </div>)}
        {run.config && <div className="mt-4 flex flex-wrap gap-2 text-[11px]">{Object.entries(run.config).filter(([k]) => k !== 'name').map(([k, v]) => <span key={k} className="chip border-white/10 bg-white/[0.03] font-mono text-slate-400"><span className="text-slate-500">{k}</span>{v}</span>)}</div>}
        {run.config?.generator && run.config.generator !== 'gemma3:12b' && <p className="mt-3 flex items-center gap-2 text-xs text-warn"><AlertTriangle size={14} />Generator {run.config.generator} is not the validated gemma3:12b — this run is not representative of the evaluated system.</p>}
      </div>

      {live && (
        <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
          <div className="glass p-5"><div className="eyebrow mb-4">Live pipeline</div><PipelineViz active={stageIndex(last?.stage ?? 'query')} compact /></div>
          <div className="glass p-5"><div className="eyebrow mb-4">Event log</div>
            <ol className="scroll-thin max-h-[520px] space-y-2 overflow-y-auto font-mono text-xs">
              <AnimatePresence>{events.map((e, i) => (<motion.li key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} className="flex gap-3">
                <span className="shrink-0 text-slate-600">{new Date(e.ts * 1000).toLocaleTimeString()}</span><span className="shrink-0 text-electric-300">{e.stage}</span><span className="text-slate-300">{e.message}</span></motion.li>))}</AnimatePresence>
              <li className="flex items-center gap-2 text-slate-500"><Loader2 size={12} className="animate-spin" />working… (CPU inference can take several minutes)</li>
            </ol></div>
        </div>
      )}

      {run.status === 'error' && <div className="glass border-bad/30 p-6 text-bad"><div className="flex items-center gap-2 font-medium"><XCircle size={18} />The answer run failed</div><p className="mt-2 font-mono text-sm">{run.error}</p></div>}
      {run.status === 'interrupted' && <div className="glass p-6 text-warn">This run was interrupted by a server restart and was not completed. Submit the question again.</div>}

      {run.status === 'done' && (<>
        <div className="glass-strong relative overflow-hidden p-6 md:p-8">
          <div className="absolute -right-24 -top-24 h-64 w-64 rounded-full bg-electric-500/10 blur-3xl" />
          <div className="eyebrow flex items-center gap-2"><ScrollText size={14} />{t('finding')}</div>
          {run.outcome === 'answered' ? (
            <AnswerLanguage runId={run.run_id} original={run.answer ?? ''} onCite={(id) => { setActive(id); setClaimSel(null) }} active={active}
              prefer={run.agent?.query_translation?.language === 'en' ? 'en' : undefined} />
          ) : (
            <div className="mt-4 rounded-xl border border-warn/30 bg-warn/[0.06] p-4"><div className="flex items-center gap-2 font-medium text-warn"><ShieldAlert size={18} />{t('declined')}</div>
              <p className="deva mt-2 text-slate-200">{run.answer}</p>
              <p className="mt-2 text-sm text-slate-400">{run.outcome === 'abstained_gate' || run.outcome === 'abstained_case_gate' ? 'Reason: the question names a case that none of the retrieved judgments contain.' : run.outcome === 'abstained_no_verified_claim' ? 'Reason: no claim of the draft answer was supported by the evidence it cited, so every claim was removed.' : run.outcome === 'abstained_no_task_covered' ? 'Reason: the coverage agent found no retrieved passage that covers any sub-question, even after follow-up searches.' : 'Reason: the model did not return a valid cited answer.'}</p></div>
          )}
          <div className="mt-6 grid gap-3 text-sm sm:grid-cols-4">
            {[[Gavel, `${new Set(run.evidence.map((e) => e.document_id)).size} judgments`, 'in the evidence set'], [FileText, `${run.evidence.length} passages`, `${cited.size} cited in the answer`],
              [ShieldCheck, `${supported} / ${run.claims.length} claims`, 'supported by cited evidence'], [Timer, run.timings?.total_ms ? `${(run.timings.total_ms / 1000).toFixed(0)} s` : '—', 'end-to-end on this machine']].map(([I, a, b], i) => {
              const Icon = I as typeof Gavel; return (<div key={i} className="rounded-xl bg-white/[0.03] p-3"><div className="flex items-center gap-2 text-white"><Icon size={15} className="text-electric-300" />{a as string}</div><div className="mt-1 text-xs text-slate-500">{b as string}</div></div>) })}
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[1.25fr_1fr]">
          <section className="glass p-5">
            <div className="mb-4 flex items-center justify-between"><div className="eyebrow">{t('explorer')}</div>{(active || claimSel !== null) && <button onClick={() => { setActive(null); setClaimSel(null) }} className="text-xs text-slate-400 hover:text-white">Clear selection</button>}</div>
            <div className="scroll-thin max-h-[900px] space-y-3 overflow-y-auto pr-1">
              {run.evidence.map((e) => <EvidenceCard key={e.evidence_id} e={e} cited={cited.has(e.evidence_id)} on={active === e.evidence_id || !!claimCites?.has(e.evidence_id)} onSelect={() => { setActive(active === e.evidence_id ? null : e.evidence_id); setClaimSel(null) }} />)}
            </div>
          </section>
          <section className="space-y-5">
            {run.agent && <AgentTrace agent={run.agent} onCite={(id) => { setActive(id); setClaimSel(null) }} />}
            <div className="glass p-5">
              <div className="eyebrow mb-1">{t('verification')}</div>
              <p className="mb-4 text-xs text-slate-500">Each claim of the draft answer was checked by the model against exactly the passages it cites. Only supported claims appear in the finding.</p>
              {run.claims.length === 0 ? <p className="text-sm text-slate-500">No claims were verified (the draft had no valid citations, or verification did not run).</p> : (
                <ol className="space-y-2">{run.claims.map((c) => (
                  <li key={c.idx}><button onClick={() => { setClaimSel(claimSel === c.idx ? null : c.idx); setActive(null) }} className={`w-full rounded-xl border p-3 text-left transition ${claimSel === c.idx ? 'border-electric-400/60 bg-electric-500/[0.06]' : 'border-white/[0.07] hover:border-white/20'}`}>
                    <div className="flex items-center gap-2 text-xs">{c.supported ? <span className="chip border-good/40 text-good"><CheckCircle2 size={12} />{t('supported')}</span> : <span className="chip border-bad/40 text-bad"><XCircle size={12} />{c.reason === 'no_citation' ? 'No citation' : 'Not supported'} · {t('removed')}</span>}
                      <span className="font-mono text-slate-500">{c.cited.join(' ') || '—'}</span></div>
                    <p className={`mt-2 text-sm text-slate-300 ${isDeva(c.claim) ? 'deva' : ''}`}>{c.claim.replace(/\s*\[E\d{3}\]/g, '')}</p></button></li>))}</ol>)}
            </div>
            <div className="glass p-5">
              <div className="eyebrow mb-3">{t('gate')}</div>
              <p className="text-sm text-slate-300">{gateText(run)}</p>
            </div>
            <div className="glass p-5">
              <div className="eyebrow mb-3">{t('timing')}</div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-xs">{Object.entries(run.timings ?? {}).map(([k, v]) => (<Fragment key={k}><dt className="text-slate-500">{k.replace('_ms', '')}</dt><dd className="text-right text-slate-300">{(v / 1000).toFixed(1)} s</dd></Fragment>))}</dl>
            </div>
            {run.raw_answer && <div className="glass p-5"><button onClick={() => setShowRaw(!showRaw)} className="flex w-full items-center justify-between text-left"><span className="eyebrow">{t('draft')}</span><ChevronDown size={16} className={`transition ${showRaw ? 'rotate-180' : ''}`} /></button>
              {showRaw && <pre className="deva scroll-thin mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-ink-900 p-3 text-xs text-slate-400">{run.raw_answer}</pre>}</div>}
          </section>
        </div>
        <p className="text-center text-xs text-slate-500">{t('not_legal_advice')}</p>
      </>)}
    </div>
  )
}
