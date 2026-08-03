/**
 * スリッピーマップのタイル座標計算。
 *
 * 航空写真から面積を「推定」ではなく計算で求めるための基礎。
 * Webメルカトル図法では、あるズームzと緯度latにおける1ピクセルの実距離が
 * 数式で一意に決まるため、写真上のピクセル距離から実際のメートルを逆算できる。
 */

/** 赤道上でズーム0のとき、1タイル(256px)が覆う距離から導かれる定数 */
const EQUATOR_METERS_PER_PIXEL_Z0 = 156543.03392804097

/** 1坪 = 3.305785...㎡ (400/121) */
export const SQM_PER_TSUBO = 400 / 121

/**
 * 指定した緯度・ズームにおける1ピクセルあたりの実距離(メートル)。
 * メルカトル図法は高緯度ほど引き伸ばされるため cos(lat) で補正する。
 */
export function metersPerPixel(lat: number, zoom: number): number {
  return (EQUATOR_METERS_PER_PIXEL_Z0 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom
}

export function sqmToTsubo(sqm: number): number {
  return sqm / SQM_PER_TSUBO
}

/** ㎡単価 → 坪単価 */
export function sqmPriceToTsuboPrice(pricePerSqm: number): number {
  return pricePerSqm * SQM_PER_TSUBO
}

/** 外れ値の影響を抑えるため中央値を使う */
export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export interface TileCoord {
  x: number
  y: number
  z: number
}

/** 緯度経度 → タイル座標(小数を含む。整数部がタイル番号、小数部がタイル内の位置) */
export function latLngToTile(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom
  const latRad = (lat * Math.PI) / 180
  const x = ((lng + 180) / 360) * n
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  return { x, y }
}

/** タイル座標 → 緯度経度(タイル北西角) */
export function tileToLatLng(x: number, y: number, zoom: number): { lat: number; lng: number } {
  const n = 2 ** zoom
  const lng = (x / n) * 360 - 180
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)))
  return { lat: (latRad * 180) / Math.PI, lng }
}

export const TILE_SIZE = 256

/**
 * 中心座標を囲む cols×rows 枚のタイル群を返す。
 * 返り値の offsetX/offsetY は、タイル群の左上を原点としたときの中心のピクセル位置。
 */
export function buildTileGrid(
  lat: number,
  lng: number,
  zoom: number,
  cols: number,
  rows: number,
): {
  tiles: Array<TileCoord & { left: number; top: number }>
  width: number
  height: number
  centerX: number
  centerY: number
} {
  const { x: fx, y: fy } = latLngToTile(lat, lng, zoom)
  const originTileX = Math.floor(fx) - Math.floor(cols / 2)
  const originTileY = Math.floor(fy) - Math.floor(rows / 2)

  const tiles: Array<TileCoord & { left: number; top: number }> = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      tiles.push({
        x: originTileX + col,
        y: originTileY + row,
        z: zoom,
        left: col * TILE_SIZE,
        top: row * TILE_SIZE,
      })
    }
  }

  return {
    tiles,
    width: cols * TILE_SIZE,
    height: rows * TILE_SIZE,
    centerX: (fx - originTileX) * TILE_SIZE,
    centerY: (fy - originTileY) * TILE_SIZE,
  }
}

/** 航空写真タイル(Esri World Imagery)。APIキー不要で実際の衛星・航空写真が取得できる。 */
export function aerialTileUrl(t: TileCoord): string {
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${t.z}/${t.y}/${t.x}`
}

/** Google Maps Static APIの衛星写真(1枚画像)。サーバー側プロキシ経由でキーを隠す。 */
export const GOOGLE_STATIC_MAP_SIZE = 640

export function googleStaticMapUrl(lat: number, lng: number, zoom: number): string {
  return `/api/static-map?lat=${lat}&lng=${lng}&zoom=${zoom}&size=${GOOGLE_STATIC_MAP_SIZE}`
}

/** Google Street View Static API(現地の雰囲気・接道状況を確認する追加情報)。サーバー側プロキシ経由。 */
export const STREET_VIEW_SIZE = 640

export function streetViewMetadataUrl(lat: number, lng: number): string {
  return `/api/street-view?lat=${lat}&lng=${lng}&mode=metadata`
}

export function streetViewImageUrl(lat: number, lng: number): string {
  return `/api/street-view?lat=${lat}&lng=${lng}&size=${STREET_VIEW_SIZE}`
}

/** 地図タイル(国土地理院 標準地図)。APIキー不要。 */
export function mapTileUrl(t: TileCoord): string {
  return `https://cyberjapandata.gsi.go.jp/xyz/pale/${t.z}/${t.x}/${t.y}.png`
}

async function urlToDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    if (!blob.type.startsWith('image/')) return null
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error('画像の読み込みに失敗しました'))
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

/**
 * 完成イメージAI生成の参照画像として使う、対象地の実際の航空写真(data URL)を取得する。
 * Google Maps Static APIを優先し、失敗時はEsri World Imageryの中心タイルにフォールバックする。
 */
export async function fetchAerialReferenceImage(lat: number, lng: number, zoom: number): Promise<string | null> {
  const google = await urlToDataUrl(googleStaticMapUrl(lat, lng, zoom))
  if (google) return google

  const { x, y } = latLngToTile(lat, lng, zoom)
  return urlToDataUrl(aerialTileUrl({ x: Math.floor(x), y: Math.floor(y), z: zoom }))
}

/**
 * 多角形の面積(平方メートル)。
 *
 * ピクセル座標に対してシューレース公式で面積(px²)を求め、
 * metersPerPixel の2乗を掛けて実面積に変換する。
 */
export function polygonAreaSqm(points: Array<{ x: number; y: number }>, lat: number, zoom: number): number {
  if (points.length < 3) return 0

  let doubleArea = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    doubleArea += a.x * b.y - b.x * a.y
  }
  const areaPx = Math.abs(doubleArea) / 2
  const mpp = metersPerPixel(lat, zoom)
  return areaPx * mpp * mpp
}

/** 多角形の周長(メートル)。接道長の目安などに使う。 */
export function polygonPerimeterMeters(
  points: Array<{ x: number; y: number }>,
  lat: number,
  zoom: number,
): number {
  if (points.length < 2) return 0
  const mpp = metersPerPixel(lat, zoom)
  let total = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    total += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return total * mpp
}
