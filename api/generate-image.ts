/// <reference types="node" />
/**
 * 完成イメージ(3Dパース風・イラスト風)のAI画像生成。
 *
 * 要件定義書は「AI画像生成により各活用方法の完成予想図を表示する」ことを
 * 求めている。Claude自体は画像を生成しないため、OpenAI Images API
 * (gpt-image-1) を利用する。コストが発生するため呼び出し元(diagnosisEngine)
 * では上位提案のみに限定して呼び出す。
 */

// 画像生成は数十秒かかることがあり、Edge Functionの実行時間上限を超えうる。
// Node.jsランタイムに切り替えmaxDurationを延長する。
export const config = { runtime: 'nodejs', maxDuration: 60 }

interface GenerateImageRequest {
  proposalName: string
  imageStyle: 'render3d' | 'illustration'
  landContext: string
  /** 対象地の実際の航空写真(data URL)。指定時はこれを参照画像として画像編集APIを使う */
  aerialImageDataUrl?: string
}

// Node.jsランタイムではdefault exportに(req, res)形式が期待され、Response(Web標準)を
// returnしても無視されてハングする。名前付きHTTPメソッドexportでWeb標準ハンドラにする。
export async function POST(req: Request): Promise<Response> {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    return Response.json({ error: 'OPENAI_API_KEY が未設定です', code: 'API_KEY_MISSING' }, { status: 503 })
  }

  let body: GenerateImageRequest
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const styleInstruction =
    body.imageStyle === 'render3d'
      ? 'photorealistic 3D architectural rendering, daytime, clean composition, professional real-estate visualization style'
      : 'friendly flat-illustration style, soft colors, simple shapes, architectural concept illustration style'

  const basePrompt = `A completed-project visualization of "${body.proposalName}" built on a vacant lot in Japan (${body.landContext}). ${styleInstruction}. Show the finished facility clearly, no text or watermarks, no people's faces visible.`

  try {
    let res: Response

    if (body.aerialImageDataUrl) {
      // 実際の航空写真を参照画像として渡し、その区画の形状・周辺環境を踏まえた
      // 完成イメージを生成する(画像編集API)。テキストのみからの生成より現地に即した結果になる。
      const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(body.aerialImageDataUrl)
      if (!match) {
        return Response.json({ error: '航空写真データの形式が不正です' }, { status: 400 })
      }
      const [, mime, base64] = match
      const bytes = Buffer.from(base64, 'base64')
      const ext = mime.split('/')[1] ?? 'png'

      const prompt = `${basePrompt} The attached aerial photo shows the exact plot's shape, boundaries, and surrounding buildings/roads — use it as reference so the completed facility accurately fits this specific plot and context, viewed from a natural elevated 3/4 perspective (not a flat top-down view).`

      const form = new FormData()
      form.set('model', 'gpt-image-1')
      form.set('image', new Blob([bytes], { type: mime }), `aerial.${ext}`)
      form.set('prompt', prompt)
      form.set('size', '1024x1024')
      form.set('quality', 'medium')
      form.set('n', '1')

      res = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}` },
        body: form,
      })
    } else {
      res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-image-1',
          prompt: basePrompt,
          size: '1024x1024',
          quality: 'medium',
          n: 1,
        }),
      })
    }

    if (!res.ok) {
      const errText = await res.text()
      return Response.json({ error: `画像生成APIエラー: ${res.status} ${errText}` }, { status: 502 })
    }

    const data = await res.json()
    const b64 = data.data?.[0]?.b64_json
    if (!b64) {
      return Response.json({ error: '画像生成APIから有効な応答がありませんでした' }, { status: 502 })
    }

    return Response.json({ dataUrl: `data:image/png;base64,${b64}` }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : '画像生成APIへの接続に失敗しました' },
      { status: 502 },
    )
  }
}
