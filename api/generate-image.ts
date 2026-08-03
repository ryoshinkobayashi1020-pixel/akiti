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

  const prompt = `A completed-project visualization of "${body.proposalName}" built on a vacant lot in Japan (${body.landContext}). ${styleInstruction}. Show the finished facility clearly, no text or watermarks, no people's faces visible.`

  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt,
        size: '1024x1024',
        quality: 'medium',
        n: 1,
      }),
    })

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
