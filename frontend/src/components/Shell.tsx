import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Cpu, FileUp, FlaskConical, Gauge, Globe, History, Loader2, Network, Search, ShieldCheck, Sparkles, Zap } from 'lucide-react'
import CourtroomBackdrop from './CourtroomBackdrop'
import { LANG_NAMES, useI18n, type Key, type Lang } from '../i18n'
import { ScrollProgress, Spotlight } from './fx'
import DomTranslate from './DomTranslate'
import { modelsApi, type LlmModel } from '../api'

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
        <defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#3fe6d2" /><stop offset="1" stopColor="#ffbf57" /></linearGradient></defs>
        <rect width="64" height="64" rx="16" fill="#0a1218" stroke="rgba(255,255,255,.12)" />
        <path d="M14 18 L32 48 L50 18" fill="none" stroke="url(#lg)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="32" cy="18" r="4" fill="#ffd89a" />
      </svg>
      <span className="font-display font-semibold tracking-[0.2em] text-white">VIDHIGYA</span>
    </span>
  )
}

const NAV: { to: string; label: Key; icon: typeof Search }[] = [
  { to: '/research', label: 'nav_research', icon: Search },
  { to: '/history', label: 'nav_history', icon: History },
  { to: '/upload', label: 'nav_upload', icon: FileUp },
  { to: '/experiments', label: 'nav_experiments', icon: FlaskConical },
  { to: '/architecture', label: 'nav_architecture', icon: Network },
  { to: '/dashboard', label: 'nav_dashboard', icon: Gauge },
]

function LangSwitch() {
  const { lang, setLang } = useI18n(); const [open, setOpen] = useState(false)
  return (
    <div className="relative" onMouseLeave={() => setOpen(false)}>
      <button onClick={() => setOpen(!open)} aria-label="Change language" className="flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-2 text-sm text-slate-300 transition hover:border-electric-400/50 hover:text-white">
        <Globe size={16} className="text-electric-300" /><span className="hidden sm:inline">{LANG_NAMES[lang]}</span></button>
      {open && <div className="absolute right-0 top-full mt-2 w-40 overflow-hidden rounded-xl border border-white/10 bg-ink-850/95 p-1 shadow-2xl backdrop-blur-xl">
        {(Object.keys(LANG_NAMES) as Lang[]).map((l) => (
          <button key={l} onClick={() => { setLang(l); setOpen(false) }} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition ${l === lang ? 'bg-electric-500/15 text-electric-300' : 'text-slate-300 hover:bg-white/5'}`}>
            <span className={l === 'en' ? '' : 'deva'}>{LANG_NAMES[l]}</span>{l === lang && <Check size={14} />}</button>))}
      </div>}
    </div>
  )
}

// LLM-agnostic: choose the generator among the chat models installed in the local Ollama (a new GPU model appears here once
// pulled with "ollama pull <name>"). Only gemma3:12b is validated; any other model is labelled and announced on every page.
let llmListeners: ((m: string) => void)[] = []
function LlmSwitch() {
  const { t } = useI18n(); const [open, setOpen] = useState(false); const [d, setD] = useState<{ active: string; validated: string; models: LlmModel[] } | null>(null)
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null)
  const load = () => modelsApi.list().then(setD).catch(() => setD(null))
  useEffect(() => { load() }, [])
  const pick = async (m: string) => {
    setBusy(m); setErr(null)
    try { const r = await modelsApi.select(m); setD((x) => x && { ...x, active: r.active }); llmListeners.forEach((f) => f(r.active)); setOpen(false) }
    catch (e) { setErr((e as Error).message.replace(/^\d+: /, '')) } finally { setBusy(null) }
  }
  const fast = (m: LlmModel) => !m.validated && m.size_gb < 5
  return (
    <div className="relative" onMouseLeave={() => { setOpen(false); setErr(null) }}>
      <button onClick={() => { setOpen(!open); load() }} aria-label={t('llm_choose')} title={t('llm_choose')}
        className="flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-2 text-sm text-slate-300 transition hover:border-electric-400/50 hover:text-white">
        <Cpu size={16} className={d && d.active !== d.validated ? 'text-warn' : 'text-electric-300'} /><span className="hidden font-mono text-xs lg:inline">{d?.active ?? 'LLM'}</span></button>
      {open && <div className="absolute right-0 top-full mt-2 w-72 overflow-hidden rounded-xl border border-white/10 bg-ink-850/95 p-1 shadow-2xl backdrop-blur-xl">
        <div className="px-3 pb-1 pt-2 text-[11px] uppercase tracking-wider text-slate-500">{t('llm_title')}</div>
        {!d ? <p className="px-3 py-3 text-sm text-slate-400">{t('llm_unavailable')}</p> : d.models.map((m) => (
          <button key={m.name} disabled={!!busy} onClick={() => pick(m.name)} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${m.name === d.active ? 'bg-electric-500/15 text-electric-300' : 'text-slate-300 hover:bg-white/5'}`}>
            <span className="font-mono text-xs">{m.name}</span>
            {m.validated && <span className="chip border-good/40 py-0 text-[10px] text-good"><ShieldCheck size={10} />{t('llm_validated')}</span>}
            {fast(m) && <span className="chip border-violet-400/40 py-0 text-[10px] text-violet-300"><Zap size={10} />{t('llm_fast')}</span>}
            <span className="ml-auto text-[11px] text-slate-500">{m.size_gb} GB</span>
            {busy === m.name ? <Loader2 size={13} className="animate-spin" /> : m.name === d.active ? <Check size={14} /> : null}</button>))}
        {err && <p className="mx-2 my-1 rounded-lg bg-bad/10 px-2 py-1.5 text-xs text-bad">{err}</p>}
        <p className="border-t border-white/5 px-3 py-2 text-[11px] leading-snug text-slate-500">{t('llm_note')}</p>
      </div>}
    </div>
  )
}

