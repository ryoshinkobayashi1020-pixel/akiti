/// <reference types="node" />
/**
 * e-Stat(政府統計の総合窓口) APIのプロキシ。
 *
 * 住宅・土地統計調査の家賃データを取得するために使う。
 * ブラウザから直接叩くとCORSで弾かれる場合があるため中継する。
 * キー未設定時は503を返し、呼び出し側で推定値にフォールバックする。
 */

const API_BASE = 'https://api.e-stat.go.jp/rest/3.0/app/json'

// Edge Functionは"regions"設定を無視しグローバルなエッジ経路を使うため、
// WAFブロック回避のためNode.jsランタイムに切り替え、日本リージョンから発信させる。
export const config = { runtime: 'nodejs', maxDuration: 30 }

// Node.jsランタイムのreqはWeb標準Requestと異なり、headersがHeadersインスタンスではなく
// プレーンオブジェクトの場合がある(Edgeランタイムとの差異)。両対応で取得する。
function getHostHeader(req: Request): string {
  const headers = req.headers as unknown
  if (headers && typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get('host') ?? 'localhost'
  }
  const plain = headers as Record<string, string | string[] | undefined> | undefined
  const value = plain?.['host'] ?? plain?.['Host']
  return (Array.isArray(value) ? value[0] : value) ?? 'localhost'
}

// Node.jsランタイムではdefault exportに(req, res)形式が期待され、Response(Web標準)を
// returnしても無視されてハングする(タイムアウトの原因だった)。名前付きHTTPメソッド
// exportにするとWeb標準のfetchスタイルハンドラとして扱われる。
export async function GET(req: Request): Promise<Response> {
  const appId = process.env.ESTAT_APP_ID

  if (!appId) {
    return Response.json({ error: 'ESTAT_APP_ID が未設定です', code: 'API_KEY_MISSING' }, { status: 503 })
  }

  // Node.jsランタイムではreq.urlが絶対URLでなくパス+クエリのみになるため、
  // hostヘッダーを基準URLとして渡して解決する(Edgeランタイムとの差異)。
  const url = new URL(req.url, `http://${getHostHeader(req)}`)
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
    const res = await fetch(upstream, {
      headers: {
        // WAF(不正アクセス防御)がUser-Agent無しのリクエストを弾くことがあるため付与する
        'User-Agent': 'Mozilla/5.0 (compatible; VacantLandAI/1.0; +https://vacant-land-ai-app.vercel.app)',
        Accept: 'application/json',
      },
    })
    const body = await res.text()

    // WAFのブロックページ等、JSON以外(HTML)が返るケースを弾く
    const trimmed = body.trimStart()
    if (!res.ok || !(trimmed.startsWith('{') || trimmed.startsWith('['))) {
      return Response.json(
        { error: `e-Stat APIエラー: 上流から予期しない応答(status ${res.status})` },
        { status: 502 },
      )
    }

    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' },
    })
  } catch {
    return Response.json({ error: 'e-Stat APIへの接続に失敗しました' }, { status: 502 })
  }
}
