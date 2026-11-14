import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { BookmarkCheck, Clock, History as HistoryIcon, Loader2, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import { api, isDeva, type RunSummary } from '../api'
import { outcomeChip } from './Workspace'
import { useI18n } from '../i18n'

// Every question asked in this installation, newest first, read from the run log (/api/research). Click a row to reopen the
// full report: answer, cited evidence, claim checks and the agent trace.
type Filter = 'all' | 'answered' | 'abstained' | 'running' | 'saved'
const lang = (q: string) => {
  const d = (q.match(/[ऀ-ॿ]/g) || []).length, l = (q.match(/[A-Za-z]/g) || []).length
  const s = d + l ? d / (d + l) : 1
  return s >= 0.85 ? ['मराठी', 'border-electric-400/40 text-electric-300'] : s <= 0.15 ? ['English', 'border-violet-400/40 text-violet-300'] : ['Mixed', 'border-white/20 text-slate-300']
}

export default function HistoryPage() {
  const { t } = useI18n()
  const [runs, setRuns] = useState<RunSummary[] | null>(null)
  const [f, setF] = useState<Filter>('all'); const [q, setQ] = useState(''); const [tick, setTick] = useState(0)
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null)
  const remove = async (r: RunSummary) => {
    if (!window.confirm(t('hist_delete_confirm') + '\n\n' + r.question.slice(0, 160))) return
    setBusy(r.run_id); setErr(null)
    try { await api.remove(r.run_id); setRuns((xs) => (xs || []).filter((x) => x.run_id !== r.run_id)) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }
  useEffect(() => { api.history(false).then(setRuns).catch(() => setRuns([])) }, [tick])
  useEffect(() => { const i = setInterval(() => setTick((x) => x + 1), 15000); return () => clearInterval(i) }, [])   // live status
  const counts = useMemo(() => {
    const r = runs || []
    return { all: r.length, answered: r.filter((x) => x.outcome === 'answered').length, abstained: r.filter((x) => x.outcome?.startsWith('abstained')).length,
      running: r.filter((x) => x.status === 'queued' || x.status === 'running').length, saved: r.filter((x) => x.saved).length }
  }, [runs])
  const shown = (runs || []).filter((r) => (f === 'all' || (f === 'answered' && r.outcome === 'answered') || (f === 'abstained' && r.outcome?.startsWith('abstained'))
    || (f === 'running' && (r.status === 'queued' || r.status === 'running')) || (f === 'saved' && r.saved)) && (!q || r.question.toLowerCase().includes(q.toLowerCase())))
  const tabs: [Filter, string][] = [['all', t('hist_all')], ['answered', t('hist_answered')], ['abstained', t('hist_abstained')], ['running', t('hist_running')], ['saved', t('tab_saved')]]
  return (
    <div className="mx-auto max-w-5xl px-5 pb-24 pt-32">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow flex items-center gap-2"><HistoryIcon size={14} />{t('nav_history')}</div>
          <h1 className="h-section mt-3">{t('hist_title')}</h1>
          <p className="mt-2 max-w-2xl text-slate-400">{t('hist_sub')}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setTick((x) => x + 1)} className="btn-ghost px-3 py-2 text-sm"><RefreshCw size={14} />{t('hist_refresh')}</button>
          <Link to="/research" className="btn-primary px-4 py-2 text-sm"><Plus size={15} />{t('new_legal_research')}</Link>
        </div>
      </div>
      <div className="mt-8 flex flex-wrap items-center gap-2">
        {tabs.map(([k, l]) => (
          <button key={k} onClick={() => setF(k)} className={`rounded-full border px-3.5 py-1.5 text-sm transition ${f === k ? 'border-electric-400/60 bg-electric-500/15 text-white' : 'border-white/10 text-slate-400 hover:text-white'}`}>
            {l} <span className="ml-1 text-xs text-slate-500">{counts[k]}</span></button>))}
        <div className="relative ml-auto w-full sm:w-72"><Search size={14} className="absolute left-3 top-2.5 text-slate-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('hist_search')} className="w-full rounded-lg border border-white/10 bg-ink-900 py-2 pl-8 pr-3 text-sm outline-none focus:border-electric-400/50" /></div>
      </div>
      {err && <p className="mt-4 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{err}</p>}
      <div className="mt-6 space-y-2">
        {runs === null ? <div className="grid place-items-center py-16"><Loader2 className="animate-spin text-slate-500" /></div>
          : shown.length === 0 ? <p className="glass py-14 text-center text-slate-500">{t('hist_empty')}</p>
          : shown.map((r, i) => { const [l, c] = outcomeChip(r.outcome, r.status); const [ll, lc] = lang(r.question)
            return (
              <motion.div key={r.run_id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.03 }}>
                <Link to={`/research/${r.run_id}`} className="glass block p-4 transition hover:border-electric-400/40 hover:bg-white/[0.04]">
                  <div className={`text-[15px] text-slate-100 ${isDeva(r.question) ? 'deva leading-relaxed' : ''}`}>{r.question}</div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <span className={`chip py-0.5 text-[11px] ${c}`}>{l}</span>
                    <span className={`chip py-0.5 text-[11px] ${lc}`}>{ll}</span>
                    {r.saved ? <BookmarkCheck size={13} className="text-electric-300" /> : null}
                    <span className="ml-auto flex items-center gap-1 text-xs text-slate-500"><Clock size={11} />
                      {new Date(r.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
                    <button title={t('hist_delete')} aria-label={t('hist_delete')} disabled={busy === r.run_id || r.status === 'queued' || r.status === 'running'}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); remove(r) }}
                      className="ml-1 grid h-7 w-7 place-items-center rounded-lg text-slate-500 transition hover:bg-bad/15 hover:text-bad disabled:cursor-not-allowed disabled:opacity-30">
                      {busy === r.run_id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}</button>
                  </div>
                </Link>
              </motion.div>) })}
      </div>
    </div>
  )
}
