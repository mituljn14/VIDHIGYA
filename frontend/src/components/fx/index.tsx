import { useEffect, useRef, useState, type ReactNode } from 'react'
import { animate, motion, useInView, useMotionTemplate, useMotionValue, useScroll, useSpring, useTransform } from 'framer-motion'

// Soft light that follows the cursor across the whole page.
export function Spotlight() {
  const x = useMotionValue(-500), y = useMotionValue(-500)
  useEffect(() => { const m = (e: MouseEvent) => { x.set(e.clientX); y.set(e.clientY) }; window.addEventListener('mousemove', m); return () => window.removeEventListener('mousemove', m) }, [x, y])
  const bg = useMotionTemplate`radial-gradient(520px circle at ${x}px ${y}px, rgba(63,230,210,.07), transparent 60%)`
  return <motion.div className="pointer-events-none fixed inset-0 z-30" style={{ background: bg }} aria-hidden />
}

export function ScrollProgress() {
  const { scrollYProgress } = useScroll(); const sx = useSpring(scrollYProgress, { stiffness: 120, damping: 30 })
  return <motion.div className="fixed inset-x-0 top-0 z-[60] h-[2px] origin-left bg-gradient-to-r from-electric-400 via-electric-300 to-violet-400" style={{ scaleX: sx }} />
}

// Card that tilts in 3D towards the cursor, with a glare highlight.
export function Tilt({ children, className = '', max = 8 }: { children: ReactNode; className?: string; max?: number }) {
  const ref = useRef<HTMLDivElement>(null); const px = useMotionValue(.5), py = useMotionValue(.5)
  const rx = useSpring(useTransform(py, [0, 1], [max, -max]), { stiffness: 200, damping: 20 })
  const ry = useSpring(useTransform(px, [0, 1], [-max, max]), { stiffness: 200, damping: 20 })
  const glare = useMotionTemplate`radial-gradient(400px circle at ${useTransform(px, (v) => v * 100)}% ${useTransform(py, (v) => v * 100)}%, rgba(255,255,255,.08), transparent 50%)`
  return (
    <motion.div ref={ref} style={{ rotateX: rx, rotateY: ry, transformPerspective: 900 }} className={`relative ${className}`}
      onMouseMove={(e) => { const r = ref.current!.getBoundingClientRect(); px.set((e.clientX - r.left) / r.width); py.set((e.clientY - r.top) / r.height) }}
      onMouseLeave={() => { px.set(.5); py.set(.5) }}>
      {children}
      <motion.div className="pointer-events-none absolute inset-0 rounded-[inherit]" style={{ background: glare }} />
    </motion.div>
  )
}

// Number that counts up when scrolled into view. `value` is always the real figure; only the animation is cosmetic.
export function Counter({ value, decimals = 0, className = '' }: { value: number | null | undefined; decimals?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null); const inView = useInView(ref, { once: true }); const [v, setV] = useState(0)
  useEffect(() => { if (inView && value != null) { const c = animate(0, value, { duration: 1.4, ease: 'easeOut', onUpdate: setV }); return () => c.stop() } }, [inView, value])
  return <span ref={ref} className={className}>{value == null ? '—' : v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}</span>
}

export function Marquee({ items }: { items: string[] }) {
  return (
    <div className="relative overflow-hidden py-4 [mask-image:linear-gradient(90deg,transparent,black_12%,black_88%,transparent)]">
      <div className="flex w-max animate-marquee gap-3">
        {[...items, ...items].map((t, i) => <span key={i} className="chip whitespace-nowrap border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-slate-300">{t}</span>)}
      </div>
    </div>
  )
}

// Slow-moving aurora light behind a section.
export function Aurora({ className = '' }: { className?: string }) {
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} aria-hidden>
      <div className="absolute -left-40 -top-40 h-[38rem] w-[38rem] animate-aurora rounded-full bg-electric-500/25 blur-[150px]" />
      <div className="absolute right-[-12rem] top-20 h-[32rem] w-[32rem] animate-aurora rounded-full bg-violet-500/20 blur-[150px] [animation-delay:-6s]" />
      <div className="absolute bottom-[-14rem] left-1/3 h-[30rem] w-[30rem] animate-aurora rounded-full bg-electric-600/20 blur-[150px] [animation-delay:-12s]" />
    </div>
  )
}
