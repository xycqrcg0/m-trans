import { useEffect, useState } from 'react'
import { KeyRound, Check, AlertCircle, Loader2, Type, Upload, Trash2, Pencil, X, Languages, Bot } from 'lucide-react'
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

type Tab = 'translator' | 'llm' | 'font'

export default function Settings() {
  const [tab, setTab] = useState<Tab>('translator')

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="flex items-center gap-2">
        <KeyRound className="h-5 w-5 text-slate-700" />
        <h1 className="text-2xl font-bold text-slate-900">配置</h1>
      </div>

      {/* Sub-page tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {([
          { id: 'translator' as Tab, label: '翻译器', icon: Languages },
          { id: 'llm' as Tab, label: 'LLM', icon: Bot },
          { id: 'font' as Tab, label: '字体', icon: Type },
        ]).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === id
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </div>

      {tab === 'translator' && <TranslatorTab category="translator" />}
      {tab === 'llm' && <TranslatorTab category="llm" />}
      {tab === 'font' && <FontTab />}
    </div>
  )
}

// ── Translator / LLM config tab ──────────────────────────────────────────────

function TranslatorTab({ category }: { category: 'translator' | 'llm' }) {
  const [configs, setConfigs] = useState<TranslatorConfigItem[]>([])
  const [loading, setLoading] = useState(true)
  const [editValues, setEditValues] = useState<Record<string, Record<string, string>>>({})
  const [saving, setSaving] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const data = await getTranslatorConfigs()
      const filtered = data.filter(c => category === 'llm' ? c.category === 'polish' : c.category !== 'polish')
      setConfigs(filtered)
      const edits: Record<string, Record<string, string>> = {}
      filtered.forEach((c) => { edits[c.translator] = {} })
      setEditValues(edits)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [category])

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

  if (loading) return <div className="text-center text-sm text-slate-400 py-8">加载中…</div>

  if (configs.length === 0) return (
    <p className="text-sm text-slate-400 py-8 text-center">无需配置</p>
  )

  // Group configs that share the same required env_var (e.g. ChatGPT + ChatGPT
  // 2-stage share OPENAI_API_KEY; Gemini + Gemini 2-stage share GEMINI_API_KEY).
  // Each group renders as one card with shared fields + per-engine extra fields.
  function getConfigGroup(c: TranslatorConfigItem): string {
    const requiredKeys = c.fields.filter(f => f.required).map(f => f.env_var).sort().join(',')
    return requiredKeys || c.translator
  }
  const groupKeys: string[] = []
  const groupMap: Record<string, TranslatorConfigItem[]> = {}
  for (const c of configs) {
    const gk = getConfigGroup(c)
    if (!groupMap[gk]) { groupMap[gk] = []; groupKeys.push(gk) }
    groupMap[gk].push(c)
  }

  return (
    <div className="space-y-4">
      {category === 'llm' && (
        <p className="text-sm text-slate-500">
          LLM 润色模型配置（支持任意 OpenAI 兼容 API）。填好 Key 和 Base URL 即可使用。
        </p>
      )}
      {category === 'translator' && (
        <p className="text-sm text-slate-500">
          翻译引擎的 API 配置，包括传统引擎和 LLM 引擎。Google、Sakura、Sugoi、JParaCrawl 等无需配置。
        </p>
      )}

      {groupKeys.map((gk) => {
        const group = groupMap[gk]
        const isMulti = group.length > 1
        // Shared fields = fields with the same env_var across all configs in group
        const sharedEnvVars = new Set(
          group[0].fields.filter(f =>
            group.every(c => c.fields.some(cf => cf.env_var === f.env_var))
          ).map(f => f.env_var)
        )
        const sharedFields = group[0].fields.filter(f => sharedEnvVars.has(f.env_var))
        // Extra fields per engine (only for multi-engine groups)
        const extraByEngine = isMulti ? group.map(c => ({
          translator: c.translator,
          display_name: c.display_name,
          fields: c.fields.filter(f => !sharedEnvVars.has(f.env_var)),
        })).filter(e => e.fields.length > 0) : []

        // Use the first translator's save handler for shared fields;
        // per-engine extra fields save to their own translator.
        const allConfigured = group.every(c => c.configured)

        return (
          <div key={gk} className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 flex-wrap">
                {group.map((c, i) => (
                  <span key={c.translator} className="font-medium text-slate-900">
                    {i > 0 && <span className="text-slate-300 mx-1">+</span>}
                    {c.display_name || c.translator}
                  </span>
                ))}
                {group[0].category === 'polish' && (
                  <span className="rounded bg-purple-50 px-1.5 py-0.5 text-xs text-purple-600">润色</span>
                )}
              </div>
              {allConfigured ? (
                <span className="flex items-center gap-1 text-xs text-green-600">
                  <Check className="h-3 w-3" />已配置
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-amber-500">
                  <AlertCircle className="h-3 w-3" />未配置
                </span>
              )}
            </div>

            {/* Shared fields */}
            <div className="grid gap-3 sm:grid-cols-2">
              {sharedFields.map((f) => (
                <div key={f.env_var} className="space-y-1">
                  <label className="text-xs font-medium text-slate-500">
                    {f.label}
                    {f.required && <span className="text-red-400"> *</span>}
                    {!f.required && <span className="text-slate-300">（可选）</span>}
                  </label>
                  <input
                    type={f.field_type === 'password' ? 'password' : 'text'}
                    placeholder={f.value || `输入${f.label}`}
                    value={editValues[group[0].translator]?.[f.env_var] ?? ''}
                    onChange={(e) => {
                      // Update shared field on all translators in the group
                      const newVal = e.target.value
                      setEditValues(prev => {
                        const next = { ...prev }
                        for (const c of group) {
                          next[c.translator] = { ...next[c.translator], [f.env_var]: newVal }
                        }
                        return next
                      })
                    }}
                    className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-sm focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300"
                  />
                </div>
              ))}
            </div>

            {/* Per-engine extra fields (e.g. 2-stage stage1/stage2 model) */}
            {extraByEngine.map((e) => (
              <div key={e.translator} className="space-y-2 rounded-md bg-slate-50 p-3">
                <span className="text-xs font-medium text-slate-500">{e.display_name} 专有配置</span>
                <div className="grid gap-3 sm:grid-cols-2">
                  {e.fields.map((f) => (
                    <div key={f.env_var} className="space-y-1">
                      <label className="text-xs font-medium text-slate-500">
                        {f.label}
                        {f.required && <span className="text-red-400"> *</span>}
                        {!f.required && <span className="text-slate-300">（可选）</span>}
                      </label>
                      <input
                        type={f.field_type === 'password' ? 'password' : 'text'}
                        placeholder={f.value || `输入${f.label}`}
                        value={editValues[e.translator]?.[f.env_var] ?? ''}
                        onChange={(e2) => setEditValues({
                          ...editValues,
                          [e.translator]: {
                            ...editValues[e.translator],
                            [f.env_var]: e2.target.value,
                          },
                        })}
                        className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-sm focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* Save buttons: one per translator in the group */}
            <div className="flex items-center gap-2">
              {group.map((c) => {
                const isSaving = saving === c.translator
                return (
                  <button
                    key={c.translator}
                    onClick={() => handleSave(c.translator)}
                    disabled={isSaving}
                    className="rounded-md bg-slate-900 px-4 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
                  >
                    {isSaving ? (
                      <span className="flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />保存中…</span>
                    ) : isMulti ? `保存 ${c.display_name}` : '保存'}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Font management tab ──────────────────────────────────────────────────────

function FontTab() {
  const [fonts, setFonts] = useState<FontInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [editingNote, setEditingNote] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const fileRef = useState<HTMLInputElement | null>(null)

  async function loadFonts() {
    setLoading(true)
    try {
      const res = await listFonts()
      setFonts(res.fonts)
    } catch { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => { loadFonts() }, [])

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

  if (loading) return <div className="text-center text-sm text-slate-400 py-8">加载中…</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          上传、删除字体文件，或为字体添加备注。上传的字体可在新建任务时选择，也可在嵌字前编辑中切换并预览效果。
        </p>
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
    </div>
  )
}
