import { useRef, useState } from 'react'
import {
  buildTileGrid,
  aerialTileUrl,
  googleStaticMapUrl,
  GOOGLE_STATIC_MAP_SIZE,
  polygonAreaSqm,
  polygonPerimeterMeters,
  metersPerPixel,
  sqmToTsubo,
  latLngToTile,
  tileToLatLng,
  urlToDataUrl,
  TILE_SIZE,
} from '../lib/api/tiles'
import { detectLandBoundary, isBoundaryDetectUnavailable } from '../lib/api/boundaryDetect'
import { TileCanvas } from './TileCanvas'
import { StreetView } from './StreetView'

interface Point {
  x: number
  y: number
}

export interface AreaMeasurement {
  sqm: number
  tsubo: number
  perimeterM: number
  points: Point[]
}

interface Props {
  lat: number
  lng: number
  onChange: (measurement: AreaMeasurement | null) => void
  /** GPS・住所検索の誤差で中心がずれている場合に、タップで中心を合わせ直すためのコールバック */
  onRecenter?: (lat: number, lng: number) => void
}

/** 面積計算はズームが深いほど精度が上がる。19は住宅一区画がはっきり判別できる水準。 */
const ZOOM = 19
/** 拡大画像だけだと周辺との位置関係が分からないため、広域確認用に表示するズーム */
const WIDE_ZOOM = 16
const COLS = 3
const ROWS = 3

/**
 * 航空写真の上で土地の角を順にタップし、面積を実測するコンポーネント。
 *
 * ズームと緯度から1ピクセルあたりの実距離が確定するため、
 * 得られる面積は目測ではなく計算値になる。
 *
 * 航空写真はGoogle Maps Static API(衛星写真)を優先的に使う。Esri World Imageryは
 * 日本国内で解像度が粗い・データが存在しないエリアが多いため、Googleが利用できない
 * 場合(APIキー未設定・読み込み失敗)のみフォールバックとして使用する。
 */
