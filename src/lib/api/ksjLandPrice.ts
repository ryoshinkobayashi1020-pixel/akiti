/**
 * 国土数値情報(国土交通省)「地価公示データ」のクライアント。
 *
 * 利用登録・APIキーが一切不要な公的データ。サーバ側(/api/ksj-landprice)が
 * ZIPのダウンロード・展開・近傍検索を行う。
 *
 * フィールド番号は令和6年(2024年)版以降の製品仕様に基づく(実データで検証済み)。
 * 令和5年(2023年)以前は異なるフィールド番号体系のため対象外としている。
 * https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-L01-2026.html
 *   L01_007 年度 / L01_008 地価公示価格(円/m2) / L01_024 標準地名(市区町村)
 *   L01_025 所在及び地番 / L01_027 地積(m2) / L01_042 前面道路の幅員(m)
 *   L01_048 最寄り駅名 / L01_050 最寄り駅までの道路距離(m)
 *   L01_051 都市計画の用途地域 / L01_057 建蔽率(%) / L01_058 容積率(%)
 */

/** 地価公示ポイントが持つ属性 */
export interface LandPricePoint {
  /** 1㎡あたりの価格(円) */
  pricePerSqm: number
  /** 用途地域 */
  useDistrict: string | null
  /** 建ぺい率(%) */
  buildingCoverageRatio: number | null
  /** 容積率(%) */
  floorAreaRatio: number | null
  /** 前面道路の幅員(m) */
  frontRoadWidth: number | null
  /** 標準地の住所 */
  address: string | null
  /** 最寄り駅名 */
  nearestStation: string | null
  /** 最寄り駅までの道路距離(m) */
  nearestStationDistance: number | null
  /** 対象地点からの距離(メートル) */
  distance: number
}

const PROXY_ENDPOINT = '/api/ksj-landprice'

// 令和6年(2024年)版以降の製品仕様に基づく用途区分コード表
const USE_DISTRICT_MAP: Record<string, string> = {
  '1低専': '第一種低層住居専用地域',
  '2低専': '第二種低層住居専用地域',
  '1中専': '第一種中高層住居専用地域',
  '2中専': '第二種中高層住居専用地域',
  '1住居': '第一種住居地域',
  '2住居': '第二種住居地域',
  準住居: '準住居地域',
  近商: '近隣商業地域',
  商業: '商業地域',
  準工: '準工業地域',
  工業: '工業地域',
  工専: '工業専用地域',
  田園住: '田園住居地域',
}

interface KsjPoint {
  properties: Record<string, unknown>
  distance: number
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '_' || v === '') return null
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}

function toStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v)
  return s === '_' || s === '' ? null : s
}

export async function fetchKsjLandPricePoints(lat: number, lng: number, prefCode: string): Promise<LandPricePoint[]> {
  const query = new URLSearchParams({ lat: String(lat), lng: String(lng), pref: prefCode })
  const res = await fetch(`${PROXY_ENDPOINT}?${query}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error(body.error ?? `国土数値情報APIエラー: ${res.status}`)
  }

  const { points }: { year: string; points: KsjPoint[] } = await res.json()

  return points.map((p) => {
    const props = p.properties
    const pricePerSqm = toNumber(props.L01_008) ?? 0
    const useDistrictCode = toStringOrNull(props.L01_051)
    const city = toStringOrNull(props.L01_024)
    const lot = toStringOrNull(props.L01_025)

    return {
      pricePerSqm,
      useDistrict: useDistrictCode ? (USE_DISTRICT_MAP[useDistrictCode] ?? useDistrictCode) : null,
      buildingCoverageRatio: toNumber(props.L01_057),
      floorAreaRatio: toNumber(props.L01_058),
      frontRoadWidth: toNumber(props.L01_042),
      address: [city, lot].filter(Boolean).join('　') || null,
      nearestStation: toStringOrNull(props.L01_048),
      nearestStationDistance: toNumber(props.L01_050),
      distance: p.distance,
    }
  })
}
