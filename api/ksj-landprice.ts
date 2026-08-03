/**
 * 国土数値情報(国土交通省)「地価公示データ(L01)」のプロキシ。
 *
 * 不動産情報ライブラリAPI(reinfolib)と異なり、利用登録・APIキーが一切不要。
 * 国土数値情報ダウンロードサイトが配布する年度・都道府県別のZIPファイル
 * (シェープ/GML/GeoJSONを含む)を取得し、内部のGeoJSONを展開して
 * 対象地点周辺の標準地(公示地価ポイント)を返す。
 *
 * フィールド番号は令和6年(2024年)版以降の製品仕様に基づく(実データで検証済み)。
 * 令和5年(2023年)以前は異なるフィールド番号体系のため、このプロキシでは扱わない。
 * https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-L01-2026.html
 */

import { unzipSync, strFromU8 } from 'fflate'

export const config = { runtime: 'edge' }

const BASE_URL = 'https://nlftp.mlit.go.jp/ksj/gml/data/L01'

// 新しい年度から順に試す(未公開の年度・都道府県は404になるためフォールバックする)。
// 令和5年(23)以前はフィールド番号体系が異なるため対象外。
const CANDIDATE_YEARS = ['26', '25', '24']

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

interface Ksj成果Feature {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: Record<string, unknown>
}

async function fetchZipAndExtractGeojson(prefCode: string): Promise<{ text: string; year: string } | null> {
  for (const year of CANDIDATE_YEARS) {
    const url = `${BASE_URL}/L01-${year}/L01-${year}_${prefCode}_GML.zip`
    const res = await fetch(url)
    if (!res.ok) continue

    const buf = new Uint8Array(await res.arrayBuffer())
    const unzipped = unzipSync(buf, {
      filter: (file) => file.name.endsWith('.geojson'),
    })
    const entry = Object.values(unzipped)[0]
    if (!entry) continue

    return { text: strFromU8(entry), year }
  }
  return null
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const lat = Number.parseFloat(url.searchParams.get('lat') ?? '')
  const lng = Number.parseFloat(url.searchParams.get('lng') ?? '')
  const prefCode = url.searchParams.get('pref')

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !prefCode) {
    return Response.json({ error: 'lat, lng, pref は必須です' }, { status: 400 })
  }

  try {
    const result = await fetchZipAndExtractGeojson(prefCode)
    if (!result) {
      return Response.json({ error: `都道府県コード${prefCode}の地価公示データが見つかりませんでした` }, { status: 404 })
    }

    const geojson = JSON.parse(result.text) as { features: Ksj成果Feature[] }

    const withDistance = geojson.features
      .map((f) => {
        const [lng2, lat2] = f.geometry.coordinates
        return { properties: f.properties, distance: haversineMeters(lat, lng, lat2, lng2) }
      })
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 8)

    return Response.json(
      { year: result.year, points: withDistance },
      { headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=604800' } },
    )
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : '国土数値情報データの処理に失敗しました' },
      { status: 502 },
    )
  }
}
