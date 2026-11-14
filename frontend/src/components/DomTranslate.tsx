import { useEffect } from 'react'
import { useI18n } from '../i18n'
import { UI } from '../uiTranslations'

// Whole-interface translation: when the language is not English, every text node (and placeholder / title / aria-label) whose
// exact text is a known English UI string is swapped for its Marathi or Hindi version. Only text this component changed is ever
// restored to English, so Devanagari text written by the app or the user (questions, answers, evidence, the language names in
// the menu) is never touched.
const MAP: Record<'mr' | 'hi', Map<string, string>> = { mr: new Map(UI.map(([e, m]) => [e, m])), hi: new Map(UI.map(([e, , h]) => [e, h])) }
const ORIG = new WeakMap<Node, string>()                    // text node -> its English text before we changed it
const SET = new WeakMap<Node, string>()                     // text node -> the value we wrote (to detect React overwrites)
const AORIG = new WeakMap<Element, Record<string, string>>(); const ASET = new WeakMap<Element, Record<string, string>>()
const ATTRS = ['placeholder', 'title', 'aria-label']
type L = 'en' | 'mr' | 'hi'

function tr(raw: string, en: string, lang: L) { const out = lang === 'en' ? en : MAP[lang].get(en); return out ? raw.replace(raw.trim(), out) : null }

function doText(n: Node, lang: L) {
  const raw = n.nodeValue || ''; const ours = SET.get(n) === raw
  if (!ours) { ORIG.delete(n); SET.delete(n) }               // React wrote a new value: forget the old record
  const en = ours ? ORIG.get(n)! : (MAP.mr.has(raw.trim()) ? raw : null)
  if (en === null || en === undefined) return
  if (lang === 'en') { if (ours) { n.nodeValue = en; ORIG.delete(n); SET.delete(n) } return }
  const v = tr(en, en.trim(), lang); if (v === null || v === raw) return
  ORIG.set(n, en); SET.set(n, v); n.nodeValue = v
}

function doAttrs(el: Element, lang: L) {
  ATTRS.forEach((a) => {
    const cur = el.getAttribute(a); if (!cur) return
    const o = AORIG.get(el) || {}; const s = ASET.get(el) || {}; const ours = s[a] === cur
    const en = ours ? o[a] : (MAP.mr.has(cur.trim()) ? cur : null)
    if (!en) return
    if (lang === 'en') { if (ours) { el.setAttribute(a, en); delete o[a]; delete s[a] } return }
    const v = tr(en, en.trim(), lang); if (!v || v === cur) return
    o[a] = en; s[a] = v; AORIG.set(el, o); ASET.set(el, s); el.setAttribute(a, v)
  })
}

function apply(root: Node, lang: L) {
  if (root.nodeType === Node.TEXT_NODE) { doText(root, lang); return }
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n: Node | null
  while ((n = w.nextNode())) doText(n, lang)
  if (root instanceof Element) [root, ...root.querySelectorAll('[placeholder],[title],[aria-label]')].forEach((e) => doAttrs(e, lang))
}

export default function DomTranslate() {
  const { lang } = useI18n()
  useEffect(() => {
    const L = lang as L; const root = document.getElementById('root'); if (!root) return
    apply(root, L)
    const opts = { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS }
    const obs = new MutationObserver((ms) => {
      obs.disconnect()
      for (const m of ms) {
        if (m.type === 'characterData') doText(m.target, L)
        else if (m.type === 'attributes' && m.target instanceof Element) doAttrs(m.target, L)
        else m.addedNodes.forEach((x) => apply(x, L))
      }
      obs.observe(root, opts)
    })
    obs.observe(root, opts)
    return () => obs.disconnect()
  }, [lang])
  return null
}
