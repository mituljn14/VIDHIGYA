import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, FileText, FileUp, Loader2, Lock, LogOut, ScanText, Trash2 } from 'lucide-react'
import { adminToken, AuthError, fmt, uploadsApi, type UploadDoc } from '../api'
import { useI18n } from '../i18n'

// Judgment upload: the backend runs text extraction -> corruption score -> OCR of damaged pages -> ACPMC chunking ->
// E5 vectors in Qdrant + BM25, then the judgment joins the agent's retrieval (separate store; the corpus index is untouched).
const STEPS = ['Text layer', 'Corruption score', 'OCR damaged pages', 'ACPMC chunks', 'E5 → Qdrant + BM25', 'Searchable']

function stepOf(d: UploadDoc) {
  if (d.status === 'ready') return 6
  const s = (d.stage || '').toLowerCase()
  if (s.startsWith('embedding')) return 4
  if (s.startsWith('chunking')) return 3
  if (s.startsWith('ocr')) return 2
  if (s.startsWith('extracting')) return 1
  return 0
}

function StatusBadge({ d }: { d: UploadDoc }) {
  if (d.status === 'ready') return <span className="inline-flex items-center gap-1 text-xs text-good"><CheckCircle2 size={13} />searchable</span>
  if (d.status === 'error') return <span className="inline-flex items-center gap-1 text-xs text-bad"><AlertTriangle size={13} />failed</span>
  return <span className="inline-flex items-center gap-1 text-xs text-electric-300"><Loader2 size={13} className="animate-spin" />{d.stage || d.status}</span>
}

function Login({ onDone }: { onDone: () => void }) {
  const { t } = useI18n(); const [pw, setPw] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  const submit = async (e: { preventDefault: () => void }) => {
    e.preventDefault(); setBusy(true); setErr(null)
    try { await uploadsApi.login(pw); setPw(''); onDone() } catch (x) { setErr((x as Error).message.replace(/^\d+: /, '')) } finally { setBusy(false) }
  }
  return (
    <div className="mx-auto max-w-md px-5 pb-24 pt-32">
      <form onSubmit={submit} className="glass-strong p-7">
        <div className="flex items-center gap-2 eyebrow"><Lock size={13} />{t('nav_upload')}</div>
        <h1 className="mt-2 font-display text-2xl font-semibold text-white">{t('upload_login')}</h1>
        <p className="mt-2 text-sm text-slate-400">{t('upload_login_sub')}</p>
        <label htmlFor="admin-pw" className="mt-6 block text-xs text-slate-400">{t('upload_password')}</label>
        <input id="admin-pw" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus
          className="mt-1.5 w-full rounded-xl border border-white/15 bg-ink-950/60 px-4 py-3 text-white outline-none transition focus:border-electric-400" />
        {err && <div className="mt-3 text-sm text-bad">{err}</div>}
        <button type="submit" disabled={busy || !pw} className="btn-primary mt-6 w-full justify-center disabled:opacity-50">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} />}{t('upload_signin')}</button>
      </form>
    </div>
  )
}

export default function Upload() {
  const [authed, setAuthed] = useState(() => !!adminToken.get())
  return authed ? <UploadAdmin onLogout={() => setAuthed(false)} /> : <Login onDone={() => setAuthed(true)} />
}

