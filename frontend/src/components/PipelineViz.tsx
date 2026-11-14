import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronRight, FlaskConical, Settings2 } from 'lucide-react'
import { STAGES } from '../pipeline'

// Interactive view of the selected architecture. `active` highlights a live stage (research timeline);
// without it a pulse travels along the pipeline.
export default function PipelineViz({ active, compact = false }: { active?: number; compact?: boolean }) {
  const [sel, setSel] = useState(active ?? 1)
  const s = STAGES[sel]
  return (
    <div className={`grid gap-6 ${compact ? '' : 'lg:grid-cols-[1.15fr_1fr]'}`}>
      <div className="relative">
        <div className="absolute left-[27px] top-6 bottom-6 w-px bg-gradient-to-b from-electric-500/60 via-violet-500/40 to-transparent" />
        {active === undefined && (
          <motion.div className="absolute left-[23px] h-2.5 w-2.5 rounded-full bg-electric-300 shadow-glow"
            animate={{ top: ['3%', '95%'] }} transition={{ duration: 6, repeat: Infinity, ease: 'linear' }} />
        )}
        <ol className="space-y-2">
          {STAGES.map((st, i) => {
            const I = st.icon; const on = i === sel; const done = active !== undefined && i < active; const now = active === i
            return (
              <li key={st.id}>
                <button onClick={() => setSel(i)} className={`group relative flex w-full items-center gap-4 rounded-xl px-3 py-2.5 text-left transition
                  ${on ? 'bg-white/[0.07] ring-1 ring-electric-400/40' : 'hover:bg-white/[0.04]'}`}>
                  <span className={`relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition
                    ${now ? 'border-electric-300 bg-electric-500/30 text-white shadow-glow' : done ? 'border-good/50 bg-good/10 text-good' : on ? 'border-electric-400/60 bg-ink-800 text-electric-300' : 'border-white/10 bg-ink-850 text-slate-400'}`}>
                    <I size={16} />
                    {now && <span className="absolute inset-0 animate-ping rounded-lg border border-electric-300/60" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-white">{st.title}</span>
                    {!compact && <span className="block truncate text-xs text-slate-500">{st.config ?? st.short}</span>}
                  </span>
                  <ChevronRight size={16} className={`text-slate-600 transition ${on ? 'translate-x-0.5 text-electric-300' : 'group-hover:text-slate-400'}`} />
                </button>
              </li>
            )
          })}
        </ol>
      </div>
      {!compact && (
        <AnimatePresence mode="wait">
          <motion.div key={s.id} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: .25 }}
            className="glass-strong h-fit p-6 lg:sticky lg:top-28">
            <div className="eyebrow">Stage {sel + 1} of {STAGES.length}</div>
            <h3 className="mt-2 font-display text-2xl font-semibold text-white">{s.title}</h3>
            <p className="mt-3 leading-relaxed text-slate-300">{s.detail}</p>
            {s.config && <div className="mt-5 flex items-start gap-2.5 rounded-xl bg-ink-900/70 p-3 font-mono text-xs text-electric-300"><Settings2 size={15} className="mt-0.5 shrink-0" />{s.config}</div>}
            {s.evidence && <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-violet-400/20 bg-violet-500/[0.06] p-3 text-sm text-violet-200"><FlaskConical size={15} className="mt-0.5 shrink-0" />{s.evidence}</div>}
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  )
}
