import { useState } from 'react'
import jsPDF from 'jspdf'
import type { DiagnosisResult } from '../types/diagnosis'
import { formatManYen } from '../lib/format'
import { buildTileGrid, aerialTileUrl, mapTileUrl, TILE_SIZE } from '../lib/api/tiles'
import { getCachedProposalImage } from '../lib/api/imageGen'

interface Props {
  result: DiagnosisResult
  photoUrl: string | null
}

const SOURCE_LABEL: Record<string, string> = {
  measured: '実測',
  official: '公的データ',
  osm: '地図データ',
  estimated: '推定',
}

/**
 * タイル群をcanvasに合成してdata URLを作る。
 * ブラウザのcanvas.toDataURLは同一オリジンでない画像を焼き込めない(タイル画像は他ドメイン)ため、
 * fetchでバイナリ取得後、blob URL経由でImageに読み込ませてから描画する。
 */
async function renderTilesToDataUrl(
  lat: number,
  lng: number,
  zoom: number,
  kind: 'aerial' | 'map',
): Promise<string> {
  const cols = 3
  const rows = 3
  const grid = buildTileGrid(lat, lng, zoom, cols, rows)
  const urlFor = kind === 'aerial' ? aerialTileUrl : mapTileUrl

  const canvas = document.createElement('canvas')
  canvas.width = grid.width
  canvas.height = grid.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')

  await Promise.all(
    grid.tiles.map(async (t) => {
      try {
        const res = await fetch(urlFor(t))
        const blob = await res.blob()
        const bitmap = await createImageBitmap(blob)
        ctx.drawImage(bitmap, t.left, t.top, TILE_SIZE, TILE_SIZE)
      } catch {
        // 1枚欠けても全体の生成は継続する
      }
    }),
  )

  return canvas.toDataURL('image/jpeg', 0.85)
}

