import { useRef } from 'react'
import type { PhotoData } from '../types/diagnosis'

interface Props {
  photo: PhotoData | null
  onChange: (photo: PhotoData | null) => void
}

export function PhotoInput({ photo, onChange }: Props) {
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)

  function handleFile(file: File | undefined) {
    if (!file) return
    const previewUrl = URL.createObjectURL(file)
    onChange({ file, previewUrl })
  }

  return (
    <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-5">
      <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500 text-white text-xs font-bold">1</span>
        写真
        <span className="text-xs font-normal text-rose-500">必須</span>
      </h3>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">写真撮影またはアップロード、どちらか一方を選択してください。</p>

      {photo ? (
        <div className="mt-4 relative">
          <img
            src={photo.previewUrl}
            alt="空き地の写真"
            className="w-full h-48 object-cover rounded-xl border border-neutral-200 dark:border-neutral-800"
          />
          <button
            type="button"
            onClick={() => onChange(null)}
            className="absolute top-2 right-2 bg-black/60 text-white text-xs px-3 py-1.5 rounded-full hover:bg-black/80 transition"
          >
            削除してやり直す
          </button>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-neutral-300 dark:border-neutral-700 py-8 text-neutral-600 dark:text-neutral-300 hover:border-emerald-500 hover:text-emerald-600 transition"
          >
            <CameraIcon />
            <span className="text-sm font-medium">写真撮影</span>
          </button>
          <button
            type="button"
            onClick={() => uploadInputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-neutral-300 dark:border-neutral-700 py-8 text-neutral-600 dark:text-neutral-300 hover:border-emerald-500 hover:text-emerald-600 transition"
          >
            <UploadIcon />
            <span className="text-sm font-medium">写真アップロード</span>
          </button>
        </div>
      )}

      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
    </div>
  )
}

function CameraIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13" r="3.2" />
    </svg>
  )
}

function UploadIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
      <path d="M7 9l5-5 5 5" />
      <path d="M12 4v12" />
    </svg>
  )
}
