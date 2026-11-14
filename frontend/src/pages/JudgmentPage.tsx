import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Loader2 } from 'lucide-react'
import { api, type Judgment } from '../api'

export default function JudgmentPage() {
  const { docId } = useParams(); const [sp] = useSearchParams(); const focus = sp.get('chunk')
  const [d, setD] = useState<{ judgment: Judgment; chunks: { chunk_id: string; chunk_index: number; text: string }[]; pdf_available: boolean } | null>(null)
  const [err, setErr] = useState<string | null>(null); const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { api.judgment(docId!).then(setD).catch((e) => setErr(e.message)) }, [docId])
  useEffect(() => { if (d && focus) setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300) }, [d, focus])
  if (err) return <div className="mx-auto max-w-4xl px-5 pt-32 text-bad">{err}</div>
  if (!d) return <div className="grid h-screen place-items-center"><Loader2 className="animate-spin text-slate-500" /></div>
  const j = d.judgment
  return (
    <div className="mx-auto max-w-4xl px-5 pb-24 pt-28">
      <button onClick={() => history.back()} className="mb-6 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"><ArrowLeft size={16} />Back</button>
      <div className="glass-strong p-6">
        <div className="eyebrow">Judgment</div>
        <h1 className="mt-2 font-display text-2xl font-semibold text-white">{j.case_title || j.document_id}</h1>
        <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {[['Court', j.court], ['Case number', j.case_number], ['Decided', j.decision_date], ['Case type', j.case_type], ['Language', j.language], ['Pages', j.page_count], ['Document ID', j.document_id], ['Passages', d.chunks.length]].map(([k, v]) => (
            <div key={k as string} className="flex gap-3"><dt className="w-28 shrink-0 text-slate-500">{k}</dt><dd className="text-slate-200">{v ?? '—'}</dd></div>))}
        </dl>
        {d.pdf_available && <a href={api.pdfUrl(j.document_id)} target="_blank" rel="noreferrer" className="btn-ghost mt-5 px-4 py-2 text-sm"><ExternalLink size={14} />Open source PDF</a>}
      </div>
      <div className="mt-6 space-y-3">
        {d.chunks.map((c) => (
          <div key={c.chunk_id} ref={c.chunk_id === focus ? ref : undefined} className={`rounded-xl border p-4 ${c.chunk_id === focus ? 'border-electric-400/70 bg-electric-500/[0.08] shadow-glow' : 'border-white/[0.07] bg-white/[0.02]'}`}>
            <div className="mb-2 font-mono text-[11px] text-slate-500">{c.chunk_id}{c.chunk_id === focus && <span className="ml-2 text-electric-300">cited passage</span>}</div>
            <p className="deva whitespace-pre-wrap text-sm text-slate-300">{c.text}</p></div>))}
      </div>
      <Link to="/research" className="mt-8 inline-block text-sm text-electric-300 hover:underline">Back to questions</Link>
    </div>
  )
}
