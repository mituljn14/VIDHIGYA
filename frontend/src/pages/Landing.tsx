import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, useMotionValue, useScroll, useSpring, useTransform } from 'framer-motion'
import { ArrowRight, ArrowUpRight, BookOpenCheck, Brain, FileSearch, Fingerprint, Languages, Layers, ListChecks, Loader2, Quote, Repeat, Scale, ShieldCheck, Split, TriangleAlert } from 'lucide-react'
import NeuralField from '../components/NeuralField'
import PipelineViz from '../components/PipelineViz'
import { Aurora, Counter, Marquee, Tilt } from '../components/fx'
import { api, fmt, type Evaluation, type Health } from '../api'
import { useI18n } from '../i18n'

const reveal = { initial: { opacity: 0, y: 32 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: '-80px' }, transition: { duration: .8, ease: [0.22, 1, 0.36, 1] } }

function FloatingDoc({ x, y, d, r, label, depth, mx, my }: { x: string; y: string; d: number; r: number; label: string; depth: number; mx: ReturnType<typeof useMotionValue<number>>; my: ReturnType<typeof useMotionValue<number>> }) {
  const tx = useTransform(mx, (v) => v * depth), ty = useTransform(my, (v) => v * depth)
  return (
    <motion.div className="pointer-events-none absolute hidden w-48 md:block" style={{ left: x, top: y, x: tx, y: ty }}>
      <motion.div style={{ rotate: r }} animate={{ y: [0, -16, 0] }} transition={{ duration: d, repeat: Infinity, ease: 'easeInOut' }}
        className="rounded-2xl border border-white/10 bg-ink-850/70 p-3.5 shadow-2xl backdrop-blur-md">
        <div className="mb-2.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-electric-300"><Scale size={11} />{label}</div>
        {[92, 78, 85, 60, 72].map((w, i) => <div key={i} className="mb-1.5 h-1.5 rounded-full bg-white/10" style={{ width: `${w}%` }} />)}
        <div className="mt-2.5 h-1.5 w-1/2 rounded-full bg-gradient-to-r from-electric-400 to-violet-400" />
      </motion.div>
    </motion.div>
  )
}

function Section({ id, eyebrow, title, children, icon: I }: { id: string; eyebrow: string; title: React.ReactNode; children: React.ReactNode; icon: typeof Brain }) {
  return (
    <section id={id} className="relative mx-auto max-w-7xl px-5 py-24 md:py-32">
      <motion.div {...reveal}><div className="eyebrow flex items-center gap-2"><I size={14} />{eyebrow}</div><h2 className="h-section mt-4 max-w-3xl">{title}</h2></motion.div>
      <motion.div {...reveal} transition={{ ...reveal.transition, delay: .1 }} className="mt-12">{children}</motion.div>
    </section>
  )
}

function HeroSearch() {
  const { t } = useI18n(); const [q, setQ] = useState(''); const [busy, setBusy] = useState(false); const nav = useNavigate()
  const go = async () => { if (q.trim().length < 5) return nav('/research'); setBusy(true); try { const { run_id } = await api.submit(q.trim()); nav(`/research/${run_id}`) } catch { nav('/research') } }
  return (
    <div className="gborder mx-auto mt-10 max-w-2xl shadow-glow">
      <div className="gborder-in flex items-center gap-2 p-2">
        <FileSearch className="ml-3 shrink-0 text-electric-300" size={20} />
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} placeholder={t('hero_search')}
          className="deva min-w-0 flex-1 bg-transparent px-2 py-3 text-base text-white outline-none placeholder:text-slate-500" />
        <button onClick={go} disabled={busy} className="btn-primary px-5 py-2.5 text-sm">{busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}{t('research_btn')}</button>
      </div>
    </div>
  )
}

