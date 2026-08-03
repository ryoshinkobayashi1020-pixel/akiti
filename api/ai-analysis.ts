/// <reference types="node" />
/**
 * Claude APIによる土地診断分析。
 *
 * ヒューリスティックな適合度スコアだけでなく、実際に収集した現地データ
 * (周辺施設・駅距離・地価・面積など)をClaudeに渡して、根拠のある評価・
 * 活用提案の妥当性・収益シミュレーションの前提条件を生成させる。
 * APIキー未設定時は503を返し、呼び出し側はヒューリスティックにフォールバックする。
 */

// 10件の活用提案をまとめて推論させるため、Edge Functionの実行時間上限(約25秒)を
// 超えることがある。Node.jsランタイムに切り替えmaxDurationを延長する。
export const config = { runtime: 'nodejs', maxDuration: 60 }

interface AnalysisRequest {
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

interface ProposalOut {
  id: string
  score: number
  reasoning: string
  caution: string
  estimatedInitialCost: number
  estimatedMonthlyProfit: number
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    aiComment: {
      type: 'string',
      description: '土地の特性・立地・価格妥当性を踏まえた150〜250字程度の総括コメント(日本語)',
    },
    proposals: {
      type: 'array',
      description: '候補となる土地活用方法それぞれについての評価。candidatesと同じ順序・同じ数で返すこと。',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          score: { type: 'number', description: 'この土地における適合度。20〜99の整数。' },
          reasoning: { type: 'string', description: 'なぜそのスコアなのか、立地データに基づく40字程度の根拠' },
          caution: {
            type: 'string',
            description: 'この活用方法がこの土地で成立しにくい具体的な理由。問題なければ空文字。',
          },
          estimatedInitialCost: {
            type: 'number',
            description:
              'この土地の面積・地域相場を踏まえた初期費用の円建て概算値(整数)。一般的な施工単価の相場観に基づくこと。',
          },
          estimatedMonthlyProfit: {
            type: 'number',
            description:
              'この土地の面積・立地・周辺賃料相場を踏まえた月間収益の円建て概算値(整数)。楽観的すぎない現実的な値にすること。',
          },
        },
        required: ['id', 'score', 'reasoning', 'caution', 'estimatedInitialCost', 'estimatedMonthlyProfit'],
        additionalProperties: false,
      },
    },
    revenueAssumption: {
      type: 'string',
      description: '収益シミュレーションの前提条件について、この立地特性を踏まえた60字程度の補足説明(日本語)',
    },
  },
  required: ['aiComment', 'proposals', 'revenueAssumption'],
  additionalProperties: false,
}

// Node.jsランタイムではdefault exportに(req, res)形式が期待され、Response(Web標準)を
// returnしても無視されてハングする。名前付きHTTPメソッドexportでWeb標準ハンドラにする。
export async function POST(req: Request): Promise<Response> {
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    return Response.json({ error: 'ANTHROPIC_API_KEY が未設定です', code: 'API_KEY_MISSING' }, { status: 503 })
  }

  let body: AnalysisRequest
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const prompt = `あなたは日本の不動産・土地活用に精通したアナリストです。以下の実データに基づいて、この土地を評価してください。
推測ではなく、与えられたデータの数値・立地条件から論理的に導ける評価をしてください。データが乏しい項目については無理に良い評価をせず、正直に評価してください。

【対象地】
住所: ${body.address}
面積: ${body.areaSqm.toFixed(1)}㎡ (${body.areaTsubo.toFixed(1)}坪) [出所: ${body.areaSource}]
用途地域: ${body.useDistrict}
建ぺい率/容積率: ${body.kenpeiRitsu}% / ${body.yousekiRitsu}%
接道状況: ${body.setsudouJoukyou}
最寄り駅: ${body.nearestStation ?? '半径2km以内になし'}${body.nearestStationDistance != null ? `(約${body.nearestStationDistance}m)` : ''}
周辺施設(半径1km): 学校${body.schools}件 / 病院${body.hospitals}件 / スーパー・コンビニ${body.supermarkets}件
標高: ${body.elevation != null ? `${body.elevation}m` : '不明'} (${body.hazardNote})
坪単価: ${Math.round(body.tsuboTanka / 10000)}万円 [出所: ${body.tsuboTankaSource}]
推定土地総額: ${Math.round(body.landPriceTotal / 10000).toLocaleString('ja-JP')}万円

【評価対象の活用方法】
${body.candidates.map((c, i) => `${i + 1}. ${c.name}(id: ${c.id}): ${c.description}`).join('\n')}

上記すべての活用方法について、この土地の実データに基づいた適合度スコア・初期費用・月間収益の概算を出してください。
初期費用・月間収益は、この面積(${body.areaTsubo.toFixed(1)}坪)と地域の坪単価水準(${Math.round(body.tsuboTanka / 10000)}万円/坪)から見て非現実的にならないよう、一般的な施工・運用コスト感覚で算出してください。`

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
        max_tokens: 4096,
        output_config: { format: { type: 'json_schema', schema: RESPONSE_SCHEMA } },
        messages: [{ role: 'user', content: prompt }],
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

    const parsed: { aiComment: string; proposals: ProposalOut[]; revenueAssumption: string } = JSON.parse(
      textBlock.text,
    )
    return Response.json(parsed, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Claude APIへの接続に失敗しました' },
      { status: 502 },
    )
  }
}
