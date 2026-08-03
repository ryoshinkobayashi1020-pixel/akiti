import { DIAGNOSIS_STEPS } from '../types/diagnosis'

interface Props {
  currentStepIndex: number
}

export function DiagnosisProgress({ currentStepIndex }: Props) {
  return (
    <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-6 sm:p-8">
      <div className="flex flex-col items-center text-center mb-8">
        <div className="w-14 h-14 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin mb-4" />
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">AIが診断しています…</h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
          {DIAGNOSIS_STEPS[currentStepIndex]?.label ?? '完了'} を処理中
        </p>
      </div>

      <ol className="space-y-0">
        {DIAGNOSIS_STEPS.map((step, idx) => {
          const state = idx < currentStepIndex ? 'done' : idx === currentStepIndex ? 'active' : 'pending'
          return (
            <li key={step.id} className="flex items-center gap-3 py-2">
              <div
                className={
                  'w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-xs font-bold transition-colors ' +
                  (state === 'done'
                    ? 'bg-emerald-500 text-white'
                    : state === 'active'
                      ? 'bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 ring-2 ring-emerald-500'
                      : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-400')
                }
              >
                {state === 'done' ? '✓' : idx + 1}
              </div>
              <span
                className={
                  'text-sm transition-colors ' +
                  (state === 'pending'
                    ? 'text-neutral-400 dark:text-neutral-600'
                    : state === 'active'
                      ? 'text-neutral-900 dark:text-neutral-100 font-medium'
                      : 'text-neutral-500 dark:text-neutral-400')
                }
              >
                {step.label}
              </span>
              {state === 'active' && (
                <span className="flex gap-1 ml-1">
                  <span className="w-1 h-1 rounded-full bg-emerald-500 animate-bounce [animation-delay:-0.2s]" />
                  <span className="w-1 h-1 rounded-full bg-emerald-500 animate-bounce [animation-delay:-0.1s]" />
                  <span className="w-1 h-1 rounded-full bg-emerald-500 animate-bounce" />
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
