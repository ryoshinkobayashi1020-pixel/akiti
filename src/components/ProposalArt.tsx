import { useEffect, useState } from 'react'
import { generateProposalImage, getCachedProposalImage } from '../lib/api/imageGen'

interface Props {
  id: string
  name: string
  imageStyle: 'render3d' | 'illustration'
  /** trueの場合、AI画像生成APIで実際の完成イメージを試みる(コストが発生するため上位提案のみ推奨) */
  useAiImage?: boolean
  landContext?: string
  /** 対象地の実際の航空写真(data URL)。指定時はこれを参照にした完成イメージを生成する */
  aerialImageDataUrl?: string | null
}

const PALETTE: Record<string, [string, string]> = {
  parking: ['#64748b', '#cbd5e1'],
  trunkroom: ['#0891b2', '#a5f3fc'],
  container: ['#ea580c', '#fed7aa'],
  farm: ['#16a34a', '#bbf7d0'],
  apartment: ['#4338ca', '#c7d2fe'],
  dogrun: ['#ca8a04', '#fef08a'],
  event: ['#db2777', '#fbcfe8'],
  materials: ['#78716c', '#e7e5e4'],
  disaster: ['#dc2626', '#fecaca'],
  park: ['#059669', '#a7f3d0'],
}

function Icon({ id }: { id: string }) {
  const stroke = '#1f2937'
  const common = { fill: 'none', stroke, strokeWidth: 1.6, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const }
  switch (id) {
    case 'parking':
      return (
        <g {...common}>
          <rect x="20" y="30" width="120" height="70" rx="4" fill="#fff" fillOpacity="0.85" />
          <path d="M40 30 V100 M100 30 V100" strokeDasharray="6 6" />
          <path d="M55 55 h20 a10 10 0 0 1 0 20 h-14 v15" fill="none" />
        </g>
      )
    case 'trunkroom':
      return (
        <g {...common}>
          <rect x="30" y="45" width="35" height="45" fill="#fff" fillOpacity="0.85" />
          <rect x="70" y="35" width="35" height="55" fill="#fff" fillOpacity="0.85" />
          <rect x="110" y="50" width="30" height="40" fill="#fff" fillOpacity="0.85" />
        </g>
      )
    case 'container':
      return (
        <g {...common}>
          <rect x="25" y="50" width="110" height="45" rx="2" fill="#fff" fillOpacity="0.85" />
          <path d="M25 50 L45 35 H155 L135 50" fill="#fff" fillOpacity="0.6" />
          <path d="M155 35 V80 L135 95 V50 Z" fill="#fff" fillOpacity="0.4" />
          <path d="M45 60 V85 M65 60 V85 M85 60 V85 M105 60 V85 M125 60 V85" strokeWidth="1" />
        </g>
      )
    case 'farm':
      return (
        <g {...common}>
          <path d="M20 90 Q45 70 70 90 T120 90 T160 90" fill="none" />
          <path d="M20 100 Q45 80 70 100 T120 100 T160 100" fill="none" />
          <circle cx="45" cy="50" r="10" fill="#fff" fillOpacity="0.85" />
          <circle cx="80" cy="45" r="12" fill="#fff" fillOpacity="0.85" />
          <circle cx="115" cy="50" r="10" fill="#fff" fillOpacity="0.85" />
        </g>
      )
    case 'apartment':
      return (
        <g {...common}>
          <rect x="45" y="20" width="70" height="90" fill="#fff" fillOpacity="0.85" />
          {[0, 1, 2, 3].map((row) =>
            [0, 1, 2].map((col) => (
              <rect key={`${row}-${col}`} x={55 + col * 20} y={30 + row * 20} width="12" height="12" fill={stroke} fillOpacity="0.5" />
            )),
          )}
        </g>
      )
    case 'dogrun':
      return (
        <g {...common}>
          <rect x="25" y="35" width="110" height="65" fill="none" strokeDasharray="4 4" />
          <path d="M70 75 q-8 -10 0 -14 q6 -3 10 3 q4 -6 10 -3 q8 4 0 14 q-5 5 -10 8 q-5 -3 -10 -8Z" fill="#fff" fillOpacity="0.85" />
        </g>
      )
    case 'event':
      return (
        <g {...common}>
          <path d="M40 90 V55 L70 35 L100 55 V90" fill="#fff" fillOpacity="0.85" />
          <path d="M100 90 V60 L125 45 L150 60 V90" fill="#fff" fillOpacity="0.7" />
        </g>
      )
    case 'materials':
      return (
        <g {...common}>
          <circle cx="45" cy="80" r="14" fill="#fff" fillOpacity="0.85" />
          <circle cx="75" cy="80" r="14" fill="#fff" fillOpacity="0.85" />
          <circle cx="60" cy="55" r="14" fill="#fff" fillOpacity="0.85" />
          <rect x="100" y="55" width="45" height="35" fill="#fff" fillOpacity="0.6" />
        </g>
      )
    case 'disaster':
      return (
        <g {...common}>
          <rect x="35" y="45" width="90" height="50" fill="#fff" fillOpacity="0.85" />
          <path d="M80 20 L100 30 V50 Q100 65 80 72 Q60 65 60 50 V30 Z" fill="#fff" fillOpacity="0.9" />
          <path d="M72 48 l6 6 12 -14" />
        </g>
      )
    case 'park':
      return (
        <g {...common}>
          <path d="M50 70 L65 40 L80 70 Z" fill="#fff" fillOpacity="0.85" />
          <path d="M85 75 L100 45 L115 75 Z" fill="#fff" fillOpacity="0.85" />
          <path d="M60 70 V95 M105 75 V95" />
          <rect x="30" y="90" width="110" height="6" fill="#fff" fillOpacity="0.6" />
        </g>
      )
    default:
      return null
  }
}

