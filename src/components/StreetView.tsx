import { useEffect, useState } from 'react'
import { streetViewMetadataUrl, streetViewImageUrl } from '../lib/api/tiles'

interface Props {
  lat: number
  lng: number
  className?: string
}

/**
 * 現地の雰囲気・接道状況を確認するための追加情報として表示するストリートビュー。
 *
 * 土地の面積測定はあくまで航空写真ベースで行うため、これは補助的な表示に留める。
 * APIキー未設定・近隣にパノラマが存在しない場合は静かに非表示にする
 * (エラー表示で診断結果画面のノイズを増やさないため)。
 */
export function StreetView({ lat, lng, className = '' }: Props) {
  const [available, setAvailable] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    setAvailable(null)
    fetch(streetViewMetadataUrl(lat, lng))
      .then((res) => (res.ok ? res.json() : { status: 'UNAVAILABLE' }))
      .then((data) => {
        if (!cancelled) setAvailable(data.status === 'OK')
      })
      .catch(() => {
        if (!cancelled) setAvailable(false)
      })
    return () => {
      cancelled = true
    }
  }, [lat, lng])

  if (!available) return null

  return (
    <div className={`relative overflow-hidden bg-neutral-200 dark:bg-neutral-800 ${className}`}>
      <img src={streetViewImageUrl(lat, lng)} alt="現地のストリートビュー" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
      <span className="absolute bottom-1 right-1 text-[9px] bg-black/50 text-white px-1.5 py-0.5 rounded backdrop-blur-sm">
        Google Street View
      </span>
    </div>
  )
}
