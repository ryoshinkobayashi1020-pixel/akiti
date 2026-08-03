/**
 * e-Stat(政府統計の総合窓口) APIのプロキシ。
 *
 * 住宅・土地統計調査の家賃データを取得するために使う。
 * ブラウザから直接叩くとCORSで弾かれる場合があるため中継する。
 * キー未設定時は503を返し、呼び出し側で推定値にフォールバックする。
 */

const API_BASE = 'https://api.e-stat.go.jp/rest/3.0/app/json'

export const config = { runtime: 'edge' }

export default async function handler(req: Request): Promise<Response> {
  const appId = process.env.ESTAT_APP_ID

  if (!appId) {
    return Response.json({ error: 'ESTAT_APP_ID が未設定です', code: 'API_KEY_MISSING' }, { status: 503 })
  }

  const url = new URL(req.url)
  const action = url.searchParams.get('action')

  if (action !== 'getStatsList' && action !== 'getStatsData') {
    return Response.json({ error: '不正なactionです' }, { status: 400 })
  }

  const upstream = new URL(`${API_BASE}/${action}`)
  upstream.searchParams.set('appId', appId)
  for (const [key, value] of url.searchParams) {
    if (key !== 'action') upstream.searchParams.set(key, value)
  }

  try {
    const res = await fetch(upstream)
    if (!res.ok) {
      return Response.json({ error: `e-Stat APIエラー: ${res.status}` }, { status: 502 })
    }
    const body = await res.text()
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' },
    })
  } catch {
    return Response.json({ error: 'e-Stat APIへの接続に失敗しました' }, { status: 502 })
  }
}
