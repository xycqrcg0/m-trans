import { useEffect, useState } from 'react'
import { KeyRound, Check, AlertCircle, Loader2, Type, Upload, Trash2, Pencil, X, Languages, Bot } from 'lucide-react'
import {
  getTranslatorConfigs,
  saveTranslatorConfig,
  listCustomTranslators,
  saveCustomTranslator,
  deleteCustomTranslator,
  listFonts,
  uploadFont,
  deleteFont,
  updateFontNote,
  type TranslatorConfigItem,
  type FontInfo,
  type CustomTranslatorPreset,
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
  const [presets, setPresets] = useState<CustomTranslatorPreset[]>([])
  const [editingPreset, setEditingPreset] = useState<Partial<CustomTranslatorPreset> | null>(null)
  const [savingPreset, setSavingPreset] = useState(false)

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

  async function loadPresets() {
    try {
      const res = await listCustomTranslators()
      setPresets(res.items)
    } catch { /* ignore */ }
  }

  useEffect(() => { load(); loadPresets() }, [category])

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

  async function handleSavePreset() {
    if (!editingPreset) return
    setSavingPreset(true)
    try {
      await saveCustomTranslator(editingPreset)
      setEditingPreset(null)
      await loadPresets()
    } catch { /* ignore */ }
    setSavingPreset(false)
  }

  async function handleDeletePreset(id: string) {
    try {
      await deleteCustomTranslator(id)
      await loadPresets()
    } catch { /* ignore */ }
  }

  if (loading) return <div className="text-center text-sm text-slate-400 py-8">加载中…</div>

  if (configs.length === 0 && category !== 'translator') return (
    <p className="text-sm text-slate-400 py-8 text-center">无需配置</p>
  )

  // Group configs that share the same required env_var, but render each
  // config's fields independently (no shared input boxes).
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

            {/* Each config's fields rendered independently (no shared inputs) */}
            <div className={isMulti ? 'space-y-3' : ''}>
              {group.map((c) => (
                <div key={c.translator} className={isMulti ? 'rounded-md bg-slate-50 p-3 space-y-2' : 'space-y-2'}>
                  {isMulti && (
                    <span className="text-xs font-medium text-slate-500">{c.display_name}</span>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    {c.fields.map((f) => (
                      <div key={f.env_var} className="space-y-1">
                        <label className="text-xs font-medium text-slate-500">
                          {f.label}
                          {f.required && <span className="text-red-400"> *</span>}
                          {!f.required && <span className="text-slate-300">（可选）</span>}
                        </label>
                        {f.description && (
                          <p className="text-xs text-slate-400">{f.description}</p>
                        )}
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
                    disabled={saving === c.translator}
                    className="rounded-md bg-slate-900 px-4 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
                  >
                    {saving === c.translator ? (
                      <span className="flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />保存中…</span>
                    ) : '保存'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {/* Custom OpenAI presets — only on translator tab */}
      {category === 'translator' && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-slate-500" />
              <span className="font-medium text-slate-900">自定义翻译器配置</span>
            </div>
            <button
              onClick={() => setEditingPreset({ name: '', engine: 'custom_openai', api_key: '', api_base: '', model: '' })}
              className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              + 新建
            </button>
          </div>
          <p className="text-xs text-slate-400">
            创建命名的翻译器配置，可选择使用 OpenAI（视觉翻译）或 Custom OpenAI（纯文本翻译）逻辑。创建后可在新建任务时选择。
          </p>

          {editingPreset && (
            <div className="rounded-md bg-slate-50 p-3 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-500">名称</label>
                  <input
                    type="text"
                    value={editingPreset.name ?? ''}
                    onChange={(e) => setEditingPreset({ ...editingPreset, name: e.target.value })}
                    placeholder="如：我的 GPT-4o"
                    className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-500">翻译逻辑</label>
                  <select
                    value={editingPreset.engine ?? 'custom_openai'}
                    onChange={(e) => setEditingPreset({ ...editingPreset, engine: e.target.value as 'openai' | 'custom_openai' })}
                    className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                  >
                    <option value="custom_openai">Custom OpenAI（纯文本，支持任意兼容 API）</option>
                    <option value="openai">OpenAI（视觉翻译，含画面上下文）</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-500">API Key</label>
                  <input
                    type="password"
                    value={editingPreset.api_key ?? ''}
                    onChange={(e) => setEditingPreset({ ...editingPreset, api_key: e.target.value })}
                    placeholder="留空则保留原值"
                    className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-500">API Base URL</label>
                  <input
                    type="text"
                    value={editingPreset.api_base ?? ''}
                    onChange={(e) => setEditingPreset({ ...editingPreset, api_base: e.target.value })}
                    placeholder="https://api.openai.com/v1"
                    className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <label className="text-xs font-medium text-slate-500">模型名称</label>
                  <input
                    type="text"
                    value={editingPreset.model ?? ''}
                    onChange={(e) => setEditingPreset({ ...editingPreset, model: e.target.value })}
                    placeholder="如：gpt-4o、qwen2.5:14b"
                    className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSavePreset}
                  disabled={savingPreset}
                  className="rounded-md bg-slate-900 px-4 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  {savingPreset ? <Loader2 className="h-3 w-3 animate-spin" /> : '保存配置'}
                </button>
                <button
                  onClick={() => setEditingPreset(null)}
                  className="rounded-md border border-slate-200 px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                >
                  取消
                </button>
              </div>
            </div>
          )}

          {presets.length > 0 && (
            <div className="space-y-2">
              {presets.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-md border border-slate-100 px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="truncate text-sm font-medium text-slate-700">{p.name}</span>
                    <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                      {p.engine === 'openai' ? 'OpenAI 视觉' : 'Custom OpenAI'}
                    </span>
                    {p.model && <span className="truncate text-xs text-slate-400">{p.model}</span>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setEditingPreset({ ...p, api_key: '' })}
                      className="rounded p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => handleDeletePreset(p.id)}
                      className="rounded p-1 text-slate-400 hover:text-red-500"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
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
