import type { UtilizationProposal } from '../types/diagnosis'
import { formatManYen } from '../lib/format'
import { ProposalArt } from './ProposalArt'

interface Props {
  proposals: UtilizationProposal[]
  /** AI画像生成を行う対象地の簡潔な説明(住所・用途地域など) */
  landContext?: string
}

const RANK_BADGE = ['bg-amber-400 text-amber-950', 'bg-neutral-300 text-neutral-800', 'bg-orange-300 text-orange-950']
/** コスト抑制のため、AI画像生成は上位何件に限定するか */
const AI_IMAGE_LIMIT = 3

export function UtilizationRanking({ proposals, landContext = '' }: Props) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">活用提案ランキング</h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">AIがこの土地に適した活用方法をおすすめ順で提案します。</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        {proposals.map((p, idx) => (
          <div key={p.id} className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4">
            <div className="flex items-center gap-2 mb-3">
              <span
                className={
                  'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ' +
                  (RANK_BADGE[idx] ?? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500')
                }
              >
                {idx + 1}
              </span>
              <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">{p.name}</h3>
              <span className="ml-auto text-xs text-neutral-400">適合度 {p.score}</span>
            </div>

            <ProposalArt
              id={p.id}
              name={p.name}
              imageStyle={p.imageStyle}
              useAiImage={idx < AI_IMAGE_LIMIT}
              landContext={landContext}
            />

            <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-3 leading-relaxed">{p.description}</p>
            {p.aiReasoning && (
              <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-1.5 leading-relaxed">💡 {p.aiReasoning}</p>
            )}

            {p.caution && (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded-lg px-2.5 py-1.5">
                ⚠ {p.caution}
              </p>
            )}

            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-neutral-400">想定初期費用</p>
                <p className="font-medium text-neutral-800 dark:text-neutral-200">{formatManYen(p.estimatedInitialCost)}</p>
              </div>
              <div>
                <p className="text-xs text-neutral-400">想定月間収益</p>
                <p className="font-medium text-neutral-800 dark:text-neutral-200">{formatManYen(p.estimatedMonthlyProfit)}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
