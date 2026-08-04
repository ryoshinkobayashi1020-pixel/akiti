/**
 * Google Maps Static API(衛星写真)のプロキシ。
 *
 * APIキーをクライアントに露出させないためサーバー側で中継する。
 * 未設定時は503を返し、呼び出し側はEsri World Imageryにフォールバックする。
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
  const zoom = url.searchParams.get('zoom') ?? '19'
  const size = url.searchParams.get('size') ?? '640'

  if (!lat || !lng) {
    return Response.json({ error: 'lat, lng は必須です' }, { status: 400 })
  }

  const upstream = new URL('https://maps.googleapis.com/maps/api/staticmap')
  upstream.searchParams.set('center', `${lat},${lng}`)
  upstream.searchParams.set('zoom', zoom)
  upstream.searchParams.set('size', `${size}x${size}`)
  // scale=2で実ピクセル数を2倍にし、地理的な範囲(座標計算の基準)は変えずに
  // 表示の鮮明さだけを上げる(境界のタップ・なぞり操作の精度向上のため)。
  upstream.searchParams.set('scale', '2')
  upstream.searchParams.set('maptype', 'satellite')
  upstream.searchParams.set('key', apiKey)

  try {
    const res = await fetch(upstream)
    if (!res.ok) {
      const errText = await res.text()
      return Response.json({ error: `Google Maps APIエラー: ${res.status} ${errText}` }, { status: 502 })
    }
    return new Response(res.body, {
      status: 200,
      headers: {
        'Content-Type': res.headers.get('Content-Type') ?? 'image/png',
        'Cache-Control': 'public, max-age=604800, immutable',
      },
    })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Google Maps APIへの接続に失敗しました' },
      { status: 502 },
    )
  }
}
