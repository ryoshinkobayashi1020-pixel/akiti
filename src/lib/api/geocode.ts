/**
 * 住所 → 緯度経度、および逆ジオコーディング。
 *
 * 主系は国土地理院の住所検索API。日本の住所表記に最適化されており、APIキー不要。
 * 取得できなかった場合のみ OpenStreetMap Nominatim にフォールバックする。
 */

export interface GeocodeResult {
  lat: number
  lng: number
  formattedAddress: string
  source: 'gsi' | 'nominatim'
}

interface GsiFeature {
  geometry: { coordinates: [number, number] }
  properties: { title: string }
}

/** 国土地理院 住所検索API */
async function geocodeGsi(address: string): Promise<GeocodeResult | null> {
  const url = `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(address)}`
  const res = await fetch(url)
  if (!res.ok) return null

  const features: GsiFeature[] = await res.json()
  if (!Array.isArray(features) || features.length === 0) return null

  const [lng, lat] = features[0].geometry.coordinates
  return { lat, lng, formattedAddress: features[0].properties.title || address, source: 'gsi' }
}

/** OpenStreetMap Nominatim */
async function geocodeNominatim(address: string): Promise<GeocodeResult | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=jp&q=${encodeURIComponent(address)}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) return null

  const results = await res.json()
  if (!Array.isArray(results) || results.length === 0) return null

  return {
    lat: Number.parseFloat(results[0].lat),
    lng: Number.parseFloat(results[0].lon),
    formattedAddress: results[0].display_name || address,
    source: 'nominatim',
  }
}

export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  const gsi = await geocodeGsi(address).catch(() => null)
  if (gsi) return gsi

  const nominatim = await geocodeNominatim(address).catch(() => null)
  if (nominatim) return nominatim

  throw new Error('住所から位置情報を特定できませんでした。番地まで含めて入力してください。')
}

/** 緯度経度 → 住所文字列(GPS取得時に使用) */
export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&lat=${lat}&lon=${lng}`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error('reverse geocode failed')
    const data = await res.json()
    return data.display_name ?? `緯度${lat.toFixed(5)} / 経度${lng.toFixed(5)}`
  } catch {
    return `緯度${lat.toFixed(5)} / 経度${lng.toFixed(5)}`
  }
}

/** 国土地理院 標高API。日当たり・浸水リスクの参考値として標高を取得する。 */
export async function fetchElevation(lat: number, lng: number): Promise<number | null> {
  try {
    const url = `https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php?lon=${lng}&lat=${lat}&outtype=JSON`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    const elevation = Number.parseFloat(data.elevation)
    return Number.isFinite(elevation) ? elevation : null
  } catch {
    return null
  }
}

/** 緯度経度から市区町村コードを引く(国土地理院の逆ジオコーディング)。キー不要。 */
export async function fetchCityCode(lat: number, lng: number): Promise<string | null> {
  try {
    const url = `https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${lat}&lon=${lng}`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    const code = data?.results?.muniCd
    return typeof code === 'string' ? code : null
  } catch {
    return null
  }
}
