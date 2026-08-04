import { useEffect, useRef, useState } from 'react'
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

// 画面が小さくて位置を見極めにくいというフィードバックを受け、ズームを1段階上げて
// 同じ表示サイズでも土地がより大きく見えるようにする。
/** 面積計算はズームが深いほど精度が上がる。20は敷地の輪郭がはっきり判別できる水準。 */
const ZOOM = 20
/** 拡大画像だけだと周辺との位置関係が分からないため、広域確認用に表示するズーム */
const WIDE_ZOOM = 16
const COLS = 3
const ROWS = 3

/**
 * 航空写真の上で土地の範囲を指定し、面積を実測するコンポーネント。
 *
 * ズームと緯度から1ピクセルあたりの実距離が確定するため、
 * 得られる面積は目測ではなく計算値になる。
 *
 * 操作方法は極力単純化してある: 位置が決まった時点でAIが自動的に境界を検出し、
 * その結果(頂点の丸印)は直接ドラッグして動かすだけで補正できる。空いている場所を
 * タップすると新しい頂点を追加する。選択方法が複数あって迷うという声を受け、
 * 「なぞって囲む」「クリックで自動選択」といった別モードは廃止し、この1つの
 * 操作体系に統一した。画面が小さくて位置を見極めにくい場合は「拡大して調整」で
 * 全画面表示にできる。
 *
 * 航空写真はGoogle Maps Static API(衛星写真)を優先的に使う。Esri World Imageryは
 * 日本国内で解像度が粗い・データが存在しないエリアが多いため、Googleが利用できない
 * 場合(APIキー未設定・読み込み失敗)のみフォールバックとして使用する。
 */
export function AreaMeasure({ lat, lng, onChange, onRecenter }: Props) {
  const [points, setPoints] = useState<Point[]>([])
  const [adjustMode, setAdjustMode] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [provider, setProvider] = useState<'google' | 'esri'>('google')
  const [detecting, setDetecting] = useState(false)
  const [detectNote, setDetectNote] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // 手動タップは操作が難しいというフィードバックを受け、位置が決まった時点で
  // まずAIによる自動検出を試み、ユーザーは結果を確認・微調整するだけで済むようにする。
  useEffect(() => {
    autoDetect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng])

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

  /** マウス/タッチのクライアント座標をタイル座標系のピクセルに変換する */
  function toTilePoint(clientX: number, clientY: number): Point | null {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return null
    // 表示は拡大縮小されている可能性があるため、タイル座標系に戻す
    const scale = width / rect.width
    return { x: (clientX - rect.left) * scale, y: (clientY - rect.top) * scale }
  }

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (draggingIndex !== null) return // 頂点ドラッグ直後のクリックは無視する

    const p = toTilePoint(e.clientX, e.clientY)
    if (!p) return

    if (adjustMode) {
      // GPS・住所検索の誤差で中心がずれている場合、タップ位置を新しい中心として採用する
      const { lat: newLat, lng: newLng } = pixelToLatLng(p.x, p.y)
      setAdjustMode(false)
      setPoints([])
      onChange(null)
      onRecenter?.(newLat, newLng)
      return
    }

    // 空いている場所をタップしたら新しい頂点として追加する
    const next = [...points, p]
    setPoints(next)
    emit(next)
  }

  /** 頂点をドラッグして直接動かす(AIの推定結果や手打ちした点のずれを補正する主な手段) */
  function handlePointPointerDown(e: React.PointerEvent<SVGCircleElement>, index: number) {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDraggingIndex(index)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (draggingIndex === null) return
    const p = toTilePoint(e.clientX, e.clientY)
    if (!p) return
    setPoints((prev) => {
      const next = prev.map((pt, i) => (i === draggingIndex ? p : pt))
      emit(next)
      return next
    })
  }

  function handlePointerUp() {
    setDraggingIndex(null)
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
        setDetectNote('AIが十分な自信を持って境界を判定できませんでした。写真をタップして頂点を指定してください。')
        return
      }
      const next = result.points.map((p) => ({ x: p.xFraction * width, y: p.yFraction * height }))
      setPoints(next)
      emit(next)
      setDetectNote(`AIによる推定境界です(根拠: ${result.reasoning})。ずれている場合は丸い頂点を指でドラッグして直してください`)
    } catch (err) {
      if (isBoundaryDetectUnavailable(err)) {
        setDetectNote('区画境界の自動検出は現在利用できません。写真をタップして頂点を指定してください。')
      } else {
        setDetectNote(err instanceof Error ? err.message : '自動検出に失敗しました。写真をタップして頂点を指定してください。')
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

  const canvas = (
    <div
      ref={containerRef}
      onClick={handleClick}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className={`relative overflow-hidden rounded-xl border select-none touch-none ${
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
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={11}
            fill="#fff"
            stroke="#10b981"
            strokeWidth={3}
            className="pointer-events-auto cursor-grab active:cursor-grabbing"
            onPointerDown={(e) => handlePointPointerDown(e, i)}
          />
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
  )

  return (
    <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-5">
      <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500 text-white text-xs font-bold">3</span>
        土地の範囲を指定
        <span className="text-xs font-normal text-rose-500">必須</span>
      </h3>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        {detecting
          ? 'AIが航空写真から区画境界を自動検出しています…'
          : '面積はAIが自動検出します。ずれている場合は丸い頂点をドラッグして直すか、空いている場所をタップして頂点を追加してください。'}
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

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {provider === 'google' && (
          <button
            type="button"
            onClick={autoDetect}
            disabled={detecting}
            className="text-xs rounded-full px-3 py-1.5 font-medium border border-emerald-500 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition disabled:opacity-50"
          >
            {detecting ? '検出中…' : 'AIでやり直す'}
          </button>
        )}
        <button
          type="button"
          onClick={() => setFullscreen(true)}
          className="text-xs rounded-full px-3 py-1.5 font-medium border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:border-emerald-500 hover:text-emerald-600 transition"
        >
          拡大して調整
        </button>
        {onRecenter && (
          <button
            type="button"
            onClick={() => setAdjustMode((v) => !v)}
            className={`text-xs rounded-full px-3 py-1.5 font-medium border transition ${
              adjustMode
                ? 'bg-amber-500 border-amber-500 text-white'
                : 'border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:border-amber-500 hover:text-amber-600'
            }`}
          >
            {adjustMode ? '写真をタップして位置を合わせる…' : 'ピンの位置を調整する'}
          </button>
        )}
      </div>
      {detectNote && <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{detectNote}</p>}

      {!fullscreen && <div className="mt-4">{canvas}</div>}

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

      {fullscreen && (
        <div className="fixed inset-0 z-50 bg-black/90 flex flex-col p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-white text-sm">頂点をドラッグ、または空いている場所をタップして調整してください</p>
            <button
              type="button"
              onClick={() => setFullscreen(false)}
              className="text-xs rounded-full px-4 py-2 font-medium bg-white text-neutral-900 hover:bg-neutral-200 transition"
            >
              閉じる
            </button>
          </div>
          <div className="flex-1 min-h-0 flex items-center justify-center">
            <div className="max-h-full max-w-full" style={{ aspectRatio: `${width} / ${height}`, height: '100%' }}>
              {canvas}
            </div>
          </div>
          {points.length >= 3 && (
            <p className="mt-3 text-center text-sm font-semibold text-emerald-400">
              {Math.round(sqm).toLocaleString('ja-JP')}㎡ ({tsubo.toFixed(1)}坪)
            </p>
          )}
        </div>
      )}
    </div>
  )
}