export default function Landing() {
  const { t } = useI18n()
  const [ev, setEv] = useState<Evaluation | null>(null); const [h, setH] = useState<Health | null>(null)
  useEffect(() => { api.evaluation().then(setEv).catch(() => {}); api.health().then(setH).catch(() => {}) }, [])
  const { scrollY } = useScroll(); const heroY = useTransform(scrollY, [0, 700], [0, 160]); const heroO = useTransform(scrollY, [0, 550], [1, 0])
  const mx = useSpring(useMotionValue(0), { stiffness: 60, damping: 20 }), my = useSpring(useMotionValue(0), { stiffness: 60, damping: 20 })
  const S = ev?.systems ?? {}
  const base = S['B_FROZEN_live|dev|mr'], best = S['K6_gemma312b_gated3|dev|mr'], test = S['K10_gemma312b_gated|test|mr'], btest = S['B_FROZEN_live|test|mr']
  const ret = (cfg: string, sub: string, lvl = 'judgment') => ev?.retrieval.find((r) => r.config === cfg && r.subset === sub && r.level === lvl)
  const best7 = 'hybrid_e5_clean+bge_reranker_v2m3|inDoc3+docprior', prod7 = 'hybrid_prod+ce_mmarco'

  return (
    <div className="overflow-x-hidden">
      {/* HERO */}
      <section className="relative flex min-h-screen items-center justify-center overflow-hidden"
        onMouseMove={(e) => { mx.set((e.clientX / window.innerWidth - .5) * 40); my.set((e.clientY / window.innerHeight - .5) * 40) }}>
        <Aurora />
        <div className="grid-bg absolute inset-0" />
        <NeuralField density={80} />
        <FloatingDoc x="6%" y="22%" d={7} r={-7} label="Judgment" depth={1.2} mx={mx} my={my} />
        <FloatingDoc x="79%" y="18%" d={8} r={6} label="Evidence E002" depth={-.8} mx={mx} my={my} />
        <FloatingDoc x="10%" y="66%" d={9} r={5} label="Verified claim" depth={-1.1} mx={mx} my={my} />
        <FloatingDoc x="76%" y="64%" d={7.5} r={-5} label="Sub-question T2" depth={.9} mx={mx} my={my} />
        <motion.div style={{ y: heroY, opacity: heroO }} className="relative z-10 mx-auto max-w-5xl px-5 text-center">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .8 }}
            className="mx-auto inline-flex items-center gap-2 rounded-full border border-electric-400/30 bg-electric-500/10 px-4 py-1.5 text-xs font-medium text-electric-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-electric-300" />Agentic · evidence-grounded · Marathi
          </motion.div>
          <motion.div initial={{ opacity: 0, letterSpacing: '0.9em' }} animate={{ opacity: 1, letterSpacing: '0.5em' }} transition={{ duration: 1.6, ease: 'easeOut' }}
            className="mt-6 font-display text-sm font-semibold text-violet-300 md:text-base">VIDHIGYA</motion.div>
          <motion.h1 initial={{ opacity: 0, y: 30, filter: 'blur(12px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ duration: 1.1, delay: .25 }}
            className="mt-5 font-display text-5xl font-semibold leading-[1.02] tracking-tight md:text-7xl lg:text-[6.5rem]">
            <span className="text-gradient">{t('hero_title_1')}</span><br /><span className="text-white">{t('hero_title_2')}</span>
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .9, delay: .6 }} className="mx-auto mt-6 max-w-2xl text-lg text-slate-300 md:text-xl">
            {t('hero_sub')}
          </motion.p>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .9, delay: .85 }}><HeroSearch /></motion.div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1 }} className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link to="/research" className="btn-ghost">{t('start_research')} <ArrowUpRight size={16} /></Link>
            <a href="#architecture" className="btn-ghost">{t('explore_tech')}</a>
          </motion.div>
        </motion.div>
        <div className="absolute bottom-8 left-1/2 h-10 w-6 -translate-x-1/2 rounded-full border border-white/20"><motion.div className="mx-auto mt-2 h-2 w-1 rounded-full bg-electric-300" animate={{ y: [0, 14, 0] }} transition={{ duration: 1.8, repeat: Infinity }} /></div>
      </section>

      <Marquee items={['Query decomposition', 'Hybrid BM25 + E5 retrieval', 'Cross-encoder reranking', 'In-judgment paragraph selection', 'Per-task evidence coverage', 'Targeted follow-up search', 'JSON-schema citations', 'Claim-level verification', 'Fail-closed abstention', 'Full audit trail']} />

      <Section id="about" eyebrow="About VIDHIGYA" icon={Brain} title={<>A legal AI agent that <span className="text-gradient">shows its evidence</span>.</>}>
        <div className="grid gap-5 md:grid-cols-3">
          {[[h?.registry.judgments, 'Court judgments in the registry', 'Marathi and Marathi-English'], [h?.registry.chunks, 'Searchable passages', 'cleaned PDF text'], [10, 'Controlled experiments', 'plus a same-model agentic comparison']].map(([v, l, s], i) => (
            <Tilt key={i} className="rounded-2xl"><div className="glass h-full p-6"><div className="font-display text-4xl font-semibold text-white"><Counter value={v as number | undefined} /></div>
              <div className="mt-2 text-sm text-slate-300">{l as string}</div><div className="mt-1 text-xs text-slate-500">{s as string}</div></div></Tilt>))}
        </div>
        <p className="mt-10 max-w-3xl text-lg leading-relaxed text-slate-300">VIDHIGYA breaks a legal question into tasks, searches the judgments for each, checks whether every task is covered, searches again where evidence is missing, and answers only from what it found — every sentence cited, every claim checked, and an honest "not found" when the evidence is not there.</p>
      </Section>

      <Section id="challenges" eyebrow="The challenges of Marathi legal text" icon={TriangleAlert} title="Why ordinary AI fails on Marathi case law.">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[[53, '%', 'of wrong baseline answers had the right judgment but the wrong paragraph'], [21, '%', 'missed the relevant judgment entirely'],
            [27, '%', 'of baseline claims were not supported by any retrieved evidence'], [20, ' / 21', 'unanswerable trick questions answered anyway by the original system']].map(([v, u, t]) => (
            <Tilt key={t as string} className="rounded-2xl"><div className="glass h-full p-6"><div className="font-display text-5xl font-semibold text-gradient"><Counter value={v as number} />{u as string}</div><p className="mt-4 text-sm text-slate-300">{t as string}</p></div></Tilt>))}
        </div>
        <p className="mt-4 text-xs text-slate-500">Source: root-cause analysis of the frozen original System B on the DEV benchmark (VIDHIGYA_Q1_COMPLETE_RESEARCH).</p>
      </Section>

      <Section id="agent" eyebrow="The agent" icon={Split} title={<>Eight agents. <span className="text-gradient">One audited answer.</span></>}>
        <div className="grid auto-rows-[minmax(160px,auto)] gap-4 md:grid-cols-4">
          {[[Split, 'Understands', 'Splits multi-part questions into validated sub-questions; never invents names, numbers or dates.', 'md:col-span-2'],
            [FileSearch, 'Retrieves', 'Hybrid search and reranking for every sub-question.', ''], [Layers, 'Expands', 'Picks the exact paragraphs inside the best judgments.', ''],
            [ListChecks, 'Checks coverage', 'Marks each task supported, partial or missing — with the passage IDs that prove it.', ''],
            [Repeat, 'Searches again', 'Writes targeted follow-up queries for the gaps, within a strict budget.', ''],
            [ShieldCheck, 'Verifies', 'Every claim is checked against exactly the passages it cites; unsupported claims are removed.', 'md:col-span-2']].map(([I, t, d, span], i) => {
            const Icon = I as typeof Brain
            return (<Tilt key={i} className={`rounded-2xl ${span}`} max={5}><div className="gborder h-full"><div className="gborder-in p-6">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-electric-500/30 to-violet-500/20 text-electric-300"><Icon size={20} /></div>
              <div className="mt-4 font-display text-xl text-white">{t as string}</div><p className="mt-2 text-sm text-slate-400">{d as string}</p></div></div></Tilt>) })}
        </div>
      </Section>

      <Section id="architecture" eyebrow="Interactive architecture" icon={Layers} title={<>Click any stage. <span className="text-gradient">See why it exists.</span></>}>
        <PipelineViz />
        <div className="mt-6"><Link to="/architecture" className="btn-ghost">Open the full architecture <ArrowRight size={16} /></Link></div>
      </Section>

      <Section id="marathi" eyebrow="Marathi legal intelligence" icon={Languages} title="Built for Devanagari, measured honestly.">
        <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          <Tilt className="rounded-2xl"><div className="glass deva h-full p-8 text-2xl text-white">“फौजदारी अपील … मध्ये न्यायालयाने काय निर्णय दिला?”<p className="mt-4 font-sans text-sm text-slate-400">Questions are answered in the language they are asked. Retrieval quality by question form (judgment MRR):</p></div></Tilt>
          <div className="glass space-y-4 p-7">
            {[['Marathi', 'silver_all_mr'], ['Misspelt Marathi', 'silver_all_mr_spell'], ['Paraphrased Marathi', 'silver_all_mr_paraphrase'], ['Mixed script', 'silver_all_mixed'], ['English', 'silver_all_en']].map(([l, s]) => {
              const v = Number(ret(best7, s)?.MRR ?? NaN)
              return (<div key={s}><div className="mb-1.5 flex justify-between text-sm"><span>{l}</span><span className="font-mono text-electric-300">{fmt(v)}</span></div>
                <div className="h-2 rounded-full bg-white/5"><motion.div className="h-2 rounded-full bg-gradient-to-r from-electric-400 to-violet-400" initial={{ width: 0 }} whileInView={{ width: `${(v || 0) * 100}%` }} viewport={{ once: true }} transition={{ duration: 1.2 }} /></div></div>)
            })}
            <p className="pt-2 text-xs text-slate-500">EXP08/EXP09. English and mixed-script questions retrieve markedly worse than Marathi — a documented limitation.</p>
          </div>
        </div>
      </Section>

      <Section id="retrieval" eyebrow="Hybrid retrieval" icon={FileSearch} title="Lexical precision meets semantic recall.">
        <div className="grid gap-5 md:grid-cols-3">
          {([['Right judgment ranked first', 'Hit@1'], ['Judgment ranking (MRR)', 'MRR'], ['Right paragraph in top 10', 'Recall@10', 'passage']] as const).map(([label, k, lvl]) => {
            const v = Number(ret(best7, 'silver_all_mr', lvl ?? 'judgment')?.[k] ?? NaN), b = Number(ret(prod7, 'silver_all_mr', lvl ?? 'judgment')?.[k] ?? NaN)
            return (<Tilt key={label} className="rounded-2xl"><div className="glass h-full p-7"><div className="text-sm text-slate-400">{label}</div>
              <div className="mt-4 flex items-end gap-3"><span className="font-display text-5xl font-semibold text-white"><Counter value={Number.isNaN(v) ? null : v} decimals={2} /></span>
                <span className="pb-2 text-sm text-slate-500">original {fmt(b)}</span></div>
              <div className="mt-5 h-1.5 rounded-full bg-white/5"><motion.div className="h-1.5 rounded-full bg-gradient-to-r from-electric-400 to-violet-400" initial={{ width: 0 }} whileInView={{ width: `${(v || 0) * 100}%` }} viewport={{ once: true }} transition={{ duration: 1.2 }} /></div></div></Tilt>)
          })}
        </div>
        <p className="mt-4 text-xs text-slate-500">EXP07 / EXP07b, 169 Marathi benchmark questions.</p>
      </Section>

      <Section id="generation" eyebrow="Evidence-grounded generation" icon={Quote} title="The model may only say what the evidence says.">
        <Tilt className="rounded-2xl" max={4}><div className="gborder"><div className="gborder-in p-8">
          <p className="deva text-lg text-slate-200">… न्यायालयाने अपील फेटाळले <span className="cite">E002</span> आणि आरोपीची शिक्षा कायम ठेवली <span className="cite">E004</span>.</p>
          <p className="mt-4 text-sm text-slate-400">Illustration of the answer format only. Real answers are produced live in the question workspace, cite only passages that were actually retrieved, and are checked claim by claim.</p>
        </div></div></Tilt>
      </Section>

      <Section id="verification" eyebrow="Citation & provenance verification" icon={ShieldCheck} title="Every claim is checked. Unsupported ones are removed.">
        <div className="grid gap-5 md:grid-cols-3">
          {[[best?.correct_abstention_unanswerable, base?.correct_abstention_unanswerable, 'Correct abstention on unanswerable questions', 2],
            [best?.unsupported_claim_rate, base?.unsupported_claim_rate, 'Unsupported-claim rate (lower is better)', 3],
            [best?.precision_when_answered, base?.precision_when_answered, 'Precision when answering', 2]].map(([v, b, l, d], i) => (
            <Tilt key={i} className="rounded-2xl"><div className="glass h-full p-7"><div className="font-display text-4xl font-semibold text-white"><Counter value={v as number | undefined} decimals={d as number} /></div>
              <div className="mt-2 text-sm text-slate-300">{l as string}</div><div className="mt-1 text-xs text-slate-500">DEV · frozen System B {fmt(b as number | undefined, d as number)}</div></div></Tilt>))}
        </div>
        <p className="mt-4 text-xs text-slate-500">Fixed-pipeline results (K06, DEV). The deployed agent (K12 arm F) scores 0.633 on the 139 held-out TEST questions; full comparison on the dashboard.</p>
      </Section>

      <Section id="evaluation" eyebrow="Evaluation" icon={BookOpenCheck} title="Measured against the original system — not against hope.">
        <div className="glass-strong p-6 md:p-8">
          <div className="flex flex-wrap items-center gap-3"><span className={`chip ${ev?.status === 'final' ? 'border-good/40 text-good' : 'border-violet-400/40 text-violet-300'}`}>{ev ? (ev.status === 'final' ? 'Final scores' : 'Provisional — judging in progress') : 'Loading…'}</span><span className="text-xs text-slate-500">{ev?.label}</span></div>
          <div className="mt-6 grid gap-8 md:grid-cols-2">
            {[['Development set', base, best, 'Gemma 12B + verification + gate'], ['Held-out test set', btest, test, 'Selected fixed configuration (K10a)']].map(([t, b, s, n]) => {
              const bb = b as typeof base, ss = s as typeof best
              return (<div key={t as string}><div className="text-sm text-slate-400">{t as string} — end-to-end accuracy</div>
                <div className="mt-4 space-y-4">
                  {[['Frozen System B', bb], [n as string, ss]].map(([l, d]) => { const dd = d as typeof base; const v = dd?.e2e_accuracy ?? 0
                    return (<div key={l as string}><div className="mb-1.5 flex justify-between text-sm"><span className="truncate pr-2">{l as string}</span><span className="font-mono">{fmt(dd?.e2e_accuracy)} {dd?.e2e_ci95 && <span className="text-slate-500">[{fmt(dd.e2e_ci95[0])}, {fmt(dd.e2e_ci95[1])}]</span>}</span></div>
                      <div className="relative h-3 rounded-full bg-white/5"><motion.div className="h-3 rounded-full bg-gradient-to-r from-electric-400 to-violet-400" initial={{ width: 0 }} whileInView={{ width: `${v * 100}%` }} viewport={{ once: true }} transition={{ duration: 1.3 }} />
                        <div className="absolute top-[-4px] h-5 w-0.5 rounded bg-bad" style={{ left: '95%' }} title="target 0.95" /></div></div>) })}
                </div>{(ss?.missing_majority ?? 0) > 0 && <p className="mt-3 text-xs text-violet-300">{ss?.missing_majority} answers still awaiting a 2-of-3 judge majority — counted as not correct until judged.</p>}</div>)
            })}
          </div>
          <p className="mt-6 text-sm text-slate-400">Red marker: the 0.95 target. It has <b className="text-slate-200">not</b> been reached; every gap is documented in the validation report.</p>
        </div>
      </Section>

      <section className="relative mx-auto max-w-7xl px-5 pb-32">
        <motion.div {...reveal} className="relative overflow-hidden rounded-[2rem] border border-white/10 p-10 text-center md:p-20">
          <Aurora className="opacity-80" />
          <div className="relative">
            <Fingerprint className="mx-auto text-electric-300" size={44} />
            <h2 className="h-section mx-auto mt-6 max-w-2xl">Answers you can audit, sentence by sentence.</h2>
            <p className="mx-auto mt-4 max-w-xl text-slate-300">Ask a question in Marathi. Watch the agent work. Inspect every passage behind the answer.</p>
            <Link to="/research" className="btn-primary mt-8">Ask a Legal Question <ArrowRight size={18} /></Link>
            <p className="mt-6 text-xs text-slate-500">Automatic output — not legal advice. Verify every answer against the cited judgments.</p>
          </div>
        </motion.div>
      </section>
    </div>
  )
}
