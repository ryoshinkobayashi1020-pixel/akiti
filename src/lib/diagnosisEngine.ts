/**
 * 診断の実行エンジン。
 *
 * 要件定義書の10ステップを実際の外部APIで順に実行する。
 * 取得できたデータには出所(source)を付け、取得できなかったものは
 * 推定値であることを明示する。推定値を実測値のように見せない。
 */

import { geocodeAddress, reverseGeocode, fetchElevation, fetchCityCode } from './api/geocode'
import { fetchNearbyFacilities } from './api/overpass'
import type { NearbyFacilities } from './api/overpass'
import { SQM_PER_TSUBO, sqmPriceToTsuboPrice, median } from './api/tiles'
import { fetchAiAnalysis, isAiAnalysisUnavailable } from './api/aiAnalysis'
import { checkHazard, summarizeHazard } from './api/hazard'
import { fetchRegionalAverageRent, isEstatUnavailable } from './api/estat'
import type { RegionalRentResult } from './api/estat'
import { fetchKsjLandPricePoints } from './api/ksjLandPrice'
import type { LandPricePoint } from './api/ksjLandPrice'
import type {
  DiagnosisResult,
  DiagnosisStepId,
  LandArea,
  LocationData,
  PriceEstimate,
  RevenueProjection,
  Sourced,
  SurroundingData,
  UtilizationProposal,
} from '../types/diagnosis'
import type { AreaMeasurement } from '../components/AreaMeasure'
import { UTILIZATION_CATALOG, scoreProposals } from './utilization'

export interface EngineInput {
  location: LocationData
  measurement: AreaMeasurement | null
}

export interface EngineCallbacks {
  onStep: (step: DiagnosisStepId, index: number) => void
}

function sourced<T>(value: T, source: Sourced<T>['source'], note?: string): Sourced<T> {
  return { value, source, note }
}

/**
 * 用途地域名から建ぺい率・容積率の代表値を引く。
 * 実データが取れなかった場合のフォールバック。
 */
function ratiosForUseDistrict(name: string | null): { kenpei: number; youseki: number } {
  if (!name) return { kenpei: 60, youseki: 200 }
  if (name.includes('第一種低層') || name.includes('第二種低層')) return { kenpei: 50, youseki: 100 }
  if (name.includes('中高層')) return { kenpei: 60, youseki: 200 }
  if (name.includes('商業')) return { kenpei: 80, youseki: 400 }
  if (name.includes('近隣商業')) return { kenpei: 80, youseki: 300 }
  if (name.includes('工業')) return { kenpei: 60, youseki: 200 }
  return { kenpei: 60, youseki: 200 }
}

/** 接道状況をOSMの道路幅員から組み立てる。 */
function roadDescription(f: NearbyFacilities): Sourced<string> {
  if (f.widestAdjacentRoadWidth !== null && f.adjacentRoadDescription) {
    return sourced(
      `${f.adjacentRoadDescription} 幅員約${f.widestAdjacentRoadWidth}m`,
      'osm',
      'OpenStreetMapの道路データに基づく推定幅員',
    )
  }
  return sourced('接道情報を取得できませんでした', 'estimated')
}

/** 日当たり。方位別の遮蔽物解析まではせず、周辺建物密度から目安を述べる。 */
function sunlightEstimate(f: NearbyFacilities): Sourced<string> {
  const density = f.schools + f.hospitals + f.supermarkets
  if (density > 20) return sourced('周辺施設が密集 — 日照は現地確認を推奨', 'estimated')
  return sourced('開けた立地 — 日照条件は良好な可能性', 'estimated')
}

async function step<T>(fn: () => Promise<T>, warnings: string[], label: string, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    warnings.push(`${label}: ${message}`)
    return fallback
  }
}

