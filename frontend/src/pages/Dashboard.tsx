import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleDashed, Database, Gauge, Server, XCircle } from 'lucide-react'
import { api, fmt, type Agentic, type Evaluation, type Health } from '../api'
import { useI18n } from '../i18n'

const pct = (v: number | string | null | undefined) => v === null || v === undefined || v === '' ? '—' : Number(v).toFixed(3)

function AgenticResults({ ag }: { ag: Agentic }) {
  const sel = ag.selection?.selected_arm; const T = ag.test
  const th = 'px-4 py-3 font-medium'; const td = 'px-4 py-2.5 font-mono'
  return (<>
    <div className="mt-14 flex flex-wrap items-center gap-3"><h2 className="font-display text-2xl text-white">Agentic vs fixed — same model (gemma3:12b)</h2>
      {sel && <span className="chip border-good/40 text-good">Selected on DEV: arm {sel}</span>}</div>
    <p className="mt-2 text-sm text-slate-400">K12: six setups on the same 109 DEV questions. The arm with the highest DEV accuracy was selected by a pre-registered rule
      {ag.selection && <> at {ag.selection.selected_at}, before any TEST answer was judged ({ag.selection.test_judging_started ?? '—'})</>}. Automatic 3-LLM-judge majority; not human legal review.</p>
    <div className="glass mt-6 overflow-x-auto"><table className="w-full min-w-[760px] text-sm">
      <thead className="text-left text-xs uppercase tracking-wider text-slate-500"><tr>{['Arm', 'Setup', 'DEV accuracy', '95% CI', 'Correct abstention', 'Precision when answered'].map((x) => <th key={x} className={th}>{x}</th>)}</tr></thead>
      <tbody>{ag.dev.map((r) => <tr key={r.arm} className={`border-t border-white/5 ${r.arm === sel ? 'bg-good/[0.06]' : ''}`}>
        <td className="px-4 py-2.5 font-mono text-electric-300">{r.arm}</td><td className="px-4 py-2.5 text-slate-200">{r.description}</td>
        <td className={`${td} text-white`}>{pct(r.e2e_accuracy)}</td><td className={`${td} text-xs text-slate-500`}>{r.ci95}</td>
        <td className={td}>{pct(r.correct_abstention)}</td><td className={td}>{pct(r.precision_when_answered)}</td></tr>)}</tbody></table></div>
    {T && <>
      <h3 className="mt-10 font-display text-xl text-white">TEST confirmation — {T.n_test_questions} held-out questions</h3>
      <div className="glass mt-4 overflow-x-auto"><table className="w-full min-w-[760px] text-sm">
        <thead className="text-left text-xs uppercase tracking-wider text-slate-500"><tr>{['System', 'TEST accuracy', '95% CI', 'Correct abstention', 'Precision when answered', 'Claim support'].map((x) => <th key={x} className={th}>{x}</th>)}</tr></thead>
        <tbody>{T.test_systems.map((s, i) => <tr key={s.system} className={`border-t border-white/5 ${i === 0 ? 'bg-good/[0.06]' : ''}`}>
          <td className="px-4 py-2.5 text-slate-200">{s.system}</td><td className={`${td} text-white`}>{pct(s.e2e_accuracy)}</td>
          <td className={`${td} text-xs text-slate-500`}>[{pct(s.ci95[0])}, {pct(s.ci95[1])}]</td><td className={td}>{pct(s.correct_abstention_unanswerable)}</td>
          <td className={td}>{pct(s.precision_when_answered)}</td><td className={td}>{pct(s.claim_support_rate)}</td></tr>)}</tbody></table></div>
      <ul className="mt-4 space-y-1 text-sm text-slate-400">{T.paired_tests.map((p) => <li key={p.comparison} className="flex items-center gap-2">
        {p['significant_0.05'] ? <CheckCircle2 size={14} className="text-good" /> : <CircleDashed size={14} className="text-slate-500" />}
        {p.comparison}: {p.diff >= 0 ? '+' : ''}{p.diff.toFixed(3)} (+{p.agent_better}/−{p.agent_worse}, Holm p {p.p_holm < 0.001 ? '< 0.001' : '= ' + p.p_holm.toFixed(3)}{p['significant_0.05'] ? '' : ', not significant'})</li>)}</ul>
      <p className="mt-3 flex items-center gap-2 text-sm text-warn"><AlertTriangle size={14} />Below the 0.80 minimum and the 0.95 target on both DEV and TEST.</p>
    </>}
  </>)
}

const Dot = ({ ok, warn }: { ok: boolean; warn?: boolean }) => ok ? <CheckCircle2 size={16} className="text-good" /> : warn ? <AlertTriangle size={16} className="text-warn" /> : <XCircle size={16} className="text-bad" />

