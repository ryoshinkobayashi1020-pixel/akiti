import { buildTileGrid, aerialTileUrl, mapTileUrl, TILE_SIZE } from '../lib/api/tiles'
import type { TileCoord } from '../lib/api/tiles'

interface Props {
  lat: number
  lng: number
  zoom: number
  cols?: number
  rows?: number
  kind: 'aerial' | 'map'
  /** 中心にピンを表示するか */
  showPin?: boolean
  className?: string
  children?: React.ReactNode
}

/**
 * 実際の航空写真・地図タイルを敷き詰めて表示する。
 *
 * 航空写真は Esri World Imagery、地図は国土地理院タイルを使用。
 * どちらもAPIキー不要で実データが取得できる。
 */
export function TileCanvas({
  lat,
  lng,
  zoom,
  cols = 3,
  rows = 3,
  kind,
  showPin = true,
  className = '',
  children,
}: Props) {
  const grid = buildTileGrid(lat, lng, zoom, cols, rows)
  const urlFor = kind === 'aerial' ? aerialTileUrl : mapTileUrl

  // 中心が表示領域の中央に来るようタイル群をずらす
  const offsetX = grid.width / 2 - grid.centerX
  const offsetY = grid.height / 2 - grid.centerY

  return (
    <div className={`relative overflow-hidden bg-neutral-200 dark:bg-neutral-800 ${className}`}>
      <div
        className="absolute"
        style={{
          width: grid.width,
          height: grid.height,
          left: `calc(50% - ${grid.width / 2}px + ${offsetX}px)`,
          top: `calc(50% - ${grid.height / 2}px + ${offsetY}px)`,
        }}
      >
        {grid.tiles.map((t: TileCoord & { left: number; top: number }) => (
          <img
            key={`${t.z}-${t.x}-${t.y}`}
            src={urlFor(t)}
            alt=""
            width={TILE_SIZE}
            height={TILE_SIZE}
            loading="lazy"
            className="absolute select-none"
            style={{ left: t.left, top: t.top }}
            draggable={false}
          />
        ))}
      </div>

      {showPin && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full pointer-events-none">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="#dc2626" stroke="#fff" strokeWidth="1.5">
            <path d="M12 22s7-7.58 7-12.5A7 7 0 0 0 5 9.5C5 14.42 12 22 12 22Z" />
            <circle cx="12" cy="9.5" r="2.5" fill="#fff" stroke="none" />
          </svg>
        </div>
      )}

      {children}

      <span className="absolute bottom-1 right-1 text-[9px] bg-black/50 text-white px-1.5 py-0.5 rounded backdrop-blur-sm">
        {kind === 'aerial' ? 'Esri World Imagery' : '国土地理院'}
      </span>
    </div>
  )
}
