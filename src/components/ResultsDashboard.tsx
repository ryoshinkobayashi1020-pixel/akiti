import type { DiagnosisResult, DataSource, Sourced } from '../types/diagnosis'
import { formatManYen } from '../lib/format'
import { TileCanvas } from './TileCanvas'

interface Props {
  result: DiagnosisResult
  photoUrl: string | null
}

const SALE_EASE_LABEL: Record<DiagnosisResult['price']['saleEase'], { label: string; color: string }> = {
  high: { label: '売却しやすい', color: 'text-emerald-600 dark:text-emerald-400' },
  medium: { label: '標準的', color: 'text-amber-600 dark:text-amber-400' },
  low: { label: '時間がかかる可能性', color: 'text-rose-600 dark:text-rose-400' },
}

const SOURCE_LABEL: Record<DataSource, { label: string; className: string }> = {
  measured: { label: '実測', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300' },
  official: { label: '公的データ', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300' },
  osm: { label: '地図データ', className: 'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300' },
  estimated: { label: '推定', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300' },
}

function SourceBadge({ source }: { source: DataSource }) {
  const s = SOURCE_LABEL[source]
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${s.className}`}>{s.label}</span>
}

function InfoItem({ label, data }: { label: string; data: Sourced<string> }) {
  return (
    <div>
      <p className="text-xs text-neutral-400 dark:text-neutral-500 flex items-center gap-1.5">
        {label}
        <SourceBadge source={data.source} />
      </p>
      <p className="text-neutral-800 dark:text-neutral-200 font-medium" title={data.note}>
        {data.value}
      </p>
    </div>
  )
}

export function ResultsDashboard({ result, photoUrl }: Props) {
  const { surrounding, price, location, aiComment, area, warnings } = result
  const ease = SALE_EASE_LABEL[price.saleEase]

  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-2 gap-4">
        {photoUrl && (
          <div className="rounded-2xl overflow-hidden border border-neutral-200 dark:border-neutral-800">
            <img src={photoUrl} alt="診断対象の空き地" className="w-full h-56 object-cover" />
          </div>
        )}
        {location.lat != null && location.lng != null && (
          <TileCanvas lat={location.lat} lng={location.lng} zoom={18} kind="aerial" className="rounded-2xl border border-neutral-200 dark:border-neutral-800 h-56" />
        )}
      </div>

      <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-5">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">診断対象地</p>
        <p className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mt-1">
          {location.method === 'gps' ? `緯度${location.lat?.toFixed(5)} / 経度${location.lng?.toFixed(5)}` : location.address}
        </p>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <InfoItem label="用途地域" data={surrounding.youtoChiiki} />
          <div>
            <p className="text-xs text-neutral-400 dark:text-neutral-500 flex items-center gap-1.5">
              建ぺい率/容積率
              <SourceBadge source={surrounding.kenpeiRitsu.source} />
            </p>
            <p className="text-neutral-800 dark:text-neutral-200 font-medium">
              {surrounding.kenpeiRitsu.value}% / {surrounding.yousekiRitsu.value}%
            </p>
          </div>
          <InfoItem label="接道状況" data={surrounding.setsudouJoukyou} />
          <div>
            <p className="text-xs text-neutral-400 dark:text-neutral-500 flex items-center gap-1.5">
              最寄り駅
              <SourceBadge source={surrounding.eki.source} />
            </p>
            <p className="text-neutral-800 dark:text-neutral-200 font-medium">
              {surrounding.eki.value}
              {surrounding.ekiKyori.value != null && ` 約${surrounding.ekiKyori.value}m`}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-5">
        <p className="text-xs text-neutral-500 dark:text-neutral-400 flex items-center gap-1.5">
          土地面積
          <SourceBadge source={area.source} />
        </p>
        <p className="text-xl font-bold text-neutral-900 dark:text-neutral-100 mt-1">
          {area.sqm.toLocaleString('ja-JP', { maximumFractionDigits: 1 })}㎡ ({area.tsubo.toFixed(1)}坪)
        </p>
        {area.note && <p className="text-xs text-neutral-400 mt-1">{area.note}</p>}
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <StatCard label="坪単価" value={formatManYen(surrounding.tsuboTanka.value)} sub="周辺相場ベース" source={surrounding.tsuboTanka.source} />
        <StatCard
          label="推定土地価格"
          value={formatManYen(price.landPriceTotal)}
          sub={`坪単価 ${formatManYen(price.landPricePerTsubo)}`}
          source={price.basis}
          highlight
        />
        <StatCard
          label="売却予想価格"
          value={`${formatManYen(price.salePriceLow)} 〜 ${formatManYen(price.salePriceHigh)}`}
          sub={`周辺相場比 ${price.marketComparisonPercent > 0 ? '+' : ''}${price.marketComparisonPercent}%`}
          source={price.basis}
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-5">
          <p className="text-xs text-neutral-500 dark:text-neutral-400">売却しやすさ</p>
          <p className={`text-xl font-bold mt-1 ${ease.color}`}>{ease.label}</p>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">想定売却期間 約{price.expectedSaleMonths}ヶ月</p>
        </div>
        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-5">
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-2">周辺データ</p>
          <div className="grid grid-cols-2 gap-y-2 text-sm">
            <InfoItem label="公示地価(㎡単価)" data={{ value: formatManYen(surrounding.koujiChika.value), source: surrounding.koujiChika.source, note: surrounding.koujiChika.note }} />
            <InfoItem label="路線価(㎡単価)" data={{ value: formatManYen(surrounding.rosenka.value), source: surrounding.rosenka.source, note: surrounding.rosenka.note }} />
            <InfoItem label="地域の平均家賃(月額)" data={{ value: formatManYen(surrounding.shuuhenChinryou.value), source: surrounding.shuuhenChinryou.source, note: surrounding.shuuhenChinryou.note }} />
            <InfoItem label="ハザード情報" data={surrounding.hazardInfo} />
            <InfoItem label="日当たり" data={surrounding.hiatari} />
            <InfoItem label="土地形状" data={surrounding.landShape} />
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 p-5">
        <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 mb-1 flex items-center gap-1.5">
          AIコメント
          {result.aiPowered ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-600 text-white font-medium">Claude API</span>
          ) : (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300 font-medium">
              簡易ロジック
            </span>
          )}
        </p>
        <p className="text-sm text-emerald-900 dark:text-emerald-200 leading-relaxed">{aiComment}</p>
      </div>

      {warnings.length > 0 && (
        <details className="rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20 p-4">
          <summary className="text-xs font-semibold text-amber-700 dark:text-amber-400 cursor-pointer">
            一部データの取得に制限がありました({warnings.length}件)
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-amber-700 dark:text-amber-400 list-disc list-inside">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  sub,
  source,
  highlight,
}: {
  label: string
  value: string
  sub: string
  source: DataSource
  highlight?: boolean
}) {
  return (
    <div
      className={
        'rounded-2xl p-5 border ' +
        (highlight
          ? 'bg-neutral-900 dark:bg-neutral-100 border-neutral-900 dark:border-neutral-100'
          : 'border-neutral-200 dark:border-neutral-800')
      }
    >
      <p className={'text-xs flex items-center gap-1.5 ' + (highlight ? 'text-neutral-300 dark:text-neutral-600' : 'text-neutral-500 dark:text-neutral-400')}>
        {label}
        <SourceBadge source={source} />
      </p>
      <p className={'text-2xl font-bold mt-1 ' + (highlight ? 'text-white dark:text-neutral-900' : 'text-neutral-900 dark:text-neutral-100')}>
        {value}
      </p>
      <p className={'text-xs mt-1 ' + (highlight ? 'text-neutral-400 dark:text-neutral-500' : 'text-neutral-400 dark:text-neutral-500')}>{sub}</p>
    </div>
  )
}
