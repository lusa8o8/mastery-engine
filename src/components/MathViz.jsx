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

    if (!isFinite(minY) || !isFinite(maxY)) return yRange || [-10, 10]

    // Add 15% padding above and below
    const padding = Math.max((maxY - minY) * 0.15, 1)
    return [Math.floor(minY - padding), Math.ceil(maxY + padding)]
  })()

  const yExtent = computedYExtent
  return (
    <div style={{ margin: '1rem 0', border: '1px solid var(--border)', borderRadius: '2px' }}>
      <Mafs
        xAxisExtent={xExtent}
        yAxisExtent={yExtent}
        height={280}
      >
        <Coordinates.Cartesian />
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

// --- Dispatcher ---
const RENDERERS = {
  function_plot: FunctionPlot,
  histogram: Histogram,
  number_line: NumberLine,
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