function LlmBanner() {
  const { t } = useI18n(); const [m, setM] = useState<{ active: string; validated: string } | null>(null)
  useEffect(() => {
    modelsApi.list().then((d) => setM(d)).catch(() => {})
    const f = (a: string) => setM((x) => x && { ...x, active: a }); llmListeners.push(f)
    return () => { llmListeners = llmListeners.filter((g) => g !== f) }
  }, [])
  if (!m || m.active === m.validated) return null
  return <div className="pointer-events-none fixed inset-x-0 top-[4.6rem] z-40 mx-auto flex max-w-7xl justify-center px-4"><div className="flex items-center gap-2 rounded-full border border-warn/40 bg-ink-950/85 px-4 py-1.5 text-xs text-warn backdrop-blur">
    <AlertTriangle size={13} /><span>{t('llm_banner_a')} <b className="font-mono">{m.active}</b> {t('llm_banner_b')} {m.validated}.</span></div></div>
}

export default function Shell() {
  const loc = useLocation(); const { t } = useI18n()
  return (
    <div className="noise min-h-screen">
      <CourtroomBackdrop /><ScrollProgress /><Spotlight /><DomTranslate /><LlmBanner />
      <header className="fixed inset-x-0 top-0 z-50">
        <div className="mx-auto mt-3 flex max-w-7xl items-center justify-between rounded-2xl border border-white/10 bg-ink-950/60 px-4 py-2.5 backdrop-blur-xl md:px-6">
          <Link to="/" aria-label="VIDHIGYA home"><Logo /></Link>
          <nav className="flex items-center gap-1">
            {NAV.map(({ to, label, icon: I }) => (
              <NavLink key={to} to={to} className={({ isActive }) => `flex items-center gap-2 rounded-full px-3 py-2 text-sm transition ${isActive ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'}`}>
                <I size={16} /><span className="hidden sm:inline">{t(label)}</span>
              </NavLink>
            ))}
            <Link to="/research" className="btn-primary ml-2 hidden px-4 py-2 text-sm md:inline-flex"><Sparkles size={15} />{t('new_research')}</Link>
            <div className="ml-1"><LangSwitch /></div>
            <div className="ml-1"><LlmSwitch /></div>
          </nav>
        </div>
      </header>
      <AnimatePresence mode="wait">
        <motion.main key={loc.pathname.split('/')[1]} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: .35, ease: 'easeOut' }}>
          <Outlet />
        </motion.main>
      </AnimatePresence>
    </div>
  )
}
