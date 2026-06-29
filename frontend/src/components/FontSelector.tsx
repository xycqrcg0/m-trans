import { useEffect, useState, useRef } from 'react'
import { Upload, Trash2, Loader2, Pencil, Check, X } from 'lucide-react'
import { listFonts, uploadFont, deleteFont, updateFontNote, type FontInfo } from '@/lib/api'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface FontSelectorProps {
  value: string
  onChange: (path: string) => void
}

export function FontSelector({ value, onChange }: FontSelectorProps) {
  const [fonts, setFonts] = useState<FontInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [editingNote, setEditingNote] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const [savingNote, setSavingNote] = useState(false)
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
      const deleted = fonts.find(f => f.name === name)
      if (deleted && value === deleted.path) onChange('')
      await load()
    } catch { /* ignore */ }
  }

  const selectedFont = fonts.find(f => f.path === value)

  async function handleSaveNote() {
    if (!selectedFont) return
    setSavingNote(true)
    try {
      await updateFontNote(selectedFont.name, noteDraft)
      await load()
    } catch { /* ignore */ }
    setSavingNote(false)
    setEditingNote(false)
  }

  function startEditNote() {
    setNoteDraft(selectedFont?.note ?? '')
    setEditingNote(true)
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
              {f.name}{f.cjk ? '' : '（不含中文，将回退）'}{f.builtin ? '' : '（自定义）'}{f.note ? ` — ${f.note}` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Note display / edit for selected font */}
      {selectedFont && (
        <div className="flex items-center gap-1.5">
          {editingNote ? (
            <>
              <input
                type="text"
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveNote(); if (e.key === 'Escape') setEditingNote(false) }}
                placeholder="给这个字体加个备注…"
                autoFocus
                className="flex-1 rounded-md border border-slate-200 px-2 py-1 text-xs"
              />
              <button onClick={handleSaveNote} disabled={savingNote} className="rounded p-1 text-green-600 hover:bg-green-50 disabled:opacity-50">
                {savingNote ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              </button>
              <button onClick={() => setEditingNote(false)} className="rounded p-1 text-slate-400 hover:bg-slate-50">
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <>
              <span className={`text-xs ${selectedFont.note ? 'text-slate-500' : 'text-slate-300'}`}>
                {selectedFont.note || '无备注'}
              </span>
              <button onClick={startEditNote} className="rounded p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-600">
                <Pencil className="h-3 w-3" />
              </button>
            </>
          )}
        </div>
      )}

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
        {value && !selectedFont?.builtin && (
          <button
            onClick={() => handleDelete(selectedFont?.name || '')}
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
