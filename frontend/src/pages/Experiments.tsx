import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle2, ChevronDown, CircleDashed, FlaskConical, Loader2, Search, TriangleAlert, XCircle } from 'lucide-react'
import { experimentsApi, type ExperimentRegister, type NewExp, type PrevExp } from '../api'
import { useI18n } from '../i18n'

// All experiments behind VIDHIGYA, from the first (October) paper experiments to the current series and the proposed next
// ones. Read live from the experiment register (/api/experiments); nothing here is hard-coded.
const SERIES = [
  { key: 'O', label: 'October paper', note: 'First system and manuscript (BGE-M3, small generator, 16 verified queries)' },
  { key: 'H', label: '9–11 Nov', note: 'Intermediate series (separate agent)' },
  { key: 'Q', label: 'Current system', note: 'Benchmark, retrieval, agent A–F, test set, diagnostics D1–D4, OCR, language, human pilot' },
  { key: 'NEW', label: 'New experiments', note: 'Proposed and running next experiments (EXP-NEW-01…37), each tied to a known gap' },
] as const

function statusOf(s: string): { tone: 'done' | 'part' | 'run' | 'plan' | 'bad'; label: string } {
  const x = s.toUpperCase()
  if (x.startsWith('VER') || x.startsWith('COMPLETED')) return { tone: 'done', label: 'Done' }
  if (x.startsWith('CAH')) return { tone: 'done', label: 'Done · needs human check' }
  if (x.startsWith('PART') || x.startsWith('PARTIALLY')) return { tone: 'part', label: 'Partly done' }
  if (x.startsWith('RUN')) return { tone: 'run', label: 'Running' }
  if (x.startsWith('INV')) return { tone: 'bad', label: 'Invalid / failed' }
  if (x.startsWith('HIST')) return { tone: 'plan', label: 'Superseded' }
  return { tone: 'plan', label: s.startsWith('Planned') ? 'Planned' : 'Proposed' }
}

function Badge({ s }: { s: string }) {
  const { tone, label } = statusOf(s)
  const cls = { done: 'border-good/40 bg-good/10 text-good', part: 'border-warn/40 bg-warn/10 text-warn', run: 'border-electric-400/40 bg-electric-500/10 text-electric-300',
    plan: 'border-white/15 bg-white/5 text-slate-400', bad: 'border-bad/40 bg-bad/10 text-bad' }[tone]
  const I = { done: CheckCircle2, part: CircleDashed, run: Loader2, plan: CircleDashed, bad: XCircle }[tone]
  return <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] ${cls}`}><I size={11} className={tone === 'run' ? 'animate-spin' : ''} />{label}</span>
}

function Row({ id, title, status, lines, extra }: { id: string; title: string; status: string; lines: [string, string | null | undefined][]; extra?: string }) {
  const [open, setOpen] = useState(false)
  const head = lines.find(([, v]) => v && v !== '—')
  return (
    <div className="glass overflow-hidden">
      <button onClick={() => setOpen(!open)} className="flex w-full items-start gap-3 p-4 text-left transition hover:bg-white/[0.03]" aria-expanded={open}>
        <span className="mt-0.5 w-24 shrink-0 font-mono text-xs text-electric-300">{id}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-white">{title}</span>
          {!open && head && <span className="mt-1 line-clamp-2 block text-xs text-slate-400">{head[1]}</span>}
        </span>
        <Badge s={status} />
        <ChevronDown size={16} className={`mt-0.5 shrink-0 text-slate-500 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <dl className="grid gap-x-6 gap-y-3 border-t border-white/10 px-4 py-4 text-sm sm:grid-cols-[9rem_1fr]">
          {lines.filter(([, v]) => v && v !== '—').map(([k, v]) => (<div key={k} className="contents"><dt className="text-xs uppercase tracking-wider text-slate-500">{k}</dt><dd className="text-slate-200">{v}</dd></div>))}
          {extra && <div className="contents"><dt className="text-xs uppercase tracking-wider text-slate-500">Source</dt><dd className="break-all font-mono text-[11px] text-slate-500">{extra}</dd></div>}
        </dl>)}
    </div>
  )
}

