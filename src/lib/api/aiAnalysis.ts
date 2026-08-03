/**
 * Claude APIによる土地分析のクライアント。
 * サーバ側(/api/ai-analysis)がキー管理と実際のAPI呼び出しを担う。
 */

export interface AiAnalysisRequest {
  address: string
  areaSqm: number
  areaTsubo: number
  areaSource: string
  useDistrict: string
  kenpeiRitsu: number
  yousekiRitsu: number
  setsudouJoukyou: string
  nearestStation: string | null
  nearestStationDistance: number | null
  schools: number
  hospitals: number
  supermarkets: number
  elevation: number | null
  hazardNote: string
  tsuboTanka: number
  tsuboTankaSource: string
  landPriceTotal: number
  candidates: Array<{ id: string; name: string; description: string }>
}

export interface AiProposalResult {
  id: string
  score: number
  reasoning: string
  caution: string
  estimatedInitialCost: number
  estimatedMonthlyProfit: number
}

export interface AiAnalysisResult {
  aiComment: string
  proposals: AiProposalResult[]
  revenueAssumption: string
}

class AiAnalysisUnavailableError extends Error {
  constructor() {
    super('Claude APIのキーが未設定です')
    this.name = 'AiAnalysisUnavailableError'
  }
}

export function isAiAnalysisUnavailable(err: unknown): boolean {
  return err instanceof AiAnalysisUnavailableError
}

export async function fetchAiAnalysis(input: AiAnalysisRequest): Promise<AiAnalysisResult> {
  const res = await fetch('/api/ai-analysis', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })

  if (res.status === 503) throw new AiAnalysisUnavailableError()
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error(body.error ?? `Claude APIエラー: ${res.status}`)
  }

  return res.json()
}
