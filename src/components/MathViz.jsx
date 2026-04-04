import { Mafs, Coordinates, Plot, Theme } from 'mafs'
import 'mafs/core.css'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer
} from 'recharts'

// --- Function Plot (Mafs) ---
function FunctionPlot({ functions, xRange, yRange }) {
  const xExtent = xRange || [-5, 5]

  // Auto-calculate yRange by sampling all functions across xRange
  const computedYExtent = (() => {
    if (!functions || functions.length === 0) return yRange || [-10, 10]

    const samples = 200
    const xMin = xExtent[0]
    const xMax = xExtent[1]
    const step = (xMax - xMin) / samples
    let minY = Infinity
    let maxY = -Infinity

    functions.forEach(fn => {
      try {
        const f = new Function('x', `
          const abs = Math.abs, sqrt = Math.sqrt, sin = Math.sin,
                cos = Math.cos, tan = Math.tan, log = Math.log,
                exp = Math.exp, pow = Math.pow, PI = Math.PI;
          return ${fn.expr.replace(/\^/g, '**')}
        `)
        for (let i = 0; i <= samples; i++) {
          const x = xMin + i * step
          const y = f(x)
          if (isFinite(y)) {
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
      } catch {
        // skip invalid expressions
      }
    })

    if (!isFinite(minY) || !isFinite(maxY)) return [-10, 10]

    // Cap the visible range to keep the graph readable
    // Show vertex area clearly — limit total height to 20 units max
    const padding = Math.max((maxY - minY) * 0.1, 1)
    const rawMin = minY - padding
    const rawMax = maxY + padding
    const totalRange = rawMax - rawMin
    if (totalRange > 20) {
      // Center around the interesting area (lower portion of parabola)
      const center = rawMin + 10
      return [Math.floor(rawMin), Math.ceil(rawMin + 20)]
    }
    return [Math.floor(rawMin), Math.ceil(rawMax)]
  })()

  const yExtent = computedYExtent
  return (
    <div style={{ margin: '1rem 0', border: '1px solid var(--border)', borderRadius: '2px' }}>
      <Mafs
        viewBox={{ x: xExtent, y: yExtent, padding: 0.5 }}
        preserveAspectRatio={false}
        height={280}
      >
        <Coordinates.Cartesian
          xAxis={{ lines: 2 }}
          yAxis={{ lines: 2 }}
        />
        {(functions || []).map((fn, i) => (
          <Plot.OfX
            key={i}
            y={(x) => {
              try {
                // Safe eval using Function constructor
                const f = new Function('x', `
                  const abs = Math.abs, sqrt = Math.sqrt, sin = Math.sin,
                        cos = Math.cos, tan = Math.tan, log = Math.log,
                        exp = Math.exp, pow = Math.pow, PI = Math.PI;
                  return ${fn.expr.replace(/\^/g, '**')}
                `)
                const result = f(x)
                return isFinite(result) ? result : null
              } catch {
                return null
              }
            }}
            color={fn.color || 'var(--fg)'}
          />
        ))}
      </Mafs>
      {functions && functions.some(f => f.label) && (
        <div style={{
          display: 'flex', gap: '1rem', padding: '0.5rem 0.75rem',
          borderTop: '1px solid var(--border)', flexWrap: 'wrap'
        }}>
          {functions.map((fn, i) => fn.label && (
            <span key={i} style={{ fontSize: '0.8rem', color: fn.color || 'var(--fg)' }}>
              {fn.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// --- Histogram / Bar Chart (Recharts) ---
function Histogram({ data, xLabel, yLabel, title }) {
  if (!data || !data.length) return null
  return (
    <div style={{ margin: '1rem 0', border: '1px solid var(--border)', borderRadius: '2px', padding: '0.75rem' }}>
      {title && (
        <p style={{ fontSize: '0.85rem', marginBottom: '0.5rem', fontWeight: 'bold' }}>{title}</p>
      )}
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: 'var(--fg-muted)' }}
            label={xLabel ? { value: xLabel, position: 'insideBottom', offset: -2, fontSize: 11 } : null}
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'var(--fg-muted)' }}
            label={yLabel ? { value: yLabel, angle: -90, position: 'insideLeft', fontSize: 11 } : null}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: '2px',
              fontSize: '0.85rem'
            }}
          />
          <Bar dataKey="value" fill="var(--border-focus)" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// --- Number Line (custom SVG) ---
function NumberLine({ min, max, points, intervals, label }) {
  const w = 300
  const h = 60
  const padding = 30
  const range = max - min
  const toX = (val) => padding + ((val - min) / range) * (w - 2 * padding)

  return (
    <div style={{ margin: '1rem 0', border: '1px solid var(--border)', borderRadius: '2px', padding: '0.75rem' }}>
      {label && <p style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>{label}</p>}
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', maxWidth: w }}>
        {/* Axis line */}
        <line x1={padding} y1={h/2} x2={w - padding} y2={h/2}
          stroke="var(--fg)" strokeWidth="1.5" />
        {/* Arrows */}
        <polygon points={`${w-padding},${h/2} ${w-padding-6},${h/2-4} ${w-padding-6},${h/2+4}`}
          fill="var(--fg)" />

        {/* Tick marks and labels */}
        {Array.from({ length: max - min + 1 }, (_, i) => min + i).map(val => (
          <g key={val}>
            <line x1={toX(val)} y1={h/2 - 4} x2={toX(val)} y2={h/2 + 4}
              stroke="var(--fg)" strokeWidth="1" />
            <text x={toX(val)} y={h/2 + 16} textAnchor="middle"
              fontSize="10" fill="var(--fg-muted)">{val}</text>
          </g>
        ))}

        {/* Intervals */}
        {(intervals || []).map((interval, i) => (
          <g key={i}>
            <line
              x1={toX(interval.from)} y1={h/2}
              x2={toX(interval.to)} y2={h/2}
              stroke="var(--border-focus)" strokeWidth="4" opacity="0.6"
            />
            <circle cx={toX(interval.from)} cy={h/2} r="5"
              fill={interval.openLeft ? 'var(--bg)' : 'var(--border-focus)'}
              stroke="var(--border-focus)" strokeWidth="1.5" />
            <circle cx={toX(interval.to)} cy={h/2} r="5"
              fill={interval.openRight ? 'var(--bg)' : 'var(--border-focus)'}
              stroke="var(--border-focus)" strokeWidth="1.5" />
          </g>
        ))}

        {/* Points */}
        {(points || []).map((pt, i) => (
          <g key={i}>
            <circle cx={toX(pt.value)} cy={h/2} r="5"
              fill={pt.open ? 'var(--bg)' : 'var(--border-focus)'}
              stroke="var(--border-focus)" strokeWidth="1.5" />
            {pt.label && (
              <text x={toX(pt.value)} y={h/2 - 10} textAnchor="middle"
                fontSize="10" fill="var(--fg)">{pt.label}</text>
            )}
          </g>
        ))}
      </svg>
    </div>
  )
}

// --- Venn Diagram ---
const shadeRegionVenn = (regionId, circles, is3Set, w, h, shadeFill, shadeOpacity) => {
  const inSets = []
  const outSets = []
  const count = is3Set ? 3 : 2
  const map3 = {
    A_only: [0], B_only: [1], C_only: [2],
    A_intersect_B: [0, 1], A_intersect_C: [0, 2], B_intersect_C: [1, 2],
    A_intersect_B_intersect_C: [0, 1, 2],
    outside: []
  }
  const map2 = {
    A_only: [0], B_only: [1],
    A_intersect_B: [0, 1],
    outside: []
  }
  const map = is3Set ? map3 : map2
  const ins = map[regionId] || []
  for (let i = 0; i < count; i++) {
    ins.includes(i) ? inSets.push(i) : outSets.push(i)
  }
  if (regionId === 'outside') {
    return {
      html: '<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="' + shadeFill + '" opacity="' + shadeOpacity + '"/>' +
        circles.map(function(c) { return '<circle cx="' + c.x + '" cy="' + c.y + '" r="' + c.r + '" fill="var(--bg)"/>'; }).join(''),
      extraDefs: ''
    }
  }
  if (inSets.length === 0) return { html: '', extraDefs: '' }
  if (outSets.length === 0) {
    const html = inSets.reduce(function(inner, i) {
      return '<g clip-path="url(#vcp' + i + ')">' + inner + '</g>'
    }, '<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="' + shadeFill + '" opacity="' + shadeOpacity + '"/>')
    return { html: html, extraDefs: '' }
  }
  const maskId = 'vmask_' + regionId.replace(/\W/g, '_')
  let maskContent = '<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="black"/>'
  maskContent += '<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="white" ' +
    inSets.map(function(i) { return 'clip-path="url(#vcp' + i + ')"'; }).join(' ') + '/>'
  outSets.forEach(function(i) {
    maskContent += '<circle cx="' + circles[i].x + '" cy="' + circles[i].y + '" r="' + circles[i].r + '" fill="black"/>'
  })
  const extraDefs = '<mask id="' + maskId + '">' + maskContent + '</mask>'
  const html = inSets.reduce(function(inner, i) {
    return '<g clip-path="url(#vcp' + i + ')">' + inner + '</g>'
  }, '<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="' + shadeFill + '" opacity="' + shadeOpacity + '" mask="url(#' + maskId + ')"/>')
  return { html: html, extraDefs: extraDefs }
}

function VennDiagram({ sets, shaded, universal }) {
  const safeSets = Array.isArray(sets) ? sets : []
  const safeShaded = Array.isArray(shaded) ? shaded : []
  const safeUniversal = universal || 'U'
  const is3Set = safeSets.length === 3
  const w = 320
  const h = is3Set ? 320 : 240
  const cx = w / 2
  const cy = is3Set ? 130 : h / 2
  const circles = is3Set ? [
    { x: cx - 45, y: cy - 30, r: 75, label: safeSets[0] },
    { x: cx + 45, y: cy - 30, r: 75, label: safeSets[1] },
    { x: cx, y: cy + 55, r: 75, label: safeSets[2] }
  ] : [
    { x: cx - 50, y: cy, r: 85, label: safeSets[0] },
    { x: cx + 50, y: cy, r: 85, label: safeSets[1] }
  ]
  const fg = 'var(--fg)'
  const shadeFill = 'var(--border-focus)'
  const shadeOpacity = '0.45'
  const circleStroke = 'var(--border-focus)'
  let clipPaths = ''
  circles.forEach(function(c, i) {
    clipPaths += '<clipPath id="vcp' + i + '"><circle cx="' + c.x + '" cy="' + c.y + '" r="' + c.r + '"/></clipPath>'
  })
  let extraDefs = ''
  let shadeLayers = ''
  safeShaded.forEach(function(regionId) {
    const result = shadeRegionVenn(regionId, circles, is3Set, w, h, shadeFill, shadeOpacity)
    extraDefs += result.extraDefs
    shadeLayers += result.html
  })
  const finalDefs = '<defs>' + clipPaths + extraDefs + '</defs>'
  const circleOutlines = circles.map(function(c) {
    return '<circle cx="' + c.x + '" cy="' + c.y + '" r="' + c.r + '" fill="transparent" stroke="' + circleStroke + '" stroke-width="1.5"/>'
  }).join('')
  const labelOffsets = is3Set
    ? [{ dx: -75, dy: -65 }, { dx: 75, dy: -65 }, { dx: 0, dy: 95 }]
    : [{ dx: -80, dy: 0 }, { dx: 80, dy: 0 }]
  const labels = circles.map(function(c, i) {
    return '<text x="' + (c.x + labelOffsets[i].dx) + '" y="' + (c.y + labelOffsets[i].dy) + '" text-anchor="middle" font-size="13" font-family="Georgia,serif" fill="' + fg + '" font-weight="bold">' + c.label + '</text>'
  }).join('')
  const uLabel = '<text x="8" y="18" font-size="11" font-family="Georgia,serif" fill="' + fg + '" opacity="0.6">' + safeUniversal + '</text>'
  const svgStr = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" style="display:block;margin:1rem auto;border:1px solid var(--border);border-radius:2px;background:var(--bg)">' +
    finalDefs +
    '<rect x="1" y="1" width="' + (w - 2) + '" height="' + (h - 2) + '" rx="2" fill="transparent" stroke="var(--border)" stroke-width="1"/>' +
    shadeLayers + circleOutlines + labels + uLabel + '</svg>'
  return <div dangerouslySetInnerHTML={{ __html: svgStr }} />
}
// --- Dispatcher ---
const RENDERERS = {
  function_plot: FunctionPlot,
  histogram: Histogram,
  number_line: NumberLine,
  set_diagram: VennDiagram,
}

export default function MathViz({ type, content }) {
  try {
    const spec = JSON.parse(content)
    const vizType = spec.type || type
    const Renderer = RENDERERS[vizType]
    if (!Renderer) {
      return (
        <pre style={{
          fontFamily: 'monospace', fontSize: '0.85rem',
          background: 'var(--bg-subtle)', border: '1px solid var(--border)',
          borderRadius: '2px', padding: '0.75rem', margin: '0.75rem 0',
          overflowX: 'auto', whiteSpace: 'pre'
        }}>
          {content}
        </pre>
      )
    }
    return <Renderer {...spec} />
  } catch (e) {
    return (
      <p style={{ color: 'var(--error)', fontSize: '0.85rem', margin: '0.5rem 0' }}>
        Visualization unavailable ({e.message})
      </p>
    )
  }
}

