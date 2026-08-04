/// <reference types="node" />
/**
 * 航空写真上のピン位置から、空き地の区画境界をAIに推定させる。
 *
 * 日本には無料で使える公的な地籍・筆界データAPIが存在しない(登記所の
 * 有料サービスのみ)。手動でのタップによる範囲指定が「選びにくい」という
 * フィードバックを受け、Claudeの画像認識で自動的に境界候補を推定し、
 * ユーザーが確認・微調整できる形にする。
 *
 * 返す座標はあくまでAIによる推定であり、公式の筆界データではない。
 */

export const config = { runtime: 'nodejs', maxDuration: 30 }

interface DetectBoundaryRequest {
  /** 航空写真(data URL)。中心にピンがある想定 */
  imageDataUrl: string
  /** ユーザーがタップした地点(画像の割合座標)。指定時はピン中心ではなくこの地点を対象にする */
  clickXFraction?: number
  clickYFraction?: number
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    confident: {
      type: 'boolean',
      description: '画像から区画境界を十分な自信を持って推定できたか',
    },
    points: {
      type: 'array',
      description:
        '区画境界を表す多角形の頂点(4〜12点)。画像の左上を(0,0)、右下を(1,1)とした割合座標で、周に沿って順番に並べること。confidentがfalseの場合は空配列でよい。',
      items: {
        type: 'object',
        properties: {
          xFraction: { type: 'number' },
          yFraction: { type: 'number' },
        },
        required: ['xFraction', 'yFraction'],
        additionalProperties: false,
      },
    },
    reasoning: {
      type: 'string',
      description: 'どの手がかり(フェンス・縁石・隣接建物の壁・植栽の切れ目・舗装の違いなど)から境界を判断したか、30字程度で',
    },
  },
  required: ['confident', 'points', 'reasoning'],
  additionalProperties: false,
}

export async function POST(req: Request): Promise<Response> {
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    return Response.json({ error: 'ANTHROPIC_API_KEY が未設定です', code: 'API_KEY_MISSING' }, { status: 503 })
  }

  let body: DetectBoundaryRequest
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(body.imageDataUrl ?? '')
  if (!match) {
    return Response.json({ error: '画像データの形式が不正です' }, { status: 400 })
  }
  const [, mime, base64] = match

  const hasClickPoint =
    typeof body.clickXFraction === 'number' && typeof body.clickYFraction === 'number'

  const targetDescription = hasClickPoint
    ? `画像の左上を(0,0)、右下を(1,1)としたとき、座標(${body.clickXFraction!.toFixed(3)}, ${body.clickYFraction!.toFixed(3)})付近をユーザーがタップし、そこにある建物または土地区画を指定しました。`
    : '画像の中心には赤いピンが立っており、そこが診断対象の空き地(vacant lot)です。'

  const prompt = `この画像は日本のある地点の航空写真(衛星写真)です。${targetDescription}
フェンス・縁石・隣接する建物の壁・植栽の切れ目・舗装(アスファルト/土/芝)の変化など、写真から視覚的に読み取れる手がかりをもとに、その地点にある区画(建物の外形、または空き地の敷地境界)を推定してください。
推測に自信が持てない場合(手がかりが乏しい、複数区画の判別がつかない等)は、無理に境界を作らず confident: false としてください。`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-5',
        max_tokens: 1024,
        output_config: { format: { type: 'json_schema', schema: RESPONSE_SCHEMA } },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } },
              { type: 'text', text: prompt },
            ],
          },
        ],
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      return Response.json({ error: `Claude API エラー: ${res.status} ${errText}` }, { status: 502 })
    }

    const data = await res.json()
    const textBlock = data.content?.find((b: { type: string }) => b.type === 'text')
    if (!textBlock) {
      return Response.json({ error: 'Claude APIから有効な応答がありませんでした' }, { status: 502 })
    }

    const parsed = JSON.parse(textBlock.text)
    return Response.json(parsed, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Claude APIへの接続に失敗しました' },
      { status: 502 },
    )
  }
}
