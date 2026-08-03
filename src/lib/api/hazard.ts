/**
 * 国土交通省 ハザードマップポータルサイトの公開タイル画像から、
 * 対象地点が実際に指定区域内かどうかをピクセル単位で判定する。
 *
 * タイル全体に色が付いていても、対象地点そのものが区域内とは限らない
 * (山間部を含む広いタイルの一部だけが着色されているケースがある)ため、
 * 緯度経度から算出した「タイル内の正確なピクセル座標」を1点だけ読み取る。
 * これは航空写真上での面積測定と同じ考え方(タイル座標系からの厳密な逆算)。
 *
 * 深さ区分などの色分け凡例は公式に検証できていないため断定せず、
 * 「区域内/区域外」という検証可能な事実のみを報告する。
 */

const HAZARD_ZOOM = 15
const DISAPORTAL_BASE = 'https://disaportaldata.gsi.go.jp/raster'

export interface HazardLayerResult {
  key: string
  label: string
  inZone: boolean
  /** タイル自体が存在しない(=その広域に区域が全くない)場合はtrue */
  tileAbsent: boolean
}

export interface HazardCheckResult {
  flood: HazardLayerResult
  debrisFlow: HazardLayerResult
  steepSlope: HazardLayerResult
  landslide: HazardLayerResult
  /** 確認用の公式ポータルURL(ユーザー自身での再確認を推奨) */
  portalUrl: string
}

const LAYERS: Array<{ key: keyof Omit<HazardCheckResult, 'portalUrl'>; path: string; label: string }> = [
  { key: 'flood', path: '01_flood_l2_shinsuishin_data', label: '洪水浸水想定区域(想定最大規模)' },
  { key: 'debrisFlow', path: '05_dosekiryukeikaikuiki', label: '土砂災害警戒区域(土石流)' },
  { key: 'steepSlope', path: '05_kyukeishakeikaikuiki', label: '土砂災害警戒区域(急傾斜地の崩壊)' },
  { key: 'landslide', path: '05_jisuberikeikaikuiki', label: '土砂災害警戒区域(地すべり)' },
]

function latLngToTileFrac(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom
  const latRad = (lat * Math.PI) / 180
  const x = ((lng + 180) / 360) * n
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  return { x, y }
}

async function sampleLayer(
  lat: number,
  lng: number,
  path: string,
): Promise<{ inZone: boolean; tileAbsent: boolean }> {
  const { x, y } = latLngToTileFrac(lat, lng, HAZARD_ZOOM)
  const tileX = Math.floor(x)
  const tileY = Math.floor(y)
  const px = Math.floor((x - tileX) * 256)
  const py = Math.floor((y - tileY) * 256)

  const url = `${DISAPORTAL_BASE}/${path}/${HAZARD_ZOOM}/${tileX}/${tileY}.png`
  const res = await fetch(url)

  if (res.status === 404) {
    // そのタイル自体が存在しない = この広域には当該区域が指定されていない
    return { inZone: false, tileAbsent: true }
  }
  if (!res.ok) {
    throw new Error(`ハザードタイル取得エラー: ${res.status}`)
  }

  const blob = await res.blob()
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  ctx.drawImage(bitmap, 0, 0)
  const [, , , alpha] = ctx.getImageData(px, py, 1, 1).data

  return { inZone: alpha > 0, tileAbsent: false }
}

export async function checkHazard(lat: number, lng: number): Promise<HazardCheckResult> {
  const entries = await Promise.all(
    LAYERS.map(async (layer) => {
      const result = await sampleLayer(lat, lng, layer.path)
      return [layer.key, { key: layer.key, label: layer.label, ...result }] as const
    }),
  )

  const byKey = Object.fromEntries(entries) as Record<
    (typeof LAYERS)[number]['key'],
    HazardLayerResult
  >

  return {
    ...byKey,
    portalUrl: `https://disaportal.gsi.go.jp/maps/index.html?ll=${lat},${lng}&zoom=16`,
  }
}

/** ハザード判定結果を1行の日本語サマリーにする。 */
export function summarizeHazard(result: HazardCheckResult): string {
  const inZoneLabels: string[] = []
  if (result.flood.inZone) inZoneLabels.push('洪水浸水想定区域')
  if (result.debrisFlow.inZone) inZoneLabels.push('土砂災害警戒区域(土石流)')
  if (result.steepSlope.inZone) inZoneLabels.push('土砂災害警戒区域(急傾斜地)')
  if (result.landslide.inZone) inZoneLabels.push('土砂災害警戒区域(地すべり)')

  if (inZoneLabels.length === 0) {
    return '洪水浸水想定区域・土砂災害警戒区域のいずれにも該当しません(国土交通省ハザードマップポータルのタイルデータで確認)'
  }
  return `${inZoneLabels.join('・')}に該当します。詳細な浸水深や区域区分は必ず公式ポータルでご確認ください。`
}