function UploadAdmin({ onLogout }: { onLogout: () => void }) {
  const { t } = useI18n(); const input = useRef<HTMLInputElement>(null)
  const [docs, setDocs] = useState<UploadDoc[]>([]); const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null); const [over, setOver] = useState(false)
  const onErr = useCallback((e: unknown) => { if (e instanceof AuthError) onLogout(); else setErr((e as Error).message) }, [onLogout])
  const refresh = useCallback(() => uploadsApi.list().then(setDocs).catch(onErr), [onErr])
  useEffect(() => { refresh() }, [refresh])
  const active = docs.some((d) => d.status === 'queued' || d.status === 'processing')
  useEffect(() => { if (!active) return; const id = setInterval(refresh, 3000); return () => clearInterval(id) }, [active, refresh])

  const send = async (f?: File | null) => {
    if (!f) return
    if (!f.name.toLowerCase().endsWith('.pdf')) { setErr('Please choose a PDF file.'); return }
    setErr(null); setBusy(true)
    try { await uploadsApi.upload(f); await refresh() } catch (e) { onErr(e) } finally { setBusy(false); if (input.current) input.current.value = '' }
  }
  const remove = async (doc: string) => {
    if (!confirm('Remove this judgment from the library? Its chunks and vectors are deleted.')) return
    try { await uploadsApi.remove(doc); await refresh() } catch (e) { onErr(e) }
  }

  return (
    <div className="mx-auto max-w-5xl px-5 pb-24 pt-28">
      <div className="flex items-center justify-between">
        <div className="eyebrow">{t('nav_upload')}</div>
        <button onClick={() => uploadsApi.logout().finally(onLogout)} className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white"><LogOut size={13} />{t('upload_logout')}</button>
      </div>
      <h1 className="mt-2 font-display text-3xl font-semibold text-white md:text-4xl">{t('upload_title')}</h1>
      <p className="mt-3 max-w-3xl text-slate-400">{t('upload_sub')}</p>

      <div role="button" tabIndex={0} aria-label={t('upload_drop')}
        onClick={() => input.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') input.current?.click() }}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); send(e.dataTransfer.files?.[0]) }}
        className={`mt-8 grid cursor-pointer place-items-center rounded-2xl border-2 border-dashed p-10 text-center transition ${over ? 'border-electric-400 bg-electric-500/10' : 'border-white/15 hover:border-electric-400/60 hover:bg-white/[0.03]'}`}>
        <input ref={input} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => send(e.target.files?.[0])} />
        {busy ? <Loader2 className="animate-spin text-electric-300" size={32} /> : <FileUp className="text-electric-300" size={32} />}
        <div className="mt-3 font-medium text-white">{t('upload_drop')}</div>
        <div className="mt-1 text-xs text-slate-500">PDF · max 50 MB · {t('upload_cpu')}</div>
      </div>
      {err && <div className="mt-4 rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">{err}</div>}

      <div className="mt-6 grid gap-2 sm:grid-cols-6">
        {STEPS.map((s, i) => <div key={s} className="glass px-3 py-2 text-center text-[11px] text-slate-300"><span className="mr-1 font-mono text-electric-300">{i + 1}</span>{s}</div>)}
      </div>

      <h2 className="mt-10 font-display text-xl font-semibold text-white">{t('upload_library')}</h2>
      {docs.length === 0 && <p className="mt-3 text-sm text-slate-500">{t('upload_empty')}</p>}
      <div className="mt-4 space-y-3">
        {docs.map((d) => {
          const step = stepOf(d)
          return (
            <div key={d.document_id} className="glass-strong p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-medium text-white deva">{d.case_title || d.original_name || d.document_id}</div>
                  <div className="mt-1 text-xs text-slate-500">{d.case_number ? `${d.case_number} · ` : ''}{d.original_name} · <span className="font-mono">{d.document_id}</span></div>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge d={d} />
                  {d.status === 'ready' && <Link to={`/judgments/${d.document_id}`} className="btn-ghost px-3 py-1.5 text-xs"><FileText size={13} />Open</Link>}
                  <button onClick={() => remove(d.document_id)} aria-label="Remove upload" className="rounded-full p-2 text-slate-500 transition hover:bg-white/5 hover:text-bad"><Trash2 size={15} /></button>
                </div>
              </div>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className={`h-full rounded-full transition-all ${d.status === 'error' ? 'bg-bad' : 'bg-electric-400'}`} style={{ width: `${(step / 6) * 100}%` }} />
              </div>
              {d.error && <div className={`mt-2 text-xs ${d.status === 'error' ? 'text-bad' : 'text-warn'}`}>{d.error}{d.status === 'error' ? ' — upload the file again to retry.' : ''}</div>}
              <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-5">
                {[['Pages', d.page_count], ['OCR pages', d.ocr_pages], ['Corruption before', fmt(d.corruption_before, 1)], ['Corruption after', fmt(d.corruption_after, 1)], ['Chunks', d.chunks]].map(([k, v]) => (
                  <div key={k as string}><dt className="text-slate-500">{k}</dt><dd className="mt-0.5 font-mono text-slate-200">{v ?? '—'}</dd></div>))}
              </dl>
              <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500"><ScanText size={12} />chunker {d.chunker} · OCR {d.ocr_engine}{d.seconds ? ` · ${Math.round(d.seconds)} s` : ''} · corruption = impossible Devanagari patterns per 1,000 letters</div>
            </div>)
        })}
      </div>
    </div>
  )
}
