/**
 * 完成イメージのAI画像生成クライアント。
 * サーバ側(/api/generate-image)がキー管理とOpenAI呼び出しを担う。
 */

class ImageGenUnavailableError extends Error {
  constructor() {
    super('画像生成APIのキーが未設定です')
    this.name = 'ImageGenUnavailableError'
  }
}

export function isImageGenUnavailable(err: unknown): boolean {
  return err instanceof ImageGenUnavailableError
}

// 生成済み画像を提案idごとに保持し、PDFレポート生成時に再生成なしで再利用する。
const generatedImageCache = new Map<string, string>()

export function getCachedProposalImage(proposalId: string): string | undefined {
  return generatedImageCache.get(proposalId)
}

export async function generateProposalImage(
  proposalId: string,
  proposalName: string,
  imageStyle: 'render3d' | 'illustration',
  landContext: string,
): Promise<string> {
  const res = await fetch('/api/generate-image', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ proposalName, imageStyle, landContext }),
  })

  if (res.status === 503) throw new ImageGenUnavailableError()
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error(body.error ?? `画像生成エラー: ${res.status}`)
  }

  const { dataUrl } = await res.json()
  generatedImageCache.set(proposalId, dataUrl)
  return dataUrl
}