function buildReportHtml(result: DiagnosisResult, photoUrl: string | null, aerialDataUrl: string | null, mapDataUrl: string | null): HTMLDivElement {
  const { surrounding: s, price, location, proposals, projections, aiComment, area, warnings } = result

  const container = document.createElement('div')
  container.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    z-index: -9999;
    width: 780px;
    background: #ffffff;
    color: #171717;
    font-family: 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', system-ui, sans-serif;
    padding: 32px;
    box-sizing: border-box;
  `

  const locLine =
    location.method === 'gps'
      ? `緯度 ${location.lat?.toFixed(5)} / 経度 ${location.lng?.toFixed(5)}`
      : location.address

  const photoRow = [
    photoUrl ? `<div style="flex:1"><p style="font-size:10px;color:#737373;margin:0 0 4px;">現地写真</p><img src="${photoUrl}" style="width:100%;height:160px;object-fit:cover;border-radius:6px;" /></div>` : '',
    aerialDataUrl ? `<div style="flex:1"><p style="font-size:10px;color:#737373;margin:0 0 4px;">航空写真</p><img src="${aerialDataUrl}" style="width:100%;height:160px;object-fit:cover;border-radius:6px;" /></div>` : '',
    mapDataUrl ? `<div style="flex:1"><p style="font-size:10px;color:#737373;margin:0 0 4px;">地図</p><img src="${mapDataUrl}" style="width:100%;height:160px;object-fit:cover;border-radius:6px;" /></div>` : '',
  ]
    .filter(Boolean)
    .join('')

  const proposalRows = proposals
    .map(
      (p, idx) => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e5e5;">${idx + 1}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e5e5;font-weight:600;">${p.name}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e5e5;">${p.score}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e5e5;">${formatManYen(p.estimatedInitialCost)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e5e5;">${formatManYen(p.estimatedMonthlyProfit)}</td>
      </tr>`,
    )
    .join('')

  const imageProposals = proposals.slice(0, 3).flatMap((p) => {
    const url = getCachedProposalImage(p.id)
    return url ? [{ p, url }] : []
  })
  const completionImagesBlock =
    imageProposals.length > 0
      ? `
    <h2 style="font-size:15px;font-weight:700;margin:20px 0 8px;border-left:4px solid #059669;padding-left:8px;">完成イメージ</h2>
    <div style="display:flex;gap:10px;">
      ${imageProposals
        .map(
          ({ p, url }) => `
        <div style="flex:1;text-align:center;">
          <img src="${url}" style="width:100%;border-radius:6px;" />
          <p style="font-size:11px;color:#525252;margin:4px 0 0;">${p.name}</p>
        </div>`,
        )
        .join('')}
    </div>`
      : ''

  const projectionRows = projections
    .map(
      (p) => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e5e5;font-weight:600;">${p.proposalName}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e5e5;">${formatManYen(p.initialCost)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e5e5;">${p.paybackYears ? `${p.paybackYears}年` : '10年内未回収'}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e5e5;">${formatManYen(p.tenYearProfit)}</td>
      </tr>`,
    )
    .join('')

  const src = (source: string) => `<span style="font-size:9px;background:#f0fdf4;color:#15803d;padding:1px 6px;border-radius:8px;margin-left:4px;">${SOURCE_LABEL[source] ?? source}</span>`

  const warningsBlock =
    warnings.length > 0
      ? `<h2 style="font-size:15px;font-weight:700;margin:20px 0 8px;border-left:4px solid #d97706;padding-left:8px;">データ取得に関する注記</h2>
         <ul style="font-size:11px;color:#78350f;background:#fffbeb;padding:10px 14px 10px 28px;border-radius:8px;margin:0;">
           ${warnings.map((w) => `<li style="margin-bottom:4px;">${w}</li>`).join('')}
         </ul>`
      : ''

  container.innerHTML = `
    <h1 style="font-size:22px;font-weight:700;margin:0 0 4px;">空き地AI総合診断レポート</h1>
    <p style="font-size:11px;color:#737373;margin:0 0 20px;">作成日時: ${new Date(result.generatedAt).toLocaleString('ja-JP')}</p>

    <div style="display:flex;gap:10px;margin-bottom:16px;">${photoRow}</div>

    <h2 style="font-size:15px;font-weight:700;margin:16px 0 8px;border-left:4px solid #059669;padding-left:8px;">診断対象地</h2>
    <p style="font-size:13px;margin:0 0 4px;">${locLine}</p>
    <p style="font-size:12px;color:#525252;margin:0;">
      土地面積: ${area.sqm.toFixed(1)}㎡ (${area.tsubo.toFixed(1)}坪)${src(area.source)}<br/>
      用途地域: ${s.youtoChiiki.value}${src(s.youtoChiiki.source)} ／ 建ぺい率・容積率: ${s.kenpeiRitsu.value}% / ${s.yousekiRitsu.value}%${src(s.kenpeiRitsu.source)} ／ 接道状況: ${s.setsudouJoukyou.value}${src(s.setsudouJoukyou.source)}<br/>
      最寄り駅: ${s.eki.value}${s.ekiKyori.value != null ? `(${s.ekiKyori.value}m)` : ''}${src(s.eki.source)}
    </p>

    <h2 style="font-size:15px;font-weight:700;margin:20px 0 8px;border-left:4px solid #059669;padding-left:8px;">価格診断</h2>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr>
        <td style="padding:6px 8px;color:#737373;">坪単価</td>
        <td style="padding:6px 8px;font-weight:700;">${formatManYen(s.tsuboTanka.value)}${src(s.tsuboTanka.source)}</td>
        <td style="padding:6px 8px;color:#737373;">推定土地価格</td>
        <td style="padding:6px 8px;font-weight:700;">${formatManYen(price.landPriceTotal)}</td>
      </tr>
      <tr>
        <td style="padding:6px 8px;color:#737373;">売却予想価格</td>
        <td style="padding:6px 8px;font-weight:700;" colspan="3">${formatManYen(price.salePriceLow)} 〜 ${formatManYen(price.salePriceHigh)} (周辺相場比 ${price.marketComparisonPercent > 0 ? '+' : ''}${price.marketComparisonPercent}%)</td>
      </tr>
      <tr>
        <td style="padding:6px 8px;color:#737373;">売却しやすさ</td>
        <td style="padding:6px 8px;font-weight:700;">${price.saleEase === 'high' ? '売却しやすい' : price.saleEase === 'medium' ? '標準的' : '時間がかかる可能性'}</td>
        <td style="padding:6px 8px;color:#737373;">想定売却期間</td>
        <td style="padding:6px 8px;font-weight:700;">約${price.expectedSaleMonths}ヶ月</td>
      </tr>
    </table>
    <p style="font-size:10px;color:#a3a3a3;margin:4px 0 0;">${price.basisNote}</p>

    <h2 style="font-size:15px;font-weight:700;margin:20px 0 8px;border-left:4px solid #059669;padding-left:8px;">周辺データ</h2>
    <p style="font-size:12px;color:#525252;line-height:1.9;margin:0;">
      公示地価: ${formatManYen(s.koujiChika.value)}${src(s.koujiChika.source)} ／ 路線価: ${formatManYen(s.rosenka.value)}${src(s.rosenka.source)} ／ 地域の平均家賃(月額): ${formatManYen(s.shuuhenChinryou.value)}${src(s.shuuhenChinryou.source)}<br/>
      ハザード情報: ${s.hazardInfo.value}${src(s.hazardInfo.source)}<br/>
      日当たり: ${s.hiatari.value}${src(s.hiatari.source)} ／ 土地形状: ${s.landShape.value}${src(s.landShape.source)}
    </p>

    <h2 style="font-size:15px;font-weight:700;margin:20px 0 8px;border-left:4px solid #059669;padding-left:8px;">活用提案ランキング</h2>
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead>
        <tr style="background:#f5f5f5;">
          <th style="padding:6px 8px;text-align:left;">順位</th>
          <th style="padding:6px 8px;text-align:left;">活用方法</th>
          <th style="padding:6px 8px;text-align:left;">適合度</th>
          <th style="padding:6px 8px;text-align:left;">想定初期費用</th>
          <th style="padding:6px 8px;text-align:left;">想定月間収益</th>
        </tr>
      </thead>
      <tbody>${proposalRows}</tbody>
    </table>

    ${completionImagesBlock}

    <h2 style="font-size:15px;font-weight:700;margin:20px 0 8px;border-left:4px solid #059669;padding-left:8px;">収益シミュレーション(10年)</h2>
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead>
        <tr style="background:#f5f5f5;">
          <th style="padding:6px 8px;text-align:left;">活用方法</th>
          <th style="padding:6px 8px;text-align:left;">初期費用</th>
          <th style="padding:6px 8px;text-align:left;">回収年数</th>
          <th style="padding:6px 8px;text-align:left;">10年累計利益</th>
        </tr>
      </thead>
      <tbody>${projectionRows}</tbody>
    </table>

    <h2 style="font-size:15px;font-weight:700;margin:20px 0 8px;border-left:4px solid #059669;padding-left:8px;">AIコメント</h2>
    <p style="font-size:13px;line-height:1.8;background:#ecfdf5;padding:12px 14px;border-radius:8px;margin:0;">${aiComment}</p>

    ${warningsBlock}
  `

  return container
}

export function ReportExport({ result, photoUrl }: Props) {
  const [generating, setGenerating] = useState(false)

  async function handleExport() {
    setGenerating(true)
    let container: HTMLDivElement | null = null
    try {
      const { lat, lng } = result.location
      let aerialDataUrl: string | null = null
      let mapDataUrl: string | null = null

      if (lat != null && lng != null) {
        ;[aerialDataUrl, mapDataUrl] = await Promise.all([
          renderTilesToDataUrl(lat, lng, 18, 'aerial').catch(() => null),
          renderTilesToDataUrl(lat, lng, 16, 'map').catch(() => null),
        ])
      }

      container = buildReportHtml(result, photoUrl, aerialDataUrl, mapDataUrl)
      document.body.appendChild(container)

      const doc = new jsPDF({ unit: 'mm', format: 'a4' })
      await doc.html(container, {
        width: 190,
        windowWidth: 780,
        margin: [10, 10, 10, 10],
        autoPaging: 'text',
        html2canvas: { scale: 0.6, useCORS: true },
      })
      doc.save(`land-diagnosis-report-${Date.now()}.pdf`)
    } finally {
      if (container) document.body.removeChild(container)
      setGenerating(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={generating}
      className="w-full rounded-xl bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 py-3.5 text-sm font-semibold hover:opacity-90 transition disabled:opacity-50"
    >
      {generating ? 'PDFを作成中…' : 'PDFレポートをダウンロード'}
    </button>
  )
}
