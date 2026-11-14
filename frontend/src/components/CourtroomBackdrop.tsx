// Faint courtroom silhouette behind every page: a judge at the raised bench under the scales emblem, columns, the clerk's desk,
// two advocates in gowns at their lecterns and the public gallery. Original vector drawing (no photo), decorative only.
function Person({ x, y, s = 1, gown = true }: { x: number; y: number; s?: number; gown?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <circle cx="0" cy="-58" r="15" />
      <path d={gown ? 'M-26 -38 Q0 -46 26 -38 L36 40 L-36 40 Z' : 'M-22 -38 Q0 -46 22 -38 L26 10 L-26 10 Z'} />
      {gown && <path d="M-5 -38 L5 -38 L3 -22 L-3 -22 Z" fill="#071014" opacity=".55" />}
    </g>
  )
}

export default function CourtroomBackdrop() {
  const cols = [120, 300, 1300, 1480]
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" className="h-full w-full">
        <defs>
          <linearGradient id="cr-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8ff5e8" stopOpacity="0" />
            <stop offset=".35" stopColor="#8ff5e8" stopOpacity=".55" />
            <stop offset="1" stopColor="#8ff5e8" stopOpacity="1" />
          </linearGradient>
          <radialGradient id="cr-glow" cx=".5" cy=".42" r=".5">
            <stop offset="0" stopColor="#ffbf57" stopOpacity=".10" />
            <stop offset="1" stopColor="#ffbf57" stopOpacity="0" />
          </radialGradient>
          <mask id="cr-mask"><rect width="1600" height="900" fill="url(#cr-fade)" /></mask>
        </defs>
        <rect width="1600" height="900" fill="url(#cr-glow)" />
        <g mask="url(#cr-mask)" fill="#8ff5e8" opacity=".085">
          {/* columns with capitals and bases */}
          {cols.map((x) => (
            <g key={x}>
              <rect x={x - 34} y="150" width="68" height="18" rx="3" /><rect x={x - 24} y="168" width="48" height="560" />
              <rect x={x - 34} y="728" width="68" height="16" rx="3" />
              {[-12, 0, 12].map((d) => <rect key={d} x={x + d - 2} y="175" width="3" height="545" fill="#071014" opacity=".35" />)}
            </g>))}
          {/* cornice */}
          <rect x="60" y="128" width="1480" height="16" rx="4" />
          {/* emblem: wheel with scales */}
          <circle cx="800" cy="215" r="58" fill="none" stroke="#8ff5e8" strokeWidth="6" />
          <path d="M800 175 L800 255 M760 195 L840 195 M766 195 L752 228 L780 228 Z M834 195 L820 228 L848 228 Z M782 255 L818 255" stroke="#8ff5e8" strokeWidth="5" fill="none" strokeLinejoin="round" />
          {/* judge's high-backed chair and judge */}
          <rect x="745" y="300" width="110" height="200" rx="18" />
          <Person x={800} y={420} s={1.35} />
          {/* raised bench with panelled front, nameplate and gavel */}
          <rect x="470" y="455" width="660" height="22" rx="4" />
          <rect x="490" y="477" width="620" height="160" />
          {[540, 660, 780, 900, 1020].map((x) => <rect key={x} x={x} y="497" width="80" height="120" rx="4" fill="#071014" opacity=".4" />)}
          <rect x="745" y="430" width="70" height="14" rx="3" transform="rotate(-18 780 437)" />
          <rect x="776" y="440" width="8" height="30" rx="2" transform="rotate(-18 780 437)" />
          <rect x="826" y="447" width="34" height="8" rx="3" />
          {/* clerk's desk below the bench */}
          <rect x="640" y="660" width="320" height="70" rx="6" />
          <Person x={800} y={668} s={0.8} gown={false} />
          {/* advocates at their lecterns */}
          <Person x={430} y={720} s={1.25} /><rect x="470" y="660" width="70" height="90" rx="6" /><rect x="460" y="650" width="90" height="14" rx="4" />
          <Person x={1170} y={720} s={1.25} /><rect x="1060" y="660" width="70" height="90" rx="6" /><rect x="1050" y="650" width="90" height="14" rx="4" />
          {/* public gallery: two rows of benches with seated people */}
          {[0, 1].map((r) => (
            <g key={r}>
              {Array.from({ length: 13 }, (_, i) => <circle key={i} cx={110 + i * 115 + (r ? 57 : 0)} cy={800 + r * 55} r={r ? 17 : 15} />)}
              {Array.from({ length: 13 }, (_, i) => <path key={i} d={`M${86 + i * 115 + (r ? 57 : 0)} ${818 + r * 55} q24 -10 48 0 l6 40 h-60 z`} />)}
              <rect x="40" y={845 + r * 55} width="1520" height="14" rx="5" />
            </g>))}
          {/* floor line */}
          <rect x="0" y="752" width="1600" height="4" />
        </g>
      </svg>
    </div>
  )
}