export default function Dashboard() {
  const { t } = useI18n()
  const [h, setH] = useState<Health | null>(null); const [ev, setEv] = useState<Evaluation | null>(null); const [err, setErr] = useState<string | null>(null)
  useEffect(() => { const load = () => api.health().then(setH).catch((e) => setErr(e.message)); load(); api.evaluation().then(setEv).catch(() => {}); const t = setInterval(load, 10000); return () => clearInterval(t) }, [])
  const mm = ev?.metric_matrix ?? []; const ag = ev?.agentic && (ev.agentic.dev.length || ev.agentic.test) ? ev.agentic : null
  return (
    <div className="mx-auto max-w-7xl px-5 pb-24 pt-32">
      <div className="eyebrow flex items-center gap-2"><Gauge size={14} />System dashboard</div>
      <h1 className="h-section mt-3">{t('dashboard_title')}</h1>
      {err && <p className="mt-6 rounded-xl border border-bad/30 bg-bad/10 p-4 text-bad">Backend unreachable: {err}</p>}

      <div className="mt-10 grid gap-4 md:grid-cols-3">
        <div className="glass p-6"><div className="flex items-center gap-2 text-white"><Server size={18} className="text-electric-300" />Retrieval</div>
          <div className="mt-4 space-y-2 text-sm">
            <div className="flex items-center justify-between"><span className="text-slate-400">Models loaded</span>{h ? <Dot ok={h.retrieval_ready} warn /> : <CircleDashed size={16} />}</div>
            <div className="flex justify-between"><span className="text-slate-400">Dense</span><span className="font-mono text-xs">{String(h?.retrieval?.dense_model ?? '—')}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Reranker</span><span className="font-mono text-xs">{String(h?.retrieval?.reranker ?? '—')}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Load time</span><span className="font-mono text-xs">{h?.retrieval?.load_seconds ? `${h.retrieval.load_seconds} s` : '—'}</span></div></div></div>
        <div className="glass p-6"><div className="flex items-center gap-2 text-white"><Server size={18} className="text-violet-400" />Generator</div>
          <div className="mt-4 space-y-2 text-sm">
            <div className="flex items-center justify-between"><span className="text-slate-400">Ollama</span>{h ? <Dot ok={h.generator.ollama === 'up'} /> : <CircleDashed size={16} />}</div>
            <div className="flex items-center justify-between"><span className="text-slate-400">Model available</span>{h ? <Dot ok={h.generator.available} /> : <CircleDashed size={16} />}</div>
            <div className="flex justify-between"><span className="text-slate-400">Model</span><span className="font-mono text-xs">{h?.generator.model ?? '—'}</span></div>
            <div className="flex items-center justify-between"><span className="text-slate-400">Validated model (gemma3:12b)</span>{h ? <Dot ok={h.using_validated_generator} warn /> : <CircleDashed size={16} />}</div></div></div>
        <div className="glass p-6"><div className="flex items-center gap-2 text-white"><Database size={18} className="text-good" />Document registry</div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div><div className="font-display text-3xl text-white">{h?.registry.judgments.toLocaleString() ?? '—'}</div><div className="text-xs text-slate-500">judgments</div></div>
            <div><div className="font-display text-3xl text-white">{h?.registry.chunks.toLocaleString() ?? '—'}</div><div className="text-xs text-slate-500">passages</div></div></div></div>
      </div>
      {h && !h.using_validated_generator && <p className="mt-4 flex items-center gap-2 rounded-xl border border-warn/30 bg-warn/[0.06] p-3 text-sm text-warn"><AlertTriangle size={16} />Running with {h.generator.model}, not the validated gemma3:12b. Answers are not representative of the evaluated system.</p>}

      {ag && <AgenticResults ag={ag} />}

      <div className="mt-14 flex flex-wrap items-center gap-3"><h2 className="font-display text-2xl text-white">Metric completion vs targets</h2>
        <span className={`chip ${ev?.status === 'final' ? 'border-good/40 text-good' : 'border-warn/40 text-warn'}`}>{ev?.status === 'final' ? 'Final' : 'Provisional — judging in progress'}</span></div>
      <p className="mt-2 text-sm text-slate-400">{ev?.label} Target 0.95 for end-to-end accuracy, 0.90 for every other metric. Rows read live from METRIC_COMPLETION_MATRIX.csv.</p>
      <div className="glass mt-6 overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-slate-500"><tr>{['Exp', 'Metric', 'Split', 'Value', '95% CI', 'Frozen B', 'Target', 'Met'].map((t) => <th key={t} className="px-4 py-3 font-medium">{t}</th>)}</tr></thead>
          <tbody>{mm.map((m, i) => { const v = m.value === '' ? null : Number(m.value); const b = m.frozen_baseline === '' ? null : Number(m.frozen_baseline)
            return (<tr key={i} className="border-t border-white/5">
              <td className="px-4 py-2.5 font-mono text-xs text-electric-300">{m.experiment}</td><td className="px-4 py-2.5 text-slate-200">{m.metric}{m.note && <div className="text-xs text-slate-500">{m.note}</div>}</td>
              <td className="px-4 py-2.5 text-slate-400">{m.split}</td><td className="px-4 py-2.5 font-mono">{fmt(v)}</td><td className="px-4 py-2.5 font-mono text-xs text-slate-500">{m.ci95 || '—'}</td>
              <td className="px-4 py-2.5 font-mono text-slate-400">{fmt(b)}</td><td className="px-4 py-2.5 font-mono text-slate-400">{m.target || '—'}</td>
              <td className="px-4 py-2.5">{m.target_met === 'True' ? <CheckCircle2 size={16} className="text-good" /> : m.target_met === 'False' ? <XCircle size={16} className="text-bad" /> : <span className="text-xs text-slate-500">n/a</span>}</td></tr>) })}
            {mm.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">Metric matrix not available yet.</td></tr>}</tbody>
        </table>
      </div>
      {ev?.judge_agreement && <p className="mt-4 text-sm text-slate-400">Judge agreement (Fleiss κ): answer correctness {fmt(ev.judge_agreement.answer?.fleiss_kappa ?? null)}, claim support {fmt(ev.judge_agreement.claim?.fleiss_kappa ?? null)} — fair-to-moderate; results are automatic, not human legal review.</p>}
    </div>
  )
}
