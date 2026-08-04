/**
 * e-Stat(政府統計の総合窓口)から、都道府県別の民営借家 平均家賃を取得する。
 *
 * 「住宅・土地統計調査」の家賃階級(19区分)別の借家数データから、
 * 階級の中央値×件数で加重平均を計算する(グループ化データの平均推定という
 * 標準的な統計手法。個々の物件の家賃そのものではないが、当てずっぽうの
 * 利回り仮定より遥かに根拠がある)。
 *
 * 家賃階級と延べ面積を掛け合わせた「坪単価」までは元データの構造上
 * 安全に導出できないため、坪単価への変換は行わず「1戸あたり平均月額家賃」
 * という、元データが実際に裏付けられる粒度でとどめる。
 */

const PROXY_ENDPOINT = '/api/estat'
const STATS_CODE = '00200522' // 住宅・土地統計調査

class EstatUnavailableError extends Error {
  constructor() {
    super('e-Stat APIのキーが未設定です')
    this.name = 'EstatUnavailableError'
  }
}

export function isEstatUnavailable(err: unknown): boolean {
  return err instanceof EstatUnavailableError
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callProxy(action: 'getStatsList' | 'getStatsData', params: Record<string, string>): Promise<any> {
  const query = new URLSearchParams({ action, ...params }).toString()
  const res = await fetch(`${PROXY_ENDPOINT}?${query}`)
  if (res.status === 503) throw new EstatUnavailableError()
  if (!res.ok) throw new Error(`e-Stat APIエラー: ${res.status}`)
  return res.json()
}

/** 「1〜5,000円未満」「200,000円以上」等のラベルから代表値(円)を推定する。 */
function midpointFromLabel(label: string): number | null {
  // カンマ区切り("5,000")のままだと桁が分割されて誤読するため先に除去する
  const cleaned = label.replace(/,/g, '')
  const nums = Array.from(cleaned.matchAll(/(\d+(?:\.\d+)?)/g)).map((m) => Number.parseFloat(m[1]))
  if (nums.length === 0) return null
  if (nums.length >= 2) return (nums[0] + nums[1]) / 2
  if (cleaned.includes('未満')) return nums[0] / 2
  if (cleaned.includes('以上')) return nums[0] * 1.15
  return nums[0]
}

/** 統計表の中から、家賃(19区分)×都道府県別の最新調査のものを1件探す。 */
async function findRentStatsDataId(): Promise<string> {
  const list = await callProxy('getStatsList', {
    statsCode: STATS_CODE,
    searchWord: '家賃 都道府県',
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = list?.GET_STATS_LIST?.DATALIST_INF?.TABLE_INF
  const arr = Array.isArray(items) ? items : items ? [items] : []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candidates = arr.filter((t: any) => {
    const title = typeof t.TITLE === 'string' ? t.TITLE : t.TITLE?.['$'] ?? ''
    return title.includes('家賃') && title.includes('都道府県')
  })

  if (candidates.length === 0) throw new Error('該当する家賃統計表が見つかりませんでした')

  // SURVEY_DATEが最も新しいものを採用
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  candidates.sort((a: any, b: any) => Number(b.SURVEY_DATE ?? 0) - Number(a.SURVEY_DATE ?? 0))
  return candidates[0]['@id']
}

export interface RegionalRentResult {
  /** 民営借家(専用住宅)の1戸あたり平均月額家賃(円) */
  averageMonthlyRent: number
  /** 集計に使った借家の件数(サンプル数) */
  sampleCount: number
  prefectureCode: string
  statsDataId: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function classArray(classObjs: any): any[] {
  return Array.isArray(classObjs) ? classObjs : classObjs ? [classObjs] : []
}

export async function fetchRegionalAverageRent(prefectureCode: string): Promise<RegionalRentResult> {
  const statsDataId = await findRentStatsDataId()

  // e-Statの地域(area)分類は都道府県レベルで5桁("13000"=東京都)が標準的なコード体系。
  // 2桁の都道府県コード(JIS)とは異なるため、末尾に"000"を付与して変換する。
  const estatAreaCode = `${prefectureCode}000`

  // メタデータのみを軽量取得し、家賃階級の分類と、それ以外の分類軸(住宅の種類・
  // 入居時期・畳数など)を特定する。他の軸を絞り込まずに全件を合計すると、
  // 軸同士の掛け合わせで同じ世帯が何重にも重複集計されてしまうため、
  // 家賃階級・地域・時間軸以外はすべて「総数」コードに固定して1軸だけの
  // 内訳になるよう絞り込む。
  const meta = await callProxy('getStatsData', { statsDataId, metaGetFlg: 'Y', limit: '1' })
  const metaClassArr = classArray(meta?.GET_STATS_DATA?.STATISTICAL_DATA?.CLASS_INF?.CLASS_OBJ)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rentClassObj = metaClassArr.find((c: any) => (typeof c['@name'] === 'string' ? c['@name'] : '').includes('家賃'))
  if (!rentClassObj) throw new Error('家賃階級の分類情報が見つかりませんでした')

  const dataParams: Record<string, string> = { statsDataId, cdArea: estatAreaCode, metaGetFlg: 'Y' }
  for (const c of metaClassArr) {
    const id: string = c['@id']
    if (id === rentClassObj['@id'] || id === 'area' || id === 'time') continue
    const items = classArray(c.CLASS)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const total = items.find((i: any) => typeof i['@name'] === 'string' && i['@name'].includes('総数'))
    if (total) {
      const paramName = `cd${id.charAt(0).toUpperCase()}${id.slice(1)}`
      dataParams[paramName] = total['@code']
    }
  }

  const data = await callProxy('getStatsData', dataParams)
  const statData = data?.GET_STATS_DATA?.STATISTICAL_DATA
  const classItems = classArray(rentClassObj.CLASS)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const labelByCode = new Map<string, string>(classItems.map((c: any) => [c['@code'], c['@name']]))

  const values = statData?.DATA_INF?.VALUE
  const valueArr = Array.isArray(values) ? values : values ? [values] : []
  const rentCategoryKey = `@${rentClassObj['@id']}`

  let weightedSum = 0
  let totalCount = 0

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const v of valueArr as any[]) {
    const code = v[rentCategoryKey]
    const label = code ? labelByCode.get(code) : undefined
    if (!label || label.includes('総数') || label.includes('計')) continue

    const midpoint = midpointFromLabel(label)
    const count = Number.parseFloat(v['$'])
    if (midpoint === null || !Number.isFinite(count) || count <= 0) continue

    weightedSum += midpoint * count
    totalCount += count
  }

  if (totalCount === 0) throw new Error('有効な家賃データを集計できませんでした')

  return {
    averageMonthlyRent: Math.round(weightedSum / totalCount),
    sampleCount: totalCount,
    prefectureCode,
    statsDataId,
  }
}