export default function Experiments() {
  const { t } = useI18n()
  const [d, setD] = useState<ExperimentRegister | null>(null); const [err, setErr] = useState<string | null>(null)
  const [tab, setTab] = useState<(typeof SERIES)[number]['key']>('Q'); const [q, setQ] = useState('')
  useEffect(() => { experimentsApi.all().then(setD).catch((e) => setErr(e.message)) }, [])

  const counts = useMemo(() => {
    if (!d) return null
    const all = [...d.previous.map((x) => x.status), ...d.proposed.map((x) => x.status)].map((s) => statusOf(s).tone)
    return { total: all.length, done: all.filter((x) => x === 'done').length, part: all.filter((x) => x === 'part' || x === 'run').length, plan: all.filter((x) => x === 'plan').length }
  }, [d])
  const match = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase())
  const prev: PrevExp[] = d ? d.previous.filter((x) => x.series.startsWith(tab) && match(`${x.id} ${x.title} ${x.results} ${x.finding}`)) : []
  const next: NewExp[] = d ? d.proposed.filter((x) => match(`${x.id} ${x.title} ${x.group} ${x.result || ''}`)) : []

  if (err) return <div className="mx-auto max-w-4xl px-5 pt-32 text-bad">{err}</div>
  return (
    <div className="mx-auto max-w-6xl px-5 pb-24 pt-28">
      <div className="eyebrow flex items-center gap-2"><FlaskConical size={14} />{t('nav_experiments')}</div>
      <h1 className="mt-2 font-display text-3xl font-semibold text-white md:text-4xl">{t('exp_title')}</h1>
      <p className="mt-3 max-w-3xl text-slate-400">{t('exp_sub')}</p>
      {counts && (
        <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[['Experiments', counts.total, 'text-white'], ['Done', counts.done, 'text-good'], ['Running / partly done', counts.part, 'text-electric-300'], ['Planned / superseded', counts.plan, 'text-slate-300']].map(([k, v, c]) => (
            <motion.div key={k as string} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass-strong p-4">
              <div className={`font-display text-3xl font-semibold ${c}`}>{v as number}</div><div className="mt-1 text-xs text-slate-400">{k}</div></motion.div>))}
        </div>)}
      <div className="mt-8 flex flex-wrap items-center gap-2">
        {SERIES.map((s) => (
          <button key={s.key} onClick={() => setTab(s.key)} className={`rounded-full px-4 py-2 text-sm transition ${tab === s.key ? 'bg-electric-500/20 text-white ring-1 ring-electric-400/60' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>
            {s.label} <span className="ml-1 text-xs text-slate-500">{d ? (s.key === 'NEW' ? d.proposed.length : d.previous.filter((x) => x.series.startsWith(s.key)).length) : ''}</span></button>))}
        <label className="ml-auto flex items-center gap-2 rounded-full border border-white/10 px-3 py-2 text-sm text-slate-300">
          <Search size={14} className="text-slate-500" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search experiments" aria-label="Search experiments" className="w-44 bg-transparent outline-none placeholder:text-slate-600" /></label>
      </div>
      <p className="mt-3 text-xs text-slate-500">{SERIES.find((s) => s.key === tab)?.note}</p>
      {!d ? <div className="grid h-40 place-items-center"><Loader2 className="animate-spin text-slate-500" /></div> : (
        <div className="mt-5 space-y-2">
          {tab !== 'NEW' && prev.map((x) => (
            <Row key={x.id} id={x.id} title={x.title} status={x.status} extra={x.artifact}
              lines={[['Result', x.results], ['Finding', x.finding], ['Objective', x.objective], ['Method', x.method], ['Data', x.data], ['Why needed', x.why], ['Limitations', x.limits], ['Date', x.date]]} />))}
          {tab === 'NEW' && next.map((x) => (
            <Row key={x.id} id={x.id.replace('EXP-', '')} title={x.title} status={x.status}
              lines={[['Result so far', x.result], ['Group', x.group], ['Priority', x.priority], ['Problem', x.problem], ['Expected (not a result)', x.hypothesis], ['Method', x.method], ['Metrics', x.metrics], ['Why needed', x.why], ['Compute', `${x.compute}${x.human ? ' · needs human validation' : ''}`]]} />))}
          {(tab === 'NEW' ? next : prev).length === 0 && <p className="py-10 text-center text-sm text-slate-500">No experiment matches.</p>}
        </div>)}
      <p className="mt-8 flex items-start gap-2 text-xs text-slate-500"><TriangleAlert size={13} className="mt-0.5 shrink-0" />{d?.label} Expected outcomes of proposed experiments are hypotheses, not results.</p>
    </div>
  )
}
