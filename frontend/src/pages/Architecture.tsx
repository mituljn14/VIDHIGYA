import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Cpu, Database, Monitor, Server } from 'lucide-react'
import PipelineViz from '../components/PipelineViz'
import { AgentTech, AgentWorkflowDiagram, UploadWorkflowDiagram } from '../components/AgentWorkflow'
import NeuralField from '../components/NeuralField'
import { api, type Health } from '../api'
import { useI18n } from '../i18n'

const LAYERS = [
  { icon: Monitor, t: 'React frontend', d: 'React 18 · TypeScript · Vite · Tailwind CSS · Framer Motion · React Router. Talks to the API over JSON and Server-Sent Events.' },
  { icon: Server, t: 'FastAPI backend', d: 'Validated pipeline as Python modules; questions run on a background worker and stream stage events.' },
  { icon: Database, t: 'SQLite registry + audit log', d: 'Judgment metadata, 98,509 passages, every run with its evidence, claim checks and timings.' },
  { icon: Cpu, t: 'Local inference', d: 'Ollama for generation and verification; Sentence-Transformers for E5 and the bge reranker. Nothing leaves the machine.' },
]

export default function Architecture() {
  const { t } = useI18n()
  const [h, setH] = useState<Health | null>(null)
  useEffect(() => { api.health().then(setH).catch(() => {}) }, [])
  return (
    <div>
      <section className="relative overflow-hidden pb-10 pt-36">
        <NeuralField density={40} className="opacity-60" />
        <div className="relative mx-auto max-w-7xl px-5">
          <div className="eyebrow">Agentic architecture · LangGraph</div>
          <h1 className="h-section mt-3 max-w-4xl">{t('architecture_title')}</h1>
          <p className="mt-4 max-w-3xl text-slate-300">A bounded LangGraph agent built on the validated retrieval and verification components: it decomposes the question, retrieves and expands evidence per task, checks coverage, searches again for gaps, writes a cited answer, verifies every claim and abstains when evidence is missing. Click a node to see what it does and its exact settings. Selected on DEV in the same-model comparison (K12, arm F: 0.679 vs fixed pipeline 0.633); confirmed on 139 held-out TEST questions at 0.633 (fixed pipeline 0.561, single-pass 0.446, frozen System B 0.065). Automatic 3-judge evaluation, not human legal review; still below the 0.80 target. Details on the dashboard.</p>
          {h && <div className="mt-6 flex flex-wrap gap-2 text-xs">{Object.entries(h.configuration).map(([k, v]) => <span key={k} className="chip border-white/10 bg-ink-900/70 font-mono text-slate-300"><span className="text-slate-500">{k}</span>{v}</span>)}</div>}
        </div>
      </section>
      <section className="mx-auto max-w-7xl px-5 pb-16">
        <div className="eyebrow">Agentic workflow · one diagram</div>
        <h2 className="mt-2 font-display text-2xl text-white md:text-3xl">How the agent works, end to end</h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">Drawn from the LangGraph graph the system actually runs: the question is put into Marathi, the agent plans tasks, searches, checks coverage, searches again for gaps, writes a cited answer, checks every claim and the case, and answers or abstains.</p>
        <div className="mt-6"><AgentWorkflowDiagram /></div>
      </section>
      <section className="mx-auto max-w-7xl px-5 pb-16">
        <div className="eyebrow">Upload workflow · second diagram</div>
        <h2 className="mt-2 font-display text-2xl text-white md:text-3xl">How an uploaded PDF becomes searchable</h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">From the admin upload to the search index, as the ingestion worker runs it: checks, page-by-page text cleaning with OCR only where the text is damaged, ACPMC chunking, embeddings and indexing.</p>
        <div className="mt-6"><UploadWorkflowDiagram /></div>
      </section>
      <section className="mx-auto max-w-7xl px-5 pb-16">
        <div className="eyebrow">Agentic system · technologies</div>
        <AgentTech />
      </section>
      <section className="mx-auto max-w-7xl px-5 pb-16">
        <div className="eyebrow">Each step in detail</div>
        <div className="mt-6"><PipelineViz /></div>
      </section>
      <section className="mx-auto max-w-7xl px-5 pb-28">
        <div className="eyebrow">System layers</div>
        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {LAYERS.map(({ icon: I, t, d }, i) => (
            <motion.div key={t} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * .08 }} className="glass p-6">
              <I className="text-electric-300" /><div className="mt-4 font-display text-lg text-white">{t}</div><p className="mt-2 text-sm text-slate-400">{d}</p></motion.div>))}
        </div>
      </section>
    </div>
  )
}
