/**
 * 活用提案のスコアリング。
 *
 * 完全な乱数ではなく、周辺施設密度・駅距離・用途地域・坪単価といった
 * 実データのシグナルから適合度を算出する。数値自体は簡易的なヒューリスティックだが、
 * 「駅から遠いのにコインパーキング一択」のような明らかな矛盾は避けられる。
 */

import type { UtilizationProposal } from '../types/diagnosis'
import type { NearbyFacilities } from './api/overpass'

export interface CatalogEntry {
  id: string
  name: string
  description: string
  imageStyle: 'render3d' | 'illustration'
  /** 坪あたり初期費用(円) */
  initialCostPerTsubo: [number, number]
  /** 坪あたり月間収益(円) */
  monthlyProfitPerTsubo: [number, number]
}

export const UTILIZATION_CATALOG: CatalogEntry[] = [
  { id: 'parking', name: '駐車場', description: '初期投資が少なく短期間で開始可能。更地のまま活用でき撤退も容易。', imageStyle: 'render3d', initialCostPerTsubo: [1.5, 4], monthlyProfitPerTsubo: [0.15, 0.4] },
  { id: 'trunkroom', name: 'トランクルーム', description: 'コンテナ設置型で需要が安定。都市部・住宅密集地で特に高収益。', imageStyle: 'render3d', initialCostPerTsubo: [6, 14], monthlyProfitPerTsubo: [0.3, 0.7] },
  { id: 'container', name: 'コンテナ倉庫', description: '法人向け保管需要を取り込み、駐車場より高い坪単価が見込める。', imageStyle: 'render3d', initialCostPerTsubo: [7, 16], monthlyProfitPerTsubo: [0.35, 0.8] },
  { id: 'farm', name: '貸農園', description: '住宅街近郊での需要増加中。初期費用を抑えつつ地域貢献にもなる。', imageStyle: 'illustration', initialCostPerTsubo: [1, 3], monthlyProfitPerTsubo: [0.05, 0.2] },
  { id: 'apartment', name: 'アパート', description: '長期安定収益が期待できる一方、初期投資は大きい。周辺賃料相場次第で高収益化。', imageStyle: 'render3d', initialCostPerTsubo: [55, 110], monthlyProfitPerTsubo: [0.7, 1.8] },
  { id: 'dogrun', name: 'ドッグラン', description: 'ペット需要の高いエリアで差別化可能。会員制・時間貸しで収益化。', imageStyle: 'illustration', initialCostPerTsubo: [3, 8], monthlyProfitPerTsubo: [0.1, 0.35] },
  { id: 'event', name: 'イベント広場', description: 'マルシェ・フリマ等の貸し出しで柔軟な収益モデルを構築できる。', imageStyle: 'illustration', initialCostPerTsubo: [2, 7], monthlyProfitPerTsubo: [0.08, 0.3] },
  { id: 'materials', name: '資材置場', description: '建設・造園業者向けの需要が安定するエリアに適する。', imageStyle: 'render3d', initialCostPerTsubo: [0.6, 3], monthlyProfitPerTsubo: [0.1, 0.3] },
  { id: 'disaster', name: '防災倉庫', description: '自治体・地域自治会向けの需要。地域貢献性が高く長期契約になりやすい。', imageStyle: 'render3d', initialCostPerTsubo: [4, 10], monthlyProfitPerTsubo: [0.08, 0.25] },
  { id: 'park', name: '地域公園', description: '自治体への貸与・buyback等の活用。直接収益は低いが資産価値・地域評価が向上。', imageStyle: 'illustration', initialCostPerTsubo: [1, 5], monthlyProfitPerTsubo: [0.02, 0.1] },
]

interface ScoreInput {
  areaTsubo: number
  facilities: NearbyFacilities
  useDistrict: string | null
  tsuboTanka: number
  monthlyRentPerTsubo: number
}

/** 施設密度(0〜1)。半径1km内の学校・病院・スーパー数から算出。 */
function urbanDensity(f: NearbyFacilities): number {
  return Math.min(1, (f.schools + f.hospitals + f.supermarkets) / 20)
}

function stationScore(distance: number | null): number {
  if (distance === null) return 0.1
  return Math.max(0, 1 - distance / 2000)
}

function isResidentialZone(useDistrict: string | null): boolean {
  if (!useDistrict) return true
  return useDistrict.includes('住居') || useDistrict.includes('住宅')
}

function isCommercialZone(useDistrict: string | null): boolean {
  if (!useDistrict) return false
  return useDistrict.includes('商業') || useDistrict.includes('近隣商業')
}

/** カタログ1件について、実データシグナルから0-100のスコアと注意書きを算出する。 */
function scoreEntry(entry: CatalogEntry, input: ScoreInput): { score: number; caution?: string } {
  const density = urbanDensity(input.facilities)
  const station = stationScore(input.facilities.nearestStationDistance)
  const residential = isResidentialZone(input.useDistrict)
  const commercial = isCommercialZone(input.useDistrict)

  let score = 50
  let caution: string | undefined

  switch (entry.id) {
    case 'parking':
      score = 55 + station * 30 + density * 15
      if (station < 0.2) caution = '駅から遠く、駐車場需要が限定的な可能性があります'
      break
    case 'trunkroom':
      score = 45 + density * 35 + station * 20
      break
    case 'container':
      score = 40 + density * 25 + (1 - station) * 15
      break
    case 'farm':
      score = 45 + (1 - density) * 30 + (residential ? 15 : 0)
      break
    case 'apartment':
      score = 30 + station * 35 + density * 20 + Math.min(15, input.areaTsubo / 10)
      if (input.areaTsubo < 30) caution = '土地面積が小さく、アパート建築には手狭な可能性があります'
      if (station < 0.15) caution = '最寄り駅が遠く、賃貸需要が伸びにくい可能性があります'
      break
    case 'dogrun':
      score = 40 + (1 - density) * 20 + (residential ? 20 : 0)
      break
    case 'event':
      score = 35 + density * 25 + station * 20 + (commercial ? 15 : 0)
      break
    case 'materials':
      score = 45 + (1 - density) * 25 + (1 - station) * 15
      break
    case 'disaster':
      score = 45 + (residential ? 20 : 0) + density * 10
      break
    case 'park':
      score = 40 + (residential ? 15 : 0) + (1 - density) * 15
      break
  }

  return { score: Math.max(15, Math.min(99, Math.round(score * 10) / 10)), caution }
}

export function scoreProposals(input: ScoreInput) {
  const proposals: UtilizationProposal[] = UTILIZATION_CATALOG.map((entry) => {
    const { score, caution } = scoreEntry(entry, input)
    const initialCost = Math.round(
      ((entry.initialCostPerTsubo[0] + entry.initialCostPerTsubo[1]) / 2) * input.areaTsubo * 10000,
    )
    const monthlyProfit = Math.round(
      ((entry.monthlyProfitPerTsubo[0] + entry.monthlyProfitPerTsubo[1]) / 2) * input.areaTsubo * 10000,
    )

    return {
      id: entry.id,
      name: entry.name,
      score,
      estimatedInitialCost: Math.max(200000, initialCost),
      estimatedMonthlyProfit: Math.max(10000, monthlyProfit),
      description: entry.description,
      imageStyle: entry.imageStyle,
      caution,
    }
  })

  return proposals.sort((a, b) => b.score - a.score)
}
