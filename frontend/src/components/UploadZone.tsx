import { useRef, useState } from 'react'
import { Upload, X, ImageIcon, FileArchive } from 'lucide-react'
import { cn } from '@/lib/utils'

interface UploadZoneProps {
  files: File[]
  onChange: (files: File[]) => void
}

const ACCEPTED_IMAGE = ['image/jpeg', 'image/png', 'image/webp']
const ACCEPTED_ARCHIVE_EXTS = ['.cbz', '.cbr', '.zip', '.rar', '.7z']
const MAX_SIZE = 20 * 1024 * 1024
const MAX_ARCHIVE_SIZE = 200 * 1024 * 1024

export function UploadZone({ files, onChange }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  function addFiles(incoming: FileList | null) {
    if (!incoming) return
    const valid = Array.from(incoming).filter((f) => {
      const ext = '.' + f.name.split('.').pop()?.toLowerCase()
      if (ACCEPTED_ARCHIVE_EXTS.includes(ext)) return f.size <= MAX_ARCHIVE_SIZE
      if (ACCEPTED_IMAGE.includes(f.type)) return f.size <= MAX_SIZE
      return false
    })
    onChange([...files, ...valid])
  }

  function removeFile(idx: number) {
    onChange(files.filter((_, i) => i !== idx))
  }

  return (
    <div className="space-y-3">
      <div
        className={cn(
          'relative flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition-all',
          dragging ? 'border-indigo-400 bg-indigo-50/50 scale-[1.01]' : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50/50',
        )}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files) }}
      >
        <Upload className="mb-2 h-8 w-8 text-slate-400" />
        <p className="text-sm text-slate-500">拖拽图片或漫画压缩包到此处，或点击选择</p>
        <p className="mt-1 text-xs text-slate-400">支持 JPG / PNG / WebP / CBZ / CBR / ZIP / RAR，图片最大 20 MB，压缩包最大 200 MB</p>
        <input
          ref={inputRef}
          type="file"
          accept={[...ACCEPTED_IMAGE, ...ACCEPTED_ARCHIVE_EXTS].join(',')}
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
      </div>

      {files.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {files.map((f, i) => {
            const ext = '.' + f.name.split('.').pop()?.toLowerCase()
            const isArchive = ACCEPTED_ARCHIVE_EXTS.includes(ext)
            return (
              <div key={i} className="group relative aspect-square overflow-hidden rounded-md bg-slate-100">
                {isArchive ? (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-slate-200">
                    <FileArchive className="h-8 w-8 text-slate-500" />
                    <span className="text-xs text-slate-500">{ext.toUpperCase().slice(1)}</span>
                  </div>
                ) : (
                  <img
                    src={URL.createObjectURL(f)}
                    alt={f.name}
                    className="h-full w-full object-cover"
                  />
                )}
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
                <div className="absolute bottom-0 left-0 right-0 truncate bg-black/40 px-1 py-0.5 text-xs text-white">
                  {isArchive ? (
                    <FileArchive className="mr-1 inline h-3 w-3" />
                  ) : (
                    <ImageIcon className="mr-1 inline h-3 w-3" />
                  )}
                  {f.name}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
