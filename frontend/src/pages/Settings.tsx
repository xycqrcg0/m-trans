import { useEffect, useState } from 'react'
import { KeyRound, Check, AlertCircle, Loader2, Type, Upload, Trash2, Pencil, X } from 'lucide-react'
import {
  getTranslatorConfigs,
  saveTranslatorConfig,
  listFonts,
  uploadFont,
  deleteFont,
  updateFontNote,
  type TranslatorConfigItem,
  type FontInfo,
} from '@/lib/api'

export default function Settings() {
  const [configs, setConfigs] = useState<TranslatorConfigItem[]>([])
  const [loading, setLoading] = useState(true)
  const [editValues, setEditValues] = useState<Record<string, Record<string, string>>>({})
  const [saving, setSaving] = useState<string | null>(null)

  const [fonts, setFonts] = useState<FontInfo[]>([])
  const [fontsLoading, setFontsLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [editingNote, setEditingNote] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const fileRef = useState<HTMLDivElement | null>(null)

  async function load() {
    setLoading(true)
    try {
      const data = await getTranslatorConfigs()
      setConfigs(data)
      const edits: Record<string, Record<string, string>> = {}
      data.forEach((c) => { edits[c.translator] = {} })
      setEditValues(edits)
    } finally {
      setLoading(false)
    }
  }

  async function loadFonts() {
    setFontsLoading(true)
    try {
      const res = await listFonts()
      setFonts(res.fonts)
    } catch { /* ignore */ }
    setFontsLoading(false)
  }

  useEffect(() => { load(); loadFonts() }, [])

  async function handleSave(translator: string) {
    setSaving(translator)
    try {
      const values = editValues[translator] || {}
      await saveTranslatorConfig({ translator, values })
      await load()
    } finally {
      setSaving(null)
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      await uploadFont(file)
      await loadFonts()
    } catch { /* ignore */ }
    setUploading(false)
    if (e.target) e.target.value = ''
  }

  async function handleDeleteFont(name: string) {
    try {
      await deleteFont(name)
      await loadFonts()
    } catch { /* ignore */ }
  }

  function startEditNote(font: FontInfo) {
    setEditingNote(font.name)
    setNoteDraft(font.note ?? '')
  }

  async function handleSaveNote(name: string) {
    setSavingNote(true)
    try {
      await updateFontNote(name, noteDraft)
      await loadFonts()
    } catch { /* ignore */ }
    setSavingNote(false)
    setEditingNote(null)
  }

  if (loading) return <div className="p-6 text-center text-sm text-slate-400">加载中…</div>

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="flex items-center gap-2">
        <KeyRound className="h-5 w-5 text-slate-700" />
        <h1 className="text-2xl font-bold text-slate-900">配置</h1>
      </div>

      {/* 翻译器配置 */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
          <KeyRound className="h-4 w-4 text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-700">翻译器配置</h2>
        </div>
        <p className="text-sm text-slate-500 -mt-2">
          需要配置的翻译引擎在此填写。Google、Sakura、Sugoi、JParaCrawl 等无需配置。
        </p>

        <div className="space-y-4">
          {configs.map((c) => {
            const isSaving = saving === c.translator
            return (
              <div key={c.translator} className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium text-slate-900">{c.display_name || c.translator}</span>
                    <span className="ml-2 text-xs text-slate-400">{c.translator}</span>
                  </div>
                  {c.configured ? (
                    <span className="flex items-center gap-1 text-xs text-green-600">
                      <Check className="h-3 w-3" />已配置
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-amber-500">
                      <AlertCircle className="h-3 w-3" />未配置
                    </span>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {c.fields.map((f) => (
                    <div key={f.env_var} className="space-y-1">
                      <label className="text-xs font-medium text-slate-500">
                        {f.label}
                        {f.required && <span className="text-red-400"> *</span>}
                        {!f.required && <span className="text-slate-300">（可选）</span>}
                      </label>
                      <input
                        type={f.field_type === 'password' ? 'password' : 'text'}
                        placeholder={f.value || `输入${f.label}`}
                        value={editValues[c.translator]?.[f.env_var] ?? ''}
                        onChange={(e) => setEditValues({
                          ...editValues,
                          [c.translator]: {
                            ...editValues[c.translator],
                            [f.env_var]: e.target.value,
                          },
                        })}
                        className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-sm focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300"
                      />
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => handleSave(c.translator)}
                  disabled={isSaving}
                  className="rounded-md bg-slate-900 px-4 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  {isSaving ? (
                    <span className="flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />保存中…</span>
                  ) : '保存'}
                </button>
              </div>
            )
          })}
        </div>
      </section>

      {/* 字体管理 */}
      <section className="space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <div className="flex items-center gap-2">
            <Type className="h-4 w-4 text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-700">字体管理</h2>
          </div>
          <div>
            <input
              ref={fileRef as unknown as React.RefObject<HTMLInputElement>}
              type="file"
              accept=".ttf,.otf,.ttc"
              className="hidden"
              onChange={handleUpload}
            />
            <button
              onClick={() => (fileRef as unknown as React.RefObject<HTMLInputElement>).current?.click()}
              disabled={uploading}
              className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
              上传字体
            </button>
          </div>
        </div>
        <p className="text-sm text-slate-500 -mt-2">
          上传、删除字体文件，或为字体添加备注。上传的字体可在新建任务时选择，也可在嵌字前编辑中切换并预览效果。
        </p>

        {fontsLoading ? (
          <p className="text-sm text-slate-400 py-4 text-center">加载字体…</p>
        ) : (
          <div className="space-y-2">
            {fonts.map((f) => (
              <div key={f.path} className="rounded-lg border border-slate-200 bg-white p-3 space-y-2 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Type className="h-4 w-4 text-slate-400 shrink-0" />
                      <span className="truncate text-sm font-medium text-slate-900">{f.name}</span>
                      {f.builtin ? (
                        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">内置</span>
                      ) : (
                        <span className="shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-600">自定义</span>
                      )}
                      {!f.cjk && (
                        <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-600">不含中文</span>
                      )}
                    </div>
                  </div>
                  {!f.builtin && (
                    <button
                      onClick={() => handleDeleteFont(f.name)}
                      className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-400 hover:border-red-200 hover:text-red-500 shrink-0"
                    >
                      <Trash2 className="h-3 w-3" />删除
                    </button>
                  )}
                </div>

                {/* 备注 */}
                <div className="flex items-center gap-1.5 pl-6">
                  {editingNote === f.name ? (
                    <>
                      <input
                        type="text"
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveNote(f.name)
                          if (e.key === 'Escape') setEditingNote(null)
                        }}
                        placeholder="给这个字体加个备注…"
                        autoFocus
                        className="flex-1 rounded-md border border-slate-200 px-2 py-1 text-xs"
                      />
                      <button
                        onClick={() => handleSaveNote(f.name)}
                        disabled={savingNote}
                        className="rounded p-1 text-green-600 hover:bg-green-50 disabled:opacity-50"
                      >
                        {savingNote ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        onClick={() => setEditingNote(null)}
                        className="rounded p-1 text-slate-400 hover:bg-slate-50"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className={`text-xs ${f.note ? 'text-slate-500' : 'text-slate-300'}`}>
                        {f.note || '无备注'}
                      </span>
                      <button
                        onClick={() => startEditNote(f)}
                        className="rounded p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