export async function runDiagnosis(
  input: EngineInput,
  { onStep }: EngineCallbacks,
): Promise<DiagnosisResult> {
  const warnings: string[] = []
  const { location, measurement } = input

  // --- 1. 住所取得 -----------------------------------------------------------
  onStep('address', 0)
  let resolvedAddress = location.address
  let lat = location.lat
  let lng = location.lng

  if (location.method === 'gps' && lat !== null && lng !== null) {
    resolvedAddress = await step(
      () => reverseGeocode(lat as number, lng as number),
      warnings,
      '住所の逆引き',
      location.address,
    )
  }

  // --- 2. 緯度経度取得 -------------------------------------------------------
  onStep('geocode', 1)
  if (lat === null || lng === null) {
    const geo = await geocodeAddress(location.address)
    lat = geo.lat
    lng = geo.lng
    resolvedAddress = geo.formattedAddress
  }

  const resolvedLocation: LocationData = {
    ...location,
    address: resolvedAddress,
    lat,
    lng,
  }

  // --- 3. 航空写真取得 -------------------------------------------------------
  // タイルは表示側で直接読み込むため、ここでは面積の確定のみ行う。
  onStep('aerial', 2)
  const area: LandArea = measurement
    ? {
        sqm: measurement.sqm,
        tsubo: measurement.tsubo,
        source: 'measured',
        note: '航空写真上で指定した範囲から算出',
      }
    : {
        sqm: 165,
        tsubo: 165 / SQM_PER_TSUBO,
        source: 'estimated',
        note: '範囲未指定のため、一般的な戸建区画(約50坪)を仮定',
      }

  // --- 4. 周辺データ取得 -----------------------------------------------------
  onStep('surrounding', 3)
  const facilities = await step<NearbyFacilities>(
    () => fetchNearbyFacilities(lat as number, lng as number),
    warnings,
    '周辺施設データ(OpenStreetMap)',
    {
      schools: 0,
      hospitals: 0,
      supermarkets: 0,
      nearestStationName: null,
      nearestStationDistance: null,
      widestAdjacentRoadWidth: null,
      adjacentRoadDescription: null,
    },
  )

  const elevation = await step(
    () => fetchElevation(lat as number, lng as number),
    warnings,
    '標高データ(国土地理院)',
    null,
  )

  const hazardResult = await step(
    () => checkHazard(lat as number, lng as number),
    warnings,
    'ハザード判定(国土交通省ハザードマップポータル)',
    null,
  )

  const cityCode = await fetchCityCode(lat, lng)
  const prefectureCode = cityCode?.slice(0, 2) ?? null

  let regionalRent: RegionalRentResult | null = null
  if (prefectureCode) {
    try {
      regionalRent = await fetchRegionalAverageRent(prefectureCode)
    } catch (err) {
      if (isEstatUnavailable(err)) {
        warnings.push('地域家賃データ: e-Stat APIのキーが未設定のため、簡易推定値を表示しています')
      } else {
        warnings.push(`地域家賃データ: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  // --- 5. AI解析 / 6. 土地価格推定 -------------------------------------------
  onStep('ai_analysis', 4)

  let pricePoints: LandPricePoint[] = []
  const landPriceSourceNote = '国土数値情報 地価公示データ(国土交通省・キー不要)'

  // 国土数値情報(国土交通省)の地価公示データ。登録・APIキー一切不要。
  if (prefectureCode) {
    try {
      pricePoints = await fetchKsjLandPricePoints(lat, lng, prefectureCode)
    } catch (err) {
      warnings.push(`公示地価(国土数値情報): ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  onStep('land_price', 5)

  // 近傍3地点の中央値を採用する。1点だけだと外れ値の影響が大きい。
  const nearby = pricePoints.slice(0, 3)
  const officialSqmPrice = median(nearby.map((p) => p.pricePerSqm))

  let tsuboTanka: Sourced<number>
  let koujiChika: Sourced<number>

  if (officialSqmPrice !== null) {
    tsuboTanka = sourced(
      Math.round(sqmPriceToTsuboPrice(officialSqmPrice)),
      'official',
      `${landPriceSourceNote}の近傍${nearby.length}地点の中央値`,
    )
    koujiChika = sourced(Math.round(officialSqmPrice), 'official', landPriceSourceNote)
  } else {
    // 公的データが無い場合、周辺施設の充実度から粗い目安を置く。
    // これは推定値であり、実勢価格とは乖離しうる。
    const convenience = facilities.supermarkets * 3 + facilities.schools * 2 + facilities.hospitals * 2
    const stationBonus =
      facilities.nearestStationDistance !== null
        ? Math.max(0, 30 - facilities.nearestStationDistance / 100)
        : 0
    const estimatedTsubo = Math.round((25 + convenience + stationBonus) * 10000)
    tsuboTanka = sourced(estimatedTsubo, 'estimated', '周辺施設の充実度と駅距離からの粗い推定値')
    koujiChika = sourced(Math.round(estimatedTsubo / SQM_PER_TSUBO), 'estimated', '坪単価からの換算値')
  }

  const useDistrictRaw = nearby.find((p) => p.useDistrict)?.useDistrict ?? null
  const ratios = ratiosForUseDistrict(useDistrictRaw)
  const officialKenpei = nearby.find((p) => p.buildingCoverageRatio !== null)?.buildingCoverageRatio
  const officialYouseki = nearby.find((p) => p.floorAreaRatio !== null)?.floorAreaRatio

  const hazardInfo: Sourced<string> = hazardResult
    ? sourced(summarizeHazard(hazardResult), 'official', `国土交通省ハザードマップポータル(${hazardResult.portalUrl})`)
    : sourced(
        'ハザードデータを取得できませんでした。国土交通省ハザードマップポータルで直接ご確認ください',
        'estimated',
      )

  const surrounding: SurroundingData = {
    tsuboTanka,
    koujiChika,
    // 路線価には無料の構造化API・オープンデータが存在しない(国税庁サイトは
    // 手動navigation前提のスキャン画像地図のみ)。ZENRINが商用データベースを
    // 提供しているが有償・要契約のため個人開発では利用できない。
    // 国税庁は路線価を「公示地価の80%程度」を目標として設定すると公式に
    // 明言しており、これは当てずっぽうではなく公表されている評価方針。
    // ただし個々の路線ごとの実際の路線価とは異なるため、その旨を明記する。
    rosenka: sourced(
      Math.round(koujiChika.value * 0.8),
      'estimated',
      '国税庁の公表方針(公示地価の80%を目途に設定)に基づく算出値。個別路線の実際の路線価は国税庁 路線価図(rosenka.nta.go.jp)でご確認ください',
    ),
    shuuhenBaibaiKakaku: sourced(
      Math.round(tsuboTanka.value * 1.05),
      'estimated',
      '公示地価は実勢価格よりやや低い傾向があるため5%上乗せ',
    ),
    shuuhenChinryou: regionalRent
      ? sourced(
          regionalRent.averageMonthlyRent,
          'official',
          `e-Stat 住宅・土地統計調査(都道府県平均、集計${regionalRent.sampleCount.toLocaleString('ja-JP')}件)`,
        )
      : sourced(
          Math.round(((tsuboTanka.value * 0.05) / 12) * 6),
          'estimated',
          '年間利回り5%・専有6坪想定からの逆算(1戸あたり月額)',
        ),
    youtoChiiki: useDistrictRaw
      ? sourced(useDistrictRaw, 'official', `${landPriceSourceNote}の近傍地点`)
      : sourced('取得できませんでした', 'estimated'),
    kenpeiRitsu:
      officialKenpei != null
        ? sourced(officialKenpei, 'official')
        : sourced(ratios.kenpei, 'estimated', '用途地域からの代表値'),
    yousekiRitsu:
      officialYouseki != null
        ? sourced(officialYouseki, 'official')
        : sourced(ratios.youseki, 'estimated', '用途地域からの代表値'),
    setsudouJoukyou: roadDescription(facilities),
    hazardInfo,
    elevation: sourced(elevation, elevation !== null ? 'official' : 'estimated', '国土地理院 標高API'),
    gakkou: sourced(facilities.schools, 'osm', '半径1km内'),
    byouin: sourced(facilities.hospitals, 'osm', '半径1km内'),
    suupaa: sourced(facilities.supermarkets, 'osm', '半径1km内(コンビニ含む)'),
    eki: facilities.nearestStationName
      ? sourced(facilities.nearestStationName, 'osm')
      : sourced('半径2km内に駅が見つかりません', 'osm'),
    ekiKyori: sourced(facilities.nearestStationDistance, 'osm', '直線距離'),
    hiatari: sunlightEstimate(facilities),
    landShape: measurement
      ? sourced(describeShape(measurement), 'measured', '指定範囲の形状から判定')
      : sourced('範囲未指定のため判定していません', 'estimated'),
    buildingRestriction: sourced(
      `建ぺい率${officialKenpei ?? ratios.kenpei}% / 容積率${officialYouseki ?? ratios.youseki}%の範囲内`,
      officialKenpei != null ? 'official' : 'estimated',
    ),
  }

  // --- 7. 売却価格予測 -------------------------------------------------------
  onStep('sale_price', 6)

  const landPriceTotal = Math.round(tsuboTanka.value * area.tsubo)

  // 実際の取引価格データ(不動産情報ライブラリAPI)は登録審査に日数を要するため
  // 使用しない。実取引価格との比較は行わず、地価公示ベースの試算にとどめる。
  const marketComparisonPercent = 0

  const saleEase: PriceEstimate['saleEase'] =
    marketComparisonPercent < -3 ? 'high' : marketComparisonPercent > 8 ? 'low' : 'medium'
  const expectedSaleMonths = saleEase === 'high' ? 3 : saleEase === 'medium' ? 6 : 11

  const price: PriceEstimate = {
    landPricePerTsubo: tsuboTanka.value,
    landPriceTotal,
    salePriceLow: Math.round(landPriceTotal * 0.92),
    salePriceHigh: Math.round(landPriceTotal * 1.08),
    saleEase,
    expectedSaleMonths,
    marketComparisonPercent,
    basis: tsuboTanka.source,
    basisNote:
      tsuboTanka.source === 'official'
        ? (tsuboTanka.note ?? landPriceSourceNote)
        : '公的な地価データを取得できなかったため、周辺環境からの推定値です',
  }

  // --- 8. 活用提案 -----------------------------------------------------------
  onStep('utilization', 7)
  let proposals = scoreProposals({
    areaTsubo: area.tsubo,
    facilities,
    useDistrict: useDistrictRaw,
    tsuboTanka: tsuboTanka.value,
    monthlyRentPerTsubo: surrounding.shuuhenChinryou.value,
  })

  // Claude APIで実データに基づく評価・費用感に置き換える。
  // キー未設定・API障害時はヒューリスティックのまま(上記)にフォールバックする。
  let aiComment: string | null = null
  let revenueAssumption: string | undefined
  let aiPowered = false

  try {
    const analysis = await fetchAiAnalysis({
      address: resolvedLocation.address,
      areaSqm: area.sqm,
      areaTsubo: area.tsubo,
      areaSource: area.source,
      useDistrict: surrounding.youtoChiiki.value,
      kenpeiRitsu: surrounding.kenpeiRitsu.value,
      yousekiRitsu: surrounding.yousekiRitsu.value,
      setsudouJoukyou: surrounding.setsudouJoukyou.value,
      nearestStation: facilities.nearestStationName,
      nearestStationDistance: facilities.nearestStationDistance,
      schools: facilities.schools,
      hospitals: facilities.hospitals,
      supermarkets: facilities.supermarkets,
      elevation,
      hazardNote: surrounding.hazardInfo.value,
      tsuboTanka: tsuboTanka.value,
      tsuboTankaSource: tsuboTanka.source,
      landPriceTotal,
      candidates: UTILIZATION_CATALOG.map((c) => ({ id: c.id, name: c.name, description: c.description })),
    })

    const byId = new Map(analysis.proposals.map((p) => [p.id, p]))
    proposals = proposals
      .map((p) => {
        const ai = byId.get(p.id)
        if (!ai) return p
        return {
          ...p,
          score: Math.max(15, Math.min(99, Math.round(ai.score * 10) / 10)),
          estimatedInitialCost: Math.max(200000, Math.round(ai.estimatedInitialCost)),
          estimatedMonthlyProfit: Math.max(10000, Math.round(ai.estimatedMonthlyProfit)),
          caution: ai.caution?.trim() ? ai.caution.trim() : undefined,
          aiReasoning: ai.reasoning,
        }
      })
      .sort((a, b) => b.score - a.score)

    aiComment = analysis.aiComment
    revenueAssumption = analysis.revenueAssumption
    aiPowered = true
  } catch (err) {
    if (isAiAnalysisUnavailable(err)) {
      warnings.push('AI解析: Claude APIのキーが未設定のため、簡易ロジックによる評価を表示しています')
    } else {
      warnings.push(`AI解析: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // --- 9. 完成イメージ生成 ---------------------------------------------------
  onStep('render', 8)
  const projections = buildProjections(proposals)

  // --- 10. レポート作成 ------------------------------------------------------
  onStep('pdf', 9)

  return {
    location: resolvedLocation,
    area,
    surrounding,
    price,
    proposals,
    projections,
    aiComment: aiComment ?? buildComment(surrounding, price, proposals, area, facilities),
    generatedAt: new Date().toISOString(),
    warnings,
    aiPowered,
    revenueAssumption,
  }
}

/** 指定された多角形の縦横比から土地形状を述べる。 */
function describeShape(m: AreaMeasurement): string {
  const xs = m.points.map((p) => p.x)
  const ys = m.points.map((p) => p.y)
  const w = Math.max(...xs) - Math.min(...xs)
  const h = Math.max(...ys) - Math.min(...ys)
  const ratio = Math.max(w, h) / Math.max(1, Math.min(w, h))
  // 外接矩形に対する充填率が低いほど不整形
  const fill = m.sqm / (w * h * (m.sqm / (m.sqm || 1)) || 1)

  if (m.points.length > 5) return `不整形地(${m.points.length}角形)`
  if (ratio > 2.5) return `細長い形状(長辺:短辺 ≈ ${ratio.toFixed(1)}:1)`
  if (fill < 0.7) return '不整形地'
  return `ほぼ整形地(長辺:短辺 ≈ ${ratio.toFixed(1)}:1)`
}

/** 各活用案の10年キャッシュフローを組み立てる。 */
function buildProjections(proposals: UtilizationProposal[]): RevenueProjection[] {
  return proposals.slice(0, 5).map((p) => {
    const annualProfit = p.estimatedMonthlyProfit * 12
    const cumulative: number[] = []
    let running = -p.estimatedInitialCost
    let paybackYears: number | null = null

    for (let year = 1; year <= 10; year++) {
      running += annualProfit
      cumulative.push(running)
      if (paybackYears === null && running >= 0) paybackYears = year
    }

    return {
      proposalId: p.id,
      proposalName: p.name,
      initialCost: p.estimatedInitialCost,
      cumulative,
      paybackYears,
      tenYearProfit: running,
    }
  })
}

function buildComment(
  s: SurroundingData,
  price: PriceEstimate,
  proposals: UtilizationProposal[],
  area: { tsubo: number; source: string },
  f: NearbyFacilities,
): string {
  const parts: string[] = []

  if (area.source === 'measured') {
    parts.push(`航空写真から算出した面積は約${area.tsubo.toFixed(1)}坪です。`)
  } else {
    parts.push('土地の範囲が未指定のため、一般的な区画面積で試算しています。')
  }

  if (price.basis === 'official') {
    parts.push(
      `坪単価は公的な地価データに基づき約${Math.round(price.landPricePerTsubo / 10000)}万円と算出しました。`,
    )
  } else {
    parts.push(
      '公的な地価データを取得できなかったため、価格は周辺環境からの粗い推定にとどまります。実際の査定額とは大きく異なる可能性があります。',
    )
  }

  if (f.nearestStationDistance !== null && f.nearestStationDistance < 800) {
    parts.push(`${f.nearestStationName}まで約${f.nearestStationDistance}mと駅近で、収益活用・売却ともに有利です。`)
  } else if (f.nearestStationDistance === null) {
    parts.push('半径2km内に駅がなく、駐車場需要など車前提の活用が現実的です。')
  }

  const top = proposals[0]
  if (top) {
    parts.push(`活用方法としては${top.name}の適合度が最も高く、${top.description}`)
  }

  if (s.hazardInfo.source === 'estimated') {
    parts.push('ハザード情報は標高からの目安です。正式な判定は自治体のハザードマップをご確認ください。')
  }

  return parts.join('')
}

export { UTILIZATION_CATALOG }
