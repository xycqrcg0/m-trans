import { useEffect, useState, useRef } from 'react'
import { Upload, Trash2, Loader2 } from 'lucide-react'
import { listFonts, uploadFont, deleteFont, type FontInfo } from '@/lib/api'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface FontSelectorProps {
  value: string
  onChange: (path: string) => void
}

export function FontSelector({ value, onChange }: FontSelectorProps) {
  const [fonts, setFonts] = useState<FontInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function load() {
    try {
      const res = await listFonts()
      setFonts(res.fonts)
    } catch { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      await uploadFont(file)
      await load()
    } catch { /* ignore */ }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleDelete(name: string) {
    try {
      await deleteFont(name)
      // If deleted font was selected, reset to default
      const deleted = fonts.find(f => f.name === name)
      if (deleted && value === deleted.path) onChange('')
      await load()
    } catch { /* ignore */ }
  }

  if (loading) return <div className="text-xs text-slate-400">加载字体…</div>

  return (
    <div className="space-y-2">
      <Select value={value || '__default__'} onValueChange={(v) => onChange(v === '__default__' ? '' : v)}>
        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent className="max-h-60">
          <SelectItem value="__default__">默认（微软雅黑，支持中文）</SelectItem>
          {fonts.map((f) => (
            <SelectItem key={f.path} value={f.path}>
              {f.name}{f.cjk ? '' : '（不含中文，将回退）'}{f.builtin ? '' : '（自定义）'}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".ttf,.otf,.ttc"
          className="hidden"
          onChange={handleUpload}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
          上传字体
        </button>
        {value && !fonts.find(f => f.path === value)?.builtin && (
          <button
            onClick={() => handleDelete(fonts.find(f => f.path === value)?.name || '')}
            className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-400 hover:border-red-200 hover:text-red-500"
          >
            <Trash2 className="h-3 w-3" />删除
          </button>
        )}
        <span className="text-xs text-slate-400">支持 .ttf / .otf / .ttc</span>
      </div>
    </div>
  )
}
