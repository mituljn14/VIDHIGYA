import { useEffect, useRef } from 'react'

// Lightweight animated neural network (2D canvas). Pauses when off-screen or when the user prefers reduced motion.
export default function NeuralField({ density = 70, className = '' }: { density?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current!; const ctx = c.getContext('2d')!
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let w = 0, h = 0, raf = 0, visible = true; const dpr = Math.min(window.devicePixelRatio || 1, 2)
    type P = { x: number; y: number; vx: number; vy: number; r: number; hue: number }
    let pts: P[] = []
    const mouse = { x: -1e4, y: -1e4 }
    const resize = () => {
      w = c.clientWidth; h = c.clientHeight; c.width = w * dpr; c.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const n = Math.round(density * Math.min(1.6, (w * h) / (1280 * 800)))
      pts = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - .5) * .25,
        vy: (Math.random() - .5) * .25, r: Math.random() * 1.6 + .6, hue: Math.random() < .72 ? 172 : 38 }))
    }
    const draw = () => {
      ctx.clearRect(0, 0, w, h)
      for (const p of pts) {
        if (!reduce) { p.x += p.vx; p.y += p.vy; if (p.x < 0 || p.x > w) p.vx *= -1; if (p.y < 0 || p.y > h) p.vy *= -1 }
        const dm = Math.hypot(p.x - mouse.x, p.y - mouse.y); if (dm < 140 && !reduce) { p.x += (p.x - mouse.x) / dm * .6; p.y += (p.y - mouse.y) / dm * .6 }
      }
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i], b = pts[j], d = Math.hypot(a.x - b.x, a.y - b.y)
        if (d < 130) { ctx.strokeStyle = `hsla(${a.hue},90%,70%,${(1 - d / 130) * .18})`; ctx.lineWidth = .7; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke() }
      }
      for (const p of pts) { ctx.fillStyle = `hsla(${p.hue},95%,72%,.75)`; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill() }
      if (visible && !reduce) raf = requestAnimationFrame(draw)
    }
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw) } })
    const mv = (e: MouseEvent) => { const r = c.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top }
    resize(); draw(); io.observe(c); window.addEventListener('resize', resize); window.addEventListener('mousemove', mv)
    return () => { cancelAnimationFrame(raf); io.disconnect(); window.removeEventListener('resize', resize); window.removeEventListener('mousemove', mv) }
  }, [density])
  return <canvas ref={ref} className={`absolute inset-0 h-full w-full ${className}`} aria-hidden />
}
