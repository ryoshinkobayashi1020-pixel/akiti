import type { RevenueProjection } from '../types/diagnosis'
import { formatManYen } from '../lib/format'

interface Props {
  projections: RevenueProjection[]
  assumption?: string
}

const LINE_COLORS = ['#059669', '#2563eb', '#d97706', '#dc2626', '#7c3aed']

/**
 * 上位提案の10年収益シミュレーションを折れ線グラフで表示する。
 * 純SVGで描画し、外部チャートライブラリには依存しない。
 */
export function RevenueSimulation({ projections, assumption }: Props) {
  if (projections.length === 0) return null

  const width = 640
  const height = 280
  const padding = { top: 16, right: 16, bottom: 28, left: 64 }
  const plotW = width - padding.left - padding.right
  const plotH = height - padding.top - padding.bottom

  const allValues = projections.flatMap((p) => [0, -p.initialCost, ...p.cumulative])
  const minV = Math.min(...allValues)
  const maxV = Math.max(...allValues)
  const range = maxV - minV || 1

  const xFor = (year: number) => padding.left + (year / 10) * plotW
  const yFor = (value: number) => padding.top + plotH - ((value - minV) / range) * plotH

  const zeroY = yFor(0)

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">収益シミュレーション</h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">上位活用案の10年間の累積損益推移(初期費用を差し引いた金額)</p>
        {assumption && <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">前提: {assumption}</p>}
      </div>

      <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4 overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ minWidth: 500 }}>
          {/* ゼロライン */}
          <line x1={padding.left} y1={zeroY} x2={width - padding.right} y2={zeroY} stroke="currentColor" className="text-neutral-300 dark:text-neutral-700" strokeDasharray="4 4" />
          <text x={padding.left - 8} y={zeroY} textAnchor="end" dominantBaseline="middle" className="fill-neutral-400 text-[10px]">
            ±0
          </text>

          {/* Y軸ラベル(最大・最小) */}
          <text x={padding.left - 8} y={padding.top} textAnchor="end" dominantBaseline="middle" className="fill-neutral-400 text-[10px]">
            {formatManYen(maxV)}
          </text>
          <text x={padding.left - 8} y={padding.top + plotH} textAnchor="end" dominantBaseline="middle" className="fill-neutral-400 text-[10px]">
            {formatManYen(minV)}
          </text>

          {/* X軸ラベル */}
          {[0, 2, 4, 6, 8, 10].map((year) => (
            <text key={year} x={xFor(year)} y={height - 8} textAnchor="middle" className="fill-neutral-400 text-[10px]">
              {year}年
            </text>
          ))}

          {projections.map((p, idx) => {
            const color = LINE_COLORS[idx % LINE_COLORS.length]
            const points = [{ year: 0, value: -p.initialCost }, ...p.cumulative.map((v, i) => ({ year: i + 1, value: v }))]
            const path = points.map((pt, i) => `${i === 0 ? 'M' : 'L'}${xFor(pt.year)},${yFor(pt.value)}`).join(' ')
            return <path key={p.proposalId} d={path} fill="none" stroke={color} strokeWidth={2.5} />
          })}
        </svg>

        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {projections.map((p, idx) => (
            <div key={p.proposalId} className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: LINE_COLORS[idx % LINE_COLORS.length] }} />
              {p.proposalName}
              <span className="text-neutral-400">
                ({p.paybackYears ? `${p.paybackYears}年で回収` : '10年内未回収'})
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {projections.map((p) => (
          <div key={p.proposalId} className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4">
            <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{p.proposalName}</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div>
                <p className="text-neutral-400">初期費用</p>
                <p className="font-medium text-neutral-700 dark:text-neutral-300">{formatManYen(p.initialCost)}</p>
              </div>
              <div>
                <p className="text-neutral-400">10年累計利益</p>
                <p className="font-medium text-neutral-700 dark:text-neutral-300">{formatManYen(p.tenYearProfit)}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
