/**
 * 航空写真から区画境界をAIに推定させるクライアント。
 * サーバ側(/api/detect-boundary)がキー管理とClaude画像認識APIの呼び出しを担う。
 */

export interface BoundaryDetectResult {
  confident: boolean
  points: Array<{ xFraction: number; yFraction: number }>
  reasoning: string
}

class BoundaryDetectUnavailableError extends Error {
  constructor() {
    super('区画境界推定APIのキーが未設定です')
    this.name = 'BoundaryDetectUnavailableError'
  }
}

export function isBoundaryDetectUnavailable(err: unknown): boolean {
  return err instanceof BoundaryDetectUnavailableError
}

export async function detectLandBoundary(imageDataUrl: string): Promise<BoundaryDetectResult> {
  const res = await fetch('/api/detect-boundary', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ imageDataUrl }),
  })

  if (res.status === 503) throw new BoundaryDetectUnavailableError()
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error(body.error ?? `境界推定エラー: ${res.status}`)
  }

  return res.json()
}
