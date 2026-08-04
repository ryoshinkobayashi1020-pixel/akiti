/**
 * 周辺施設の実データ取得(OpenStreetMap Overpass API)。
 *
 * APIキー不要。指定地点の半径内に実在する学校・病院・スーパー・駅を数える。
 * 要件定義書の「周辺データ取得」のうち、施設系はここで実測値が得られる。
 */

import { metersPerPixel } from './tiles'

/** 施設検索の半径(メートル) */
const SEARCH_RADIUS = 1000

// Overpassの公開インスタンスはクラウド/データセンターのIPレンジを広くブロックする
// ことがある(サーバー経由(Vercel)で試したところ406/429で全滅した)。一方、一般利用者の
// 回線(モバイル・自宅)からは通ることが多いため、あえてブラウザから直接叩く。
// 個々のインスタンスが不安定なことも多いため複数ミラーに順にフォールバックする。
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
]

async function fetchOverpass(query: string): Promise<{ elements: OverpassElement[] }> {
  let lastError: unknown = null
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 20000)
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      })
      clearTimeout(timeout)
      if (!res.ok) {
        lastError = new Error(`Overpass API エラー: ${res.status}`)
        continue
      }
      return await res.json()
    } catch (err) {
      lastError = err
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Overpass APIへの接続に失敗しました')
}

export interface NearbyFacilities {
  /** 半径1km内の学校数 */
  schools: number
  /** 半径1km内の病院・診療所数 */
  hospitals: number
  /** 半径1km内のスーパー・コンビニ数 */
  supermarkets: number
  /** 最寄り駅名。見つからなければ null */
  nearestStationName: string | null
  /** 最寄り駅までの直線距離(メートル)。見つからなければ null */
  nearestStationDistance: number | null
  /** 隣接道路のうち最も広い幅員(メートル)。取得できなければ null */
  widestAdjacentRoadWidth: number | null
  /** 隣接道路の名称・種別 */
  adjacentRoadDescription: string | null
}

interface OverpassElement {
  type: string
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

/** 2点間の距離(メートル)。ハーバサイン公式。 */
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

function elementLatLng(el: OverpassElement): { lat: number; lng: number } | null {
  if (typeof el.lat === 'number' && typeof el.lon === 'number') return { lat: el.lat, lng: el.lon }
  if (el.center) return { lat: el.center.lat, lng: el.center.lon }
  return null
}

/**
 * OSMの highway 種別から一般的な幅員(m)を推定する。
 * width タグがあればそれを優先し、無い場合のみ種別ごとの代表値を使う。
 */
function estimateRoadWidth(tags: Record<string, string>): number | null {
  const explicit = Number.parseFloat(tags.width ?? tags['est_width'] ?? '')
  if (Number.isFinite(explicit)) return explicit

  const lanes = Number.parseInt(tags.lanes ?? '', 10)
  if (Number.isFinite(lanes) && lanes > 0) return lanes * 3

  switch (tags.highway) {
    case 'trunk':
    case 'primary':
      return 12
    case 'secondary':
      return 9
    case 'tertiary':
      return 7
    case 'residential':
    case 'unclassified':
      return 5
    case 'living_street':
    case 'service':
      return 4
    default:
      return null
  }
}

function describeRoad(tags: Record<string, string>): string {
  const name = tags.name
  const kind =
    tags.highway === 'trunk' || tags.highway === 'primary'
      ? '幹線道路'
      : tags.highway === 'secondary' || tags.highway === 'tertiary'
        ? '主要道路'
        : tags.highway === 'service'
          ? '私道・敷地内道路'
          : '生活道路'
  return name ? `${name}(${kind})` : kind
}

export async function fetchNearbyFacilities(lat: number, lng: number): Promise<NearbyFacilities> {
  const query = `
    [out:json][timeout:25];
    (
      node(around:${SEARCH_RADIUS},${lat},${lng})["amenity"~"^(school|kindergarten|college)$"];
      way(around:${SEARCH_RADIUS},${lat},${lng})["amenity"~"^(school|kindergarten|college)$"];
      node(around:${SEARCH_RADIUS},${lat},${lng})["amenity"~"^(hospital|clinic|doctors)$"];
      way(around:${SEARCH_RADIUS},${lat},${lng})["amenity"~"^(hospital|clinic|doctors)$"];
      node(around:${SEARCH_RADIUS},${lat},${lng})["shop"~"^(supermarket|convenience)$"];
      way(around:${SEARCH_RADIUS},${lat},${lng})["shop"~"^(supermarket|convenience)$"];
      node(around:2000,${lat},${lng})["railway"="station"];
      way(around:60,${lat},${lng})["highway"]["highway"!~"^(footway|path|cycleway|steps|pedestrian)$"];
    );
    out center tags;
  `

  const data = await fetchOverpass(query)
  const elements = data.elements ?? []

  let schools = 0
  let hospitals = 0
  let supermarkets = 0
  let nearestStationName: string | null = null
  let nearestStationDistance: number | null = null
  let widestAdjacentRoadWidth: number | null = null
  let adjacentRoadDescription: string | null = null

  for (const el of elements) {
    const tags = el.tags ?? {}

    if (tags.amenity === 'school' || tags.amenity === 'kindergarten' || tags.amenity === 'college') {
      schools++
    } else if (tags.amenity === 'hospital' || tags.amenity === 'clinic' || tags.amenity === 'doctors') {
      hospitals++
    } else if (tags.shop === 'supermarket' || tags.shop === 'convenience') {
      supermarkets++
    } else if (tags.railway === 'station') {
      const pos = elementLatLng(el)
      if (pos) {
        const dist = haversineMeters(lat, lng, pos.lat, pos.lng)
        if (nearestStationDistance === null || dist < nearestStationDistance) {
          nearestStationDistance = Math.round(dist)
          nearestStationName = tags.name ?? '駅'
        }
      }
    } else if (tags.highway) {
      const width = estimateRoadWidth(tags)
      if (width !== null && (widestAdjacentRoadWidth === null || width > widestAdjacentRoadWidth)) {
        widestAdjacentRoadWidth = width
        adjacentRoadDescription = describeRoad(tags)
      }
    }
  }

  return {
    schools,
    hospitals,
    supermarkets,
    nearestStationName,
    nearestStationDistance,
    widestAdjacentRoadWidth,
    adjacentRoadDescription,
  }
}

/** 日照条件の判定に使う、南側の遮蔽物(建物)の有無を調べる。 */
export async function fetchSouthSideObstruction(lat: number, lng: number): Promise<boolean | null> {
  try {
    const query = `
      [out:json][timeout:20];
      way(around:30,${lat - 0.0002},${lng})["building"];
      out count;
    `
    const data = await fetchOverpass(query)
    const count = Number.parseInt(data.elements?.[0]?.tags?.ways ?? '0', 10)
    return Number.isFinite(count) ? count > 0 : null
  } catch {
    return null
  }
}

/** タイル上のピクセル距離を実距離に変換するヘルパの再エクスポート */
export { metersPerPixel }
