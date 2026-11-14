import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Bookmark, BookmarkCheck, Clock, FileSearch, History, Loader2, Plus, Search, Send } from 'lucide-react'
import { api, isDeva, type Judgment, type RunSummary } from '../api'
import RunView from '../components/RunView'
import { useI18n } from '../i18n'

const OUTCOME: Record<string, [string, string]> = {
  answered: ['Answered', 'border-good/40 text-good'], abstained_gate: ['Abstained · case mismatch', 'border-warn/40 text-warn'],
  abstained_no_verified_claim: ['Abstained · no verified claim', 'border-warn/40 text-warn'], abstained_invalid_output: ['Abstained · invalid output', 'border-bad/40 text-bad'], abstained_case_gate: ['Abstained · case mismatch', 'border-warn/40 text-warn'],
  abstained_no_task_covered: ['Abstained · evidence not found', 'border-warn/40 text-warn'],
}
export const outcomeChip = (o?: string | null, status?: string) => status === 'error' ? ['Error', 'border-bad/40 text-bad'] : status === 'interrupted' ? ['Interrupted', 'border-bad/40 text-bad']
  : o ? OUTCOME[o] ?? [o, 'border-white/20 text-slate-300'] : ['In progress', 'border-electric-400/40 text-electric-300']

function Sidebar({ refresh }: { refresh: number }) {
  const { t } = useI18n()
  const [tab, setTab] = useState<'history' | 'saved' | 'judgments'>('history')
  const [runs, setRuns] = useState<RunSummary[] | null>(null); const [q, setQ] = useState(''); const [js, setJs] = useState<Judgment[] | null>(null)
  const { runId } = useParams()
  useEffect(() => { if (tab !== 'judgments') api.history(tab === 'saved').then(setRuns).catch(() => setRuns([])) }, [tab, refresh, runId])
  useEffect(() => { if (tab === 'judgments') { const t = setTimeout(() => api.searchJudgments(q).then(setJs).catch(() => setJs([])), 250); return () => clearTimeout(t) } }, [q, tab])
  return (
    <aside className="glass flex h-[calc(100vh-7.5rem)] flex-col overflow-hidden lg:sticky lg:top-24">
      <div className="p-3"><Link to="/research" className="btn-primary w-full justify-center py-2.5 text-sm"><Plus size={16} />{t('new_legal_research')}</Link></div>
      <div className="flex gap-1 px-3">
        {([['history', History, t('tab_history')], ['saved', Bookmark, t('tab_saved')], ['judgments', FileSearch, t('tab_judgments')]] as const).map(([k, I, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs transition ${tab === k ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'}`}><I size={14} />{l}</button>))}
      </div>
      <div className="scroll-thin mt-2 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
        {tab === 'judgments' ? (<>
          <div className="relative mx-1 mb-2"><Search size={14} className="absolute left-3 top-2.5 text-slate-500" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title, case number or ID" className="w-full rounded-lg border border-white/10 bg-ink-900 py-2 pl-8 pr-3 text-sm outline-none focus:border-electric-400/50" /></div>
          {js?.map((j) => (<Link key={j.document_id} to={`/judgments/${j.document_id}`} className="block rounded-lg px-3 py-2 hover:bg-white/5">
            <div className="line-clamp-2 text-sm text-slate-200">{j.case_title || j.document_id}</div><div className="mt-0.5 text-xs text-slate-500">{[j.case_number, j.decision_date].filter(Boolean).join(' · ')}</div></Link>))}
          {js?.length === 0 && <p className="px-3 py-6 text-center text-sm text-slate-500">No judgments match.</p>}
        </>) : runs === null ? <div className="grid place-items-center py-10"><Loader2 className="animate-spin text-slate-500" /></div>
          : runs.length === 0 ? <p className="px-3 py-8 text-center text-sm text-slate-500">{tab === 'saved' ? 'Saved questions appear here.' : 'Your question history appears here.'}</p>
          : runs.map((r) => { const [l, c] = outcomeChip(r.outcome, r.status)
            return (<Link key={r.run_id} to={`/research/${r.run_id}`} className={`block rounded-lg px-3 py-2.5 transition ${runId === r.run_id ? 'bg-white/10' : 'hover:bg-white/5'}`}>
              <div className={`line-clamp-2 text-sm text-slate-200 ${isDeva(r.question) ? 'deva leading-snug' : ''}`}>{r.question}</div>
              <div className="mt-1.5 flex items-center gap-2"><span className={`chip py-0.5 text-[10px] ${c}`}>{l}</span>{r.saved ? <BookmarkCheck size={12} className="text-electric-300" /> : null}
                <span className="ml-auto flex items-center gap-1 text-[10px] text-slate-500"><Clock size={10} />{new Date(r.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span></div></Link>) })}
      </div>
    </aside>
  )
}

function Composer({ onSubmitted }: { onSubmitted: () => void }) {
  const { t } = useI18n()
  const [q, setQ] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const nav = useNavigate()
  const send = async () => {
    if (q.trim().length < 5) return
    setBusy(true); setErr(null)
    try { const { run_id } = await api.submit(q.trim()); onSubmitted(); nav(`/research/${run_id}`) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="mx-auto max-w-3xl py-10 md:py-20">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center">
        <div className="eyebrow">{t('composer_eyebrow')}</div>
        <h1 className="mt-3 font-display text-4xl font-semibold text-white md:text-5xl">{t('composer_title')}</h1>
        <p className="mx-auto mt-3 max-w-xl text-slate-400">{t('composer_sub')}</p>
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .1 }} className="glass-strong mt-10 p-2 shadow-glow">
        <textarea value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send() }} rows={4}
          placeholder="उदा. फौजदारी अपीलात न्यायालयाने जामिनाबाबत काय निर्णय दिला?" className="deva w-full resize-none bg-transparent px-4 py-3 text-lg text-white outline-none placeholder:text-slate-600" />
        <div className="flex items-center justify-between px-3 pb-2"><span className="text-xs text-slate-500">{t('composer_hint')} · {q.length}/2000</span>
          <button onClick={send} disabled={busy || q.trim().length < 5} className="btn-primary py-2.5 text-sm">{busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}{t('research_btn')}</button></div>
      </motion.div>
      {err && <p className="mt-4 rounded-xl border border-bad/30 bg-bad/10 p-3 text-sm text-bad">Could not submit: {err}</p>}
      <p className="mt-6 text-center text-xs text-slate-500">{t('composer_cpu')}</p>
    </div>
  )
}

export default function Workspace() {
  const { runId } = useParams(); const [refresh, setRefresh] = useState(0)
  return (
    <div className="mx-auto grid max-w-[1500px] gap-5 px-4 pb-16 pt-24 lg:grid-cols-[300px_1fr]">
      <div className="hidden lg:block"><Sidebar refresh={refresh} /></div>
      <AnimatePresence mode="wait">
        <motion.div key={runId ?? 'new'} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="min-w-0">
          {runId ? <RunView runId={runId} onChange={() => setRefresh((x) => x + 1)} /> : <Composer onSubmitted={() => setRefresh((x) => x + 1)} />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
