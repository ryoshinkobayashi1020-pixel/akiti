export type LocationInputMethod = 'gps' | 'address'

export interface LocationData {
  method: LocationInputMethod
  address: string
  lat: number | null
  lng: number | null
}

export interface PhotoData {
  file: File
  previewUrl: string
}

/**
 * データの出所。表示時に「実測値」と「推定値」を区別するために使う。
 * 推定値を実測値のように見せないことが、この診断の信頼性の前提になる。
 */
export type DataSource =
  | 'measured' // 航空写真からの計算値など、この場で算出した値
  | 'official' // 国土交通省など公的APIから取得した値
  | 'osm' // OpenStreetMapの実データ
  | 'estimated' // 上記が得られず、周辺情報から推定した値

export interface Sourced<T> {
  value: T
  source: DataSource
  /** 補足（取得年度、算出根拠など） */
  note?: string
}

export type DiagnosisStepId =
  | 'address'
  | 'geocode'
  | 'aerial'
  | 'surrounding'
  | 'ai_analysis'
  | 'land_price'
  | 'sale_price'
  | 'utilization'
  | 'render'
  | 'pdf'

export interface DiagnosisStep {
  id: DiagnosisStepId
  label: string
}

export const DIAGNOSIS_STEPS: DiagnosisStep[] = [
  { id: 'address', label: '住所取得' },
  { id: 'geocode', label: '緯度経度取得' },
  { id: 'aerial', label: '航空写真取得' },
  { id: 'surrounding', label: '周辺データ取得' },
  { id: 'ai_analysis', label: 'AI解析' },
  { id: 'land_price', label: '土地価格推定' },
  { id: 'sale_price', label: '売却価格予測' },
  { id: 'utilization', label: '活用提案' },
  { id: 'render', label: '完成イメージ生成' },
  { id: 'pdf', label: 'PDF作成' },
]

export interface SurroundingData {
  /** 坪単価(円) */
  tsuboTanka: Sourced<number>
  /** 公示地価(㎡単価・円) */
  koujiChika: Sourced<number>
  /** 路線価(㎡単価・円) */
  rosenka: Sourced<number>
  /** 周辺売買価格(坪単価・円) */
  shuuhenBaibaiKakaku: Sourced<number>
  /** 民営借家の平均家賃(1戸あたり月額・円) */
  shuuhenChinryou: Sourced<number>
  youtoChiiki: Sourced<string>
  kenpeiRitsu: Sourced<number>
  yousekiRitsu: Sourced<number>
  setsudouJoukyou: Sourced<string>
  hazardInfo: Sourced<string>
  /** 標高(m) */
  elevation: Sourced<number | null>
  gakkou: Sourced<number>
  byouin: Sourced<number>
  suupaa: Sourced<number>
  eki: Sourced<string>
  /** 最寄り駅までの距離(m) */
  ekiKyori: Sourced<number | null>
  hiatari: Sourced<string>
  landShape: Sourced<string>
  buildingRestriction: Sourced<string>
}

export interface LandArea {
  sqm: number
  tsubo: number
  source: DataSource
  note?: string
}

export interface PriceEstimate {
  landPricePerTsubo: number
  landPriceTotal: number
  salePriceLow: number
  salePriceHigh: number
  saleEase: 'high' | 'medium' | 'low'
  expectedSaleMonths: number
  /** 周辺相場との差(%) */
  marketComparisonPercent: number
  /** 価格算出の根拠 */
  basis: DataSource
  basisNote: string
}

export interface UtilizationProposal {
  id: string
  name: string
  score: number
  estimatedMonthlyProfit: number
  estimatedInitialCost: number
  description: string
  imageStyle: 'render3d' | 'illustration'
  /** この土地でその用途が成立しない場合の理由 */
  caution?: string
  /** Claude APIによる、この土地固有の評価根拠。あればdescriptionより優先して表示する。 */
  aiReasoning?: string
}

/** 収益シミュレーション(年次キャッシュフロー) */
export interface RevenueProjection {
  proposalId: string
  proposalName: string
  initialCost: number
  /** 各年末時点の累積損益(円) */
  cumulative: number[]
  /** 投資回収に要する年数。回収不能なら null */
  paybackYears: number | null
  /** 10年間の累計利益 */
  tenYearProfit: number
}

export interface DiagnosisResult {
  location: LocationData
  area: LandArea
  surrounding: SurroundingData
  price: PriceEstimate
  proposals: UtilizationProposal[]
  projections: RevenueProjection[]
  aiComment: string
  generatedAt: string
  /** 取得に失敗した外部データがあれば理由を記録する */
  warnings: string[]
  /** Claude APIによる分析が反映されているか */
  aiPowered: boolean
  /** 収益シミュレーションの前提条件についてのAI補足(あれば) */
  revenueAssumption?: string
}
