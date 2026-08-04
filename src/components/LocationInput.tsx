import { useState } from 'react'
import type { LocationData } from '../types/diagnosis'
import { geocodeAddress, reverseGeocode } from '../lib/api/geocode'
import { StreetView } from './StreetView'

interface Props {
  location: LocationData | null
  onChange: (location: LocationData | null) => void
}

export function LocationInput({ location, onChange }: Props) {
  const [address, setAddress] = useState('')
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [gpsError, setGpsError] = useState('')
  const [gpsLiveAccuracy, setGpsLiveAccuracy] = useState<number | null>(null)
  const [addressStatus, setAddressStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [addressError, setAddressError] = useState('')

  /** GPS精度がここ以下になったら、それ以上待たずに確定する(メートル) */
  const GOOD_ENOUGH_ACCURACY_M = 15
  /** iOS等では最初の1回だけだと精度が低いまま返ってくることがあるため、
   * この時間内は複数回の測位結果から最も精度の良いものを採用する */
  const GPS_REFINE_MS = 8000

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setGpsStatus('error')
      setGpsError('この端末では位置情報を取得できません。')
      return
    }
    setGpsStatus('loading')
    setGpsError('')
    setGpsLiveAccuracy(null)

    let best: GeolocationPosition | null = null
    let finished = false

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (!best || pos.coords.accuracy < best.coords.accuracy) {
          best = pos
          setGpsLiveAccuracy(Math.round(pos.coords.accuracy))
        }
        if (pos.coords.accuracy <= GOOD_ENOUGH_ACCURACY_M) finish()
      },
      (err) => {
        // 途中経過で精度の良い値が既に取れていれば、エラーになっても採用する
        if (best) {
          finish()
          return
        }
        finished = true
        navigator.geolocation.clearWatch(watchId)
        setGpsStatus('error')
        setGpsError(err.message || '位置情報の取得に失敗しました。')
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: GPS_REFINE_MS },
    )

    const timeoutId = setTimeout(() => {
      if (best) {
        finish()
      } else if (!finished) {
        finished = true
        navigator.geolocation.clearWatch(watchId)
        setGpsStatus('error')
        setGpsError('位置情報の取得がタイムアウトしました。電波状況の良い場所でもう一度お試しください。')
      }
    }, GPS_REFINE_MS)

    async function finish() {
      if (finished || !best) return
      finished = true
      navigator.geolocation.clearWatch(watchId)
      clearTimeout(timeoutId)
      const { latitude: lat, longitude: lng, accuracy } = best.coords
      // 取得した緯度経度が実際にどこを指しているか、その場で本人が確認できるよう
      // 住所を逆ジオコーディングして表示する(取得直後は座標のみで実感が持てないため)。
      const address = await reverseGeocode(lat, lng)
      setGpsStatus('idle')
      onChange({
        method: 'gps',
        address,
        lat,
        lng,
        accuracyMeters: Number.isFinite(accuracy) ? Math.round(accuracy) : null,
      })
    }
  }

  async function submitAddress() {
    const trimmed = address.trim()
    if (!trimmed) return
    setAddressStatus('loading')
    try {
      // 面積測定に緯度経度が必要なため、入力確定時点でジオコーディングしておく
      const geo = await geocodeAddress(trimmed)
      setAddressStatus('idle')
      onChange({
        method: 'address',
        address: geo.formattedAddress,
        lat: geo.lat,
        lng: geo.lng,
      })
    } catch (err) {
      setAddressStatus('error')
      setAddressError(err instanceof Error ? err.message : '住所から位置情報を特定できませんでした。')
    }
  }

  return (
    <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-5">
      <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500 text-white text-xs font-bold">2</span>
        位置情報
        <span className="text-xs font-normal text-rose-500">必須</span>
      </h3>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">現在地取得または住所入力、どちらか一方を選択してください。</p>

      {location ? (
        <div className="mt-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">{location.address}</p>
              {location.lat !== null && (
                <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">
                  緯度 {location.lat.toFixed(5)} / 経度 {location.lng?.toFixed(5)}
                  {location.accuracyMeters != null && `(精度 約${location.accuracyMeters}m)`}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => onChange(null)}
              className="text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 underline shrink-0 ml-3"
            >
              変更する
            </button>
          </div>
          {location.method === 'gps' && location.accuracyMeters != null && location.accuracyMeters > 50 && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
              GPS精度が低め(約{location.accuracyMeters}m)です。表示された住所が対象地と異なる場合は、下の航空写真で位置を微調整するか、住所入力に切り替えてください。
            </p>
          )}
          {location.lat != null && location.lng != null && (
            <div className="mt-3">
              <p className="text-xs text-emerald-700 dark:text-emerald-400 mb-1">現地の様子(横からの実写)</p>
              <StreetView lat={location.lat} lng={location.lng} className="rounded-lg h-40" />
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <button
            type="button"
            onClick={useCurrentLocation}
            disabled={gpsStatus === 'loading'}
            className="w-full flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-neutral-300 dark:border-neutral-700 py-4 text-neutral-600 dark:text-neutral-300 hover:border-emerald-500 hover:text-emerald-600 transition disabled:opacity-60"
          >
            <PinIcon />
            <span className="text-sm font-medium">
              {gpsStatus === 'loading'
                ? gpsLiveAccuracy != null
                  ? `精度を上げています…(現在 約${gpsLiveAccuracy}m)`
                  : '取得中…'
                : '現在地を取得する(GPS)'}
            </span>
          </button>
          {gpsStatus === 'error' && <p className="text-xs text-rose-500">{gpsError}</p>}

          <div className="flex items-center gap-2 text-xs text-neutral-400">
            <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
            または
            <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => {
                // IME(日本語入力)で漢字変換を確定するEnterまで拾ってしまい、
                // 入力途中の住所で検索が走ってしまうのを防ぐ
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) submitAddress()
              }}
              placeholder="住所を入力(例: 東京都渋谷区〇〇1-2-3)"
              className="flex-1 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-4 py-2.5 text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <button
              type="button"
              onClick={submitAddress}
              disabled={!address.trim() || addressStatus === 'loading'}
              className="rounded-xl bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 px-4 py-2.5 text-sm font-medium disabled:opacity-40 hover:opacity-90 transition"
            >
              {addressStatus === 'loading' ? '検索中…' : '決定'}
            </button>
          </div>
          {addressStatus === 'error' && <p className="text-xs text-rose-500">{addressError}</p>}
        </div>
      )}
    </div>
  )
}

function PinIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 22s7-7.58 7-12.5A7 7 0 0 0 5 9.5C5 14.42 12 22 12 22Z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  )
}
