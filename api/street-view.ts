/**
 * Google Street View Static APIのプロキシ。
 *
 * 航空写真だけでは分かりにくい「現地の雰囲気・接道状況」を確認する
 * 追加情報として使う(面積測定は引き続き航空写真ベースで行う)。
 * APIキーをクライアントに露出させないためサーバー側で中継する。
 * 指定地点付近にパノラマが存在しない場合はGoogle側が灰色の
 * プレースホルダー画像を返すため、そのケースは呼び出し側で
 * メタデータAPIを使って事前に判定する。
 */

export const config = { runtime: 'edge' }

export default async function handler(req: Request): Promise<Response> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY

  if (!apiKey) {
    return Response.json({ error: 'GOOGLE_MAPS_API_KEY が未設定です', code: 'API_KEY_MISSING' }, { status: 503 })
  }

  const url = new URL(req.url)
  const lat = url.searchParams.get('lat')
  const lng = url.searchParams.get('lng')
  const size = url.searchParams.get('size') ?? '640'
  const mode = url.searchParams.get('mode') // 'metadata' | null(=画像本体)

  if (!lat || !lng) {
    return Response.json({ error: 'lat, lng は必須です' }, { status: 400 })
  }

  const endpoint = mode === 'metadata' ? 'metadata' : 'streetview'
  const upstream = new URL(`https://maps.googleapis.com/maps/api/streetview/${endpoint}`)
  upstream.searchParams.set('location', `${lat},${lng}`)
  upstream.searchParams.set('radius', '100')
  if (mode !== 'metadata') {
    upstream.searchParams.set('size', `${size}x${size}`)
  }
  upstream.searchParams.set('key', apiKey)

  try {
    const res = await fetch(upstream)
    if (!res.ok) {
      const errText = await res.text()
      return Response.json({ error: `Street View APIエラー: ${res.status} ${errText}` }, { status: 502 })
    }

    if (mode === 'metadata') {
      const data = await res.json()
      return Response.json(data, { headers: { 'Cache-Control': 'public, max-age=604800' } })
    }

    return new Response(res.body, {
      status: 200,
      headers: {
        'Content-Type': res.headers.get('Content-Type') ?? 'image/jpeg',
        'Cache-Control': 'public, max-age=604800, immutable',
      },
    })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Street View APIへの接続に失敗しました' },
      { status: 502 },
    )
  }
}
