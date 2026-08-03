import { useState } from 'react'
import { PhotoInput } from './components/PhotoInput'
import { LocationInput } from './components/LocationInput'
import { AreaMeasure } from './components/AreaMeasure'
import type { AreaMeasurement } from './components/AreaMeasure'
import { DiagnosisProgress } from './components/DiagnosisProgress'
import { ResultsDashboard } from './components/ResultsDashboard'
import { UtilizationRanking } from './components/UtilizationRanking'
import { RevenueSimulation } from './components/RevenueSimulation'
import { ReportExport } from './components/ReportExport'
import { runDiagnosis } from './lib/diagnosisEngine'
import { reverseGeocode } from './lib/api/geocode'
import { DIAGNOSIS_STEPS } from './types/diagnosis'
import type { DiagnosisResult, DiagnosisStepId, LocationData, PhotoData } from './types/diagnosis'

type Phase = 'input' | 'diagnosing' | 'results' | 'error'

function App() {
  const [phase, setPhase] = useState<Phase>('input')
  const [photo, setPhoto] = useState<PhotoData | null>(null)
  const [location, setLocation] = useState<LocationData | null>(null)
  const [measurement, setMeasurement] = useState<AreaMeasurement | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [result, setResult] = useState<DiagnosisResult | null>(null)
  const [errorMessage, setErrorMessage] = useState('')

  const canStart = !!photo && !!location

  async function startDiagnosis() {
    if (!canStart || !location) return
    setPhase('diagnosing')
    setStepIndex(0)

    try {
      const diagnosis = await runDiagnosis(
        { location, measurement },
        {
          onStep: (_step: DiagnosisStepId, index: number) => setStepIndex(index),
        },
      )
      setStepIndex(DIAGNOSIS_STEPS.length)
      setResult(diagnosis)
      setPhase('results')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
      setPhase('error')
    }
  }

  async function handleRecenter(lat: number, lng: number) {
    setMeasurement(null)
    const address = await reverseGeocode(lat, lng)
    setLocation((prev) => ({
      method: prev?.method ?? 'address',
      address,
      lat,
      lng,
      accuracyMeters: null,
    }))
  }

  function reset() {
    setPhase('input')
    setPhoto(null)
    setLocation(null)
    setMeasurement(null)
    setResult(null)
    setStepIndex(0)
  }

  return (
    <div className="min-h-screen bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-3xl mx-auto px-4 py-5 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">空き地AI総合診断システム</h1>
          </div>
          {(phase === 'results' || phase === 'error') && (
            <button
              type="button"
              onClick={reset}
              className="text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 border border-neutral-300 dark:border-neutral-700 rounded-full px-3 py-1.5 transition"
            >
              最初からやり直す
            </button>
          )}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        {phase === 'input' && (
          <div className="space-y-5">
            <PhotoInput photo={photo} onChange={setPhoto} />
            <LocationInput location={location} onChange={setLocation} />

            {location?.lat != null && location.lng != null && (
              <AreaMeasure
                lat={location.lat}
                lng={location.lng}
                onChange={setMeasurement}
                onRecenter={handleRecenter}
              />
            )}

            <button
              type="button"
              onClick={startDiagnosis}
              disabled={!canStart}
              className="w-full rounded-xl bg-emerald-600 text-white py-3.5 text-sm font-semibold hover:bg-emerald-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              AI診断を開始する
            </button>
          </div>
        )}

        {phase === 'diagnosing' && <DiagnosisProgress currentStepIndex={stepIndex} />}

        {phase === 'error' && (
          <div className="rounded-2xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 p-6 text-center">
            <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">診断中にエラーが発生しました</p>
            <p className="text-xs text-rose-600 dark:text-rose-400 mt-2">{errorMessage}</p>
            <button
              type="button"
              onClick={() => setPhase('input')}
              className="mt-4 text-xs border border-rose-300 dark:border-rose-800 rounded-full px-4 py-2 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/40 transition"
            >
              入力画面に戻る
            </button>
          </div>
        )}

        {phase === 'results' && result && (
          <div className="space-y-8">
            <ResultsDashboard result={result} photoUrl={photo?.previewUrl ?? null} />
            <UtilizationRanking
              proposals={result.proposals}
              landContext={`${result.location.address} / ${result.surrounding.youtoChiiki.value}`}
              lat={result.location.lat}
              lng={result.location.lng}
            />
            <RevenueSimulation projections={result.projections} assumption={result.revenueAssumption} />
            <ReportExport result={result} photoUrl={photo?.previewUrl ?? null} />
          </div>
        )}
      </main>
    </div>
  )
}

export default App