function PlaceholderArt({ id }: { id: string }) {
  const [c1, c2] = PALETTE[id] ?? ['#64748b', '#cbd5e1']
  const gradId = `grad-${id}`

  return (
    <svg viewBox="0 0 160 110" className="w-full h-full">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={c1} />
          <stop offset="100%" stopColor={c2} />
        </linearGradient>
      </defs>
      <rect width="160" height="110" fill={`url(#${gradId})`} />
      <Icon id={id} />
    </svg>
  )
}

export function ProposalArt({ id, name, imageStyle, useAiImage = false, landContext = '', aerialImageDataUrl }: Props) {
  const [aiImageUrl, setAiImageUrl] = useState<string | null>(() => getCachedProposalImage(id) ?? null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiFailed, setAiFailed] = useState(false)

  useEffect(() => {
    if (!useAiImage || aiImageUrl) return
    let cancelled = false
    setAiLoading(true)
    generateProposalImage(id, name, imageStyle, landContext, aerialImageDataUrl)
      .then((url) => {
        if (!cancelled) setAiImageUrl(url)
      })
      .catch(() => {
        if (!cancelled) setAiFailed(true)
      })
      .finally(() => {
        if (!cancelled) setAiLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useAiImage, id])

  return (
    <div className="relative rounded-xl overflow-hidden border border-neutral-200 dark:border-neutral-800 h-40">
      {aiImageUrl ? (
        <img src={aiImageUrl} alt={`${name}の完成イメージ`} className="w-full h-full object-cover" />
      ) : aiLoading ? (
        <div className="w-full h-full flex items-center justify-center bg-neutral-100 dark:bg-neutral-800">
          <div className="w-6 h-6 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
        </div>
      ) : (
        <PlaceholderArt id={id} />
      )}
      <span className="absolute bottom-1.5 right-1.5 text-[10px] font-medium bg-black/50 text-white px-2 py-0.5 rounded-full backdrop-blur-sm">
        {aiImageUrl
          ? imageStyle === 'render3d'
            ? 'AI生成 3Dパース'
            : 'AI生成イラスト'
          : imageStyle === 'render3d'
            ? '3Dパース風(プレースホルダー)'
            : 'イラスト風(プレースホルダー)'}
      </span>
      {useAiImage && aiFailed && (
        <span className="absolute top-1.5 left-1.5 text-[9px] bg-amber-500/90 text-white px-1.5 py-0.5 rounded">
          AI生成失敗
        </span>
      )}
    </div>
  )
}