export function AreaMeasure({ lat, lng, onChange, onRecenter }: Props) {
  const [points, setPoints] = useState<Point[]>([])
  const [adjustMode, setAdjustMode] = useState(false)
  const [provider, setProvider] = useState<'google' | 'esri'>('google')
  const [detecting, setDetecting] = useState(false)
  const [detectNote, setDetectNote] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const grid = buildTileGrid(lat, lng, ZOOM, COLS, ROWS)
  const width = provider === 'google' ? GOOGLE_STATIC_MAP_SIZE : grid.width
  const height = provider === 'google' ? GOOGLE_STATIC_MAP_SIZE : grid.height
  const mpp = metersPerPixel(lat, ZOOM)

  function emit(next: Point[]) {
    if (next.length < 3) {
      onChange(null)
      return
    }
    const sqm = polygonAreaSqm(next, lat, ZOOM)
    onChange({
      sqm,
      tsubo: sqmToTsubo(sqm),
      perimeterM: polygonPerimeterMeters(next, lat, ZOOM),
      points: next,
    })
  }

  /** タップ位置(タイル座標系のピクセル)を緯度経度に変換する */
  function pixelToLatLng(px: number, py: number): { lat: number; lng: number } {
    if (provider === 'google') {
      const center = latLngToTile(lat, lng, ZOOM)
      const fx = center.x + (px - width / 2) / TILE_SIZE
      const fy = center.y + (py - height / 2) / TILE_SIZE
      return tileToLatLng(fx, fy, ZOOM)
    }
    const origin = grid.tiles[0]
    const fx = origin.x + px / TILE_SIZE
    const fy = origin.y + py / TILE_SIZE
    return tileToLatLng(fx, fy, ZOOM)
  }

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    // 表示は縮小されている可能性があるため、タイル座標系に戻す
    const scale = width / rect.width
    const px = (e.clientX - rect.left) * scale
    const py = (e.clientY - rect.top) * scale

    if (adjustMode) {
      // GPS・住所検索の誤差で中心がずれている場合、タップ位置を新しい中心として採用する
      const { lat: newLat, lng: newLng } = pixelToLatLng(px, py)
      setAdjustMode(false)
      setPoints([])
      onChange(null)
      onRecenter?.(newLat, newLng)
      return
    }

    const next = [...points, { x: px, y: py }]
    setPoints(next)
    emit(next)
  }

  async function autoDetect() {
    setDetecting(true)
    setDetectNote(null)
    try {
      const imageDataUrl = await urlToDataUrl(googleStaticMapUrl(lat, lng, ZOOM))
      if (!imageDataUrl) {
        setDetectNote('航空写真の取得に失敗しました。手動でタップして指定してください。')
        return
      }
      const result = await detectLandBoundary(imageDataUrl)
      if (!result.confident || result.points.length < 3) {
        setDetectNote('AIが十分な自信を持って境界を判定できませんでした。手動でタップして指定してください。')
        return
      }
      const next = result.points.map((p) => ({ x: p.xFraction * width, y: p.yFraction * height }))
      setPoints(next)
      emit(next)
      setDetectNote(`AIによる推定境界です(根拠: ${result.reasoning})。ずれている場合は個別の点をやり直してください`)
    } catch (err) {
      if (isBoundaryDetectUnavailable(err)) {
        setDetectNote('区画境界の自動検出は現在利用できません。手動でタップして指定してください。')
      } else {
        setDetectNote(err instanceof Error ? err.message : '自動検出に失敗しました。手動でタップして指定してください。')
      }
    } finally {
      setDetecting(false)
    }
  }

  function undo() {
    const next = points.slice(0, -1)
    setPoints(next)
    emit(next)
  }

  function reset() {
    setPoints([])
    onChange(null)
  }

  const sqm = points.length >= 3 ? polygonAreaSqm(points, lat, ZOOM) : 0
  const tsubo = sqmToTsubo(sqm)

  return (
    <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-5">
      <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500 text-white text-xs font-bold">3</span>
        土地の範囲を指定
        <span className="text-xs font-normal text-rose-500">必須</span>
      </h3>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        航空写真の上で土地の角を順にタップして、実際の面積を測定してください。面積は坪単価・総額・活用提案すべての計算の基礎になるため、必ず指定が必要です。
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div>
          <p className="text-xs text-neutral-400 mb-1">広域(周辺との位置関係の確認用)</p>
          <TileCanvas
            lat={lat}
            lng={lng}
            zoom={WIDE_ZOOM}
            kind="aerial"
            className="rounded-lg border border-neutral-200 dark:border-neutral-800 h-32"
          />
        </div>
        <div>
          <p className="text-xs text-neutral-400 mb-1">現地の様子(横からの実写)</p>
          <StreetView lat={lat} lng={lng} className="rounded-lg border border-neutral-200 dark:border-neutral-800 h-32" />
        </div>
      </div>

      {provider === 'google' && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-neutral-50 dark:bg-neutral-900 px-3 py-2">
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            タップでの指定が難しい場合、AIに航空写真から区画境界を推定させることもできます(あくまでAI推定です)。
          </p>
          <button
            type="button"
            onClick={autoDetect}
            disabled={detecting}
            className="shrink-0 text-xs rounded-full px-3 py-1.5 font-medium border border-emerald-500 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition disabled:opacity-50"
          >
            {detecting ? '検出中…' : 'AIで自動検出'}
          </button>
        </div>
      )}
      {detectNote && <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{detectNote}</p>}

      {onRecenter && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-neutral-50 dark:bg-neutral-900 px-3 py-2">
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            ピンの位置が対象地とずれている場合は、正しい位置をタップして合わせ直せます。
          </p>
          <button
            type="button"
            onClick={() => setAdjustMode((v) => !v)}
            className={`shrink-0 text-xs rounded-full px-3 py-1.5 font-medium border transition ${
              adjustMode
                ? 'bg-amber-500 border-amber-500 text-white'
                : 'border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:border-amber-500 hover:text-amber-600'
            }`}
          >
            {adjustMode ? '写真をタップして位置を合わせる…' : '位置を調整する'}
          </button>
        </div>
      )}

      <div
        ref={containerRef}
        onClick={handleClick}
        className={`mt-4 relative overflow-hidden rounded-xl border select-none touch-none ${
          adjustMode
            ? 'border-amber-500 ring-2 ring-amber-400 cursor-pointer'
            : 'border-neutral-200 dark:border-neutral-800 cursor-crosshair'
        }`}
        style={{ aspectRatio: `${width} / ${height}`, touchAction: 'none' }}
      >
        <div className="absolute inset-0">
          {provider === 'google' ? (
            <img
              src={googleStaticMapUrl(lat, lng, ZOOM)}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
              onError={() => setProvider('esri')}
              draggable={false}
            />
          ) : (
            grid.tiles.map((t) => (
              <img
                key={`${t.z}-${t.x}-${t.y}`}
                src={aerialTileUrl(t)}
                alt=""
                className="absolute"
                style={{
                  left: `${(t.left / width) * 100}%`,
                  top: `${(t.top / height) * 100}%`,
                  width: `${(TILE_SIZE / width) * 100}%`,
                  height: `${(TILE_SIZE / height) * 100}%`,
                }}
                draggable={false}
              />
            ))
          )}
        </div>

        <svg viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 w-full h-full pointer-events-none">
          {points.length >= 2 && (
            <polygon
              points={points.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="rgba(16, 185, 129, 0.28)"
              stroke="#10b981"
              strokeWidth={3}
            />
          )}
          {points.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={7} fill="#fff" stroke="#10b981" strokeWidth={3} />
          ))}
        </svg>

        {/* 中心位置の目印 */}
        {points.length === 0 && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full pointer-events-none">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="#dc2626" stroke="#fff" strokeWidth="1.5">
              <path d="M12 22s7-7.58 7-12.5A7 7 0 0 0 5 9.5C5 14.42 12 22 12 22Z" />
              <circle cx="12" cy="9.5" r="2.5" fill="#fff" stroke="none" />
            </svg>
          </div>
        )}

        <span className="absolute bottom-1 right-1 text-[9px] bg-black/50 text-white px-1.5 py-0.5 rounded backdrop-blur-sm">
          {provider === 'google' ? 'Google Maps' : 'Esri World Imagery'} / 1px ≈ {mpp.toFixed(2)}m
        </span>
      </div>

      {points.length > 0 && (
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={undo}
            className="text-xs border border-neutral-300 dark:border-neutral-700 rounded-full px-3 py-1.5 text-neutral-600 dark:text-neutral-300 hover:border-neutral-500 transition"
          >
            1つ戻す
          </button>
          <button
            type="button"
            onClick={reset}
            className="text-xs border border-neutral-300 dark:border-neutral-700 rounded-full px-3 py-1.5 text-neutral-600 dark:text-neutral-300 hover:border-neutral-500 transition"
          >
            クリア
          </button>
          {points.length < 3 ? (
            <span className="text-xs text-neutral-400">あと{3 - points.length}点で面積を計算します</span>
          ) : (
            <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 ml-auto">
              {Math.round(sqm).toLocaleString('ja-JP')}㎡ ({tsubo.toFixed(1)}坪)
            </span>
          )}
        </div>
      )}
    </div>
  )
}
