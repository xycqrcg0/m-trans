import { useEffect, useState, useRef } from 'react'
import { KeyRound, Check, AlertCircle, Loader2, Type, Upload, Trash2, Pencil, X, Languages, Bot, Boxes, Download, Ban } from 'lucide-react'
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
  listModels,
  downloadModel,
  cancelModelDownload,
  subscribeModelProgress,
  type TranslatorConfigItem,
  type FontInfo,
  type CustomTranslatorPreset,
  type ModelDownloadState,
} from '@/lib/api'
import { useToast } from '@/components/ui/toast'

const _TRANSLATOR_TAGS: Record<string, { text: string; cls: string }[]> = {
  google: [{ text: '在线', cls: 'bg-blue-50 text-blue-600' }, { text: '免费', cls: 'bg-slate-100 text-slate-500' }],
  youdao: [{ text: '在线', cls: 'bg-blue-50 text-blue-600' }],
  baidu: [{ text: '在线', cls: 'bg-blue-50 text-blue-600' }],
  deepl: [{ text: '在线', cls: 'bg-blue-50 text-blue-600' }],
  papago: [{ text: '在线', cls: 'bg-blue-50 text-blue-600' }],
  caiyun: [{ text: '在线', cls: 'bg-blue-50 text-blue-600' }],
  chatgpt: [{ text: '在线', cls: 'bg-blue-50 text-blue-600' }, { text: '单阶段', cls: 'bg-slate-100 text-slate-500' }, { text: '纯文本', cls: 'bg-slate-100 text-slate-500' }],
  chatgpt_2stage: [{ text: '在线', cls: 'bg-blue-50 text-blue-600' }, { text: '两阶段', cls: 'bg-amber-50 text-amber-600' }, { text: '需视觉', cls: 'bg-purple-50 text-purple-600' }],
  none: [],
  original: [],
  sakura: [{ text: '本地', cls: 'bg-green-50 text-green-600' }, { text: '单阶段', cls: 'bg-slate-100 text-slate-500' }, { text: '纯文本', cls: 'bg-slate-100 text-slate-500' }],
  deepseek: [{ text: '在线', cls: 'bg-blue-50 text-blue-600' }, { text: '单阶段', cls: 'bg-slate-100 text-slate-500' }, { text: '纯文本', cls: 'bg-slate-100 text-slate-500' }],
  groq: [{ text: '在线', cls: 'bg-blue-50 text-blue-600' }, { text: '单阶段', cls: 'bg-slate-100 text-slate-500' }, { text: '纯文本', cls: 'bg-slate-100 text-slate-500' }],
  gemini: [{ text: '在线', cls: 'bg-blue-50 text-blue-600' }, { text: '单阶段', cls: 'bg-slate-100 text-slate-500' }, { text: '纯文本', cls: 'bg-slate-100 text-slate-500' }],
  gemini_2stage: [{ text: '在线', cls: 'bg-blue-50 text-blue-600' }, { text: '两阶段', cls: 'bg-amber-50 text-amber-600' }, { text: '需视觉', cls: 'bg-purple-50 text-purple-600' }],
  custom_openai: [{ text: '在线/本地', cls: 'bg-indigo-50 text-indigo-600' }, { text: '单阶段', cls: 'bg-slate-100 text-slate-500' }, { text: '纯文本', cls: 'bg-slate-100 text-slate-500' }],
  sugoi: [{ text: '离线', cls: 'bg-green-50 text-green-600' }, { text: '仅日→英', cls: 'bg-red-50 text-red-500' }],
  jparacrawl: [{ text: '离线', cls: 'bg-green-50 text-green-600' }, { text: '仅日↔英', cls: 'bg-red-50 text-red-500' }],
  jparacrawl_big: [{ text: '离线', cls: 'bg-green-50 text-green-600' }, { text: '仅日↔英', cls: 'bg-red-50 text-red-500' }],
}

// Descriptions shown on config cards explaining each translator's behavior.
const _TRANSLATOR_DESC: Record<string, string> = {
  google: '免费网页翻译，无需配置',
  youdao: '有道智云翻译',
  baidu: '百度翻译开放平台',
  deepl: 'DeepL 翻译，质量较高',
  papago: 'Naver Papago，适合韩语/日语',
  caiyun: '彩云小译',
  chatgpt: '单阶段：直接将 OCR 文本发给 LLM 翻译，不看图',
  chatgpt_2stage: '两阶段：第一阶段发送原图给视觉模型纠正 OCR 错误并按阅读顺序重排，第二阶段结合画面上下文翻译。更准但慢一倍、贵一倍',
  none: '不翻译，仅擦字',
  original: '保留原文，不做任何翻译',
  sakura: '本地 LLM 翻译（Sakura 模型），需本地部署推理服务',
  deepseek: '单阶段纯文本翻译，性价比高',
  groq: '单阶段纯文本翻译，推理速度极快',
  gemini: '单阶段：直接将 OCR 文本发给 Gemini 翻译，不看图',
  gemini_2stage: '两阶段：第一阶段发送原图给视觉模型纠正 OCR 错误并按阅读顺序重排，第二阶段结合画面上下文翻译',
  custom_openai: '单阶段纯文本翻译，连接任意 OpenAI 兼容 API（Ollama/vLLM 等）',
  sugoi: '离线翻译，仅支持日→英，首次使用需下载模型',
  jparacrawl: '离线翻译，仅支持日↔英，首次使用需下载模型',
  jparacrawl_big: '离线翻译（大模型），仅支持日↔英，首次使用需下载模型',
}

type Tab = 'translator' | 'llm' | 'font' | 'models'

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
          { id: 'models' as Tab, label: '模型', icon: Boxes },
        ]).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${tab === id
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
      {tab === 'models' && <ModelsTab />}
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
  const toast = useToast()
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
      toast.success('配置已保存')
    } catch {
      toast.error('保存配置失败')
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
      toast.success('预设已保存')
    } catch { toast.error('保存预设失败') }
    setSavingPreset(false)
  }

  async function handleDeletePreset(id: string) {
    try {
      await deleteCustomTranslator(id)
      await loadPresets()
      toast.success('预设已删除')
    } catch { toast.error('删除预设失败') }
  }

  if (loading) return <div className="text-center text-sm text-slate-400 py-8">加载中…</div>

  if (configs.length === 0 && category !== 'translator') return (
    <p className="text-sm text-slate-400 py-8 text-center">无需配置</p>
  )

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

      {configs.map((c) => (
        <div key={c.translator} className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-medium text-slate-900">{c.display_name || c.translator}</span>
              {_TRANSLATOR_TAGS[c.translator]?.map(tag => (
                <span key={tag.text} className={`rounded px-1 py-0 text-[10px] leading-tight ${tag.cls}`}>
                  {tag.text}
                </span>
              ))}
              {c.category === 'polish' && (
                <span className="rounded bg-purple-50 px-1.5 py-0.5 text-xs text-purple-600">润色</span>
              )}
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
          {_TRANSLATOR_DESC[c.translator] && (
            <p className="text-xs text-slate-400">{_TRANSLATOR_DESC[c.translator]}</p>
          )}
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
            disabled={saving === c.translator}
            className="rounded-md bg-slate-900 px-4 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {saving === c.translator ? (
              <span className="flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />保存中…</span>
            ) : '保存'}
          </button>
        </div>
      ))}

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
                    placeholder=""
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
                    <option value="custom_openai">Custom OpenAI（单阶段·纯文本）</option>
                    <option value="openai">OpenAI（两阶段·需视觉）</option>
                  </select>
                  <p className="text-xs text-slate-400">
                    {(editingPreset.engine ?? 'custom_openai') === 'openai'
                      ? '两阶段：第一阶段发送原图给视觉模型纠正 OCR 并重排阅读顺序，第二阶段结合画面翻译。更准但更慢更贵'
                      : '单阶段：直接将 OCR 文本发给 LLM 翻译，不看图。支持 Ollama/vLLM 等任意 OpenAI 兼容 API'}
                  </p>
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
                    placeholder="e.g.: https://api.openai.com/v1"
                    className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <label className="text-xs font-medium text-slate-500">模型名称</label>
                  <input
                    type="text"
                    value={editingPreset.model ?? ''}
                    onChange={(e) => setEditingPreset({ ...editingPreset, model: e.target.value })}
                    placeholder=""
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
              {presets.map((p) => {
                const isOpenaiEngine = p.engine === 'openai'
                return (
                  <div key={p.id} className="rounded-md border border-slate-100 px-3 py-2 space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                        <span className="truncate text-sm font-medium text-slate-700">{p.name}</span>
                        <span className={`shrink-0 rounded px-1 py-0 text-[10px] leading-tight ${isOpenaiEngine ? 'bg-purple-50 text-purple-600' : 'bg-slate-100 text-slate-500'}`}>
                          {isOpenaiEngine ? '需视觉' : '纯文本'}
                        </span>
                        <span className="shrink-0 rounded px-1 py-0 text-[10px] leading-tight bg-amber-50 text-amber-600">
                          {isOpenaiEngine ? '两阶段' : '单阶段'}
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
                    <p className="text-xs text-slate-400">
                      {isOpenaiEngine
                        ? '两阶段：先视觉纠错+重排，再结合画面翻译（走 ChatGPT 逻辑）'
                        : '单阶段纯文本翻译，连接任意 OpenAI 兼容 API（走 Custom OpenAI 逻辑）'}
                    </p>
                  </div>
                )
              })}
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
  const toast = useToast()

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
    try {
      await uploadFont(file)
      await loadFonts()
      toast.success('字体上传成功')
    } catch { toast.error('字体上传失败') }
    setUploading(false)
    if (e.target) e.target.value = ''
  }

  async function handleDeleteFont(name: string) {
    try {
      await deleteFont(name)
      await loadFonts()
    } catch { toast.error('删除字体失败') }
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
    } catch { toast.error('保存备注失败') }
    setSavingNote(false)
    setEditingNote(null)
  }

  if (loading) return <div className="text-center text-sm text-slate-400 py-8">加载中…</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
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

// ── Model download management tab ───────────────────────────────────────────

const _MODEL_CATEGORY_LABELS: Record<string, string> = {
  detector: '文字检测',
  ocr: '文字识别 (OCR)',
  inpainter: '图像修复',
}

function ModelsTab() {
  const [models, setModels] = useState<ModelDownloadState[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const esRef = useRef<EventSource | null>(null)
  const toast = useToast()

  async function loadModels() {
    try {
      const res = await listModels()
      setModels(res.models)
    } catch { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => {
    loadModels()
    // Subscribe to live progress updates.
    esRef.current = subscribeModelProgress((updated) => {
      setModels(updated)
      // Clear busy state when a download finishes or errors for that model.
      setBusy((prev) => {
        if (!prev) return prev
        const m = updated.find((x) => `${x.category}/${x.id}` === prev)
        if (m && (m.status === 'done' || m.status === 'error' || m.status === 'idle')) {
          if (m.status === 'done') toast.success(`${m.display_name} 下载完成`)
          if (m.status === 'error') toast.error(`${m.display_name} 下载失败`)
          return null
        }
        return prev
      })
    })
    return () => { esRef.current?.close() }
  }, [])

  async function handleDownload(m: ModelDownloadState) {
    setBusy(`${m.category}/${m.id}`)
    try {
      await downloadModel(m.category, m.id)
      // The SSE stream will update progress; optimistic status refresh.
      await loadModels()
    } catch {
      toast.error(`触发 ${m.display_name} 下载失败`)
      setBusy(null)
    }
  }

  async function handleCancel(m: ModelDownloadState) {
    setBusy(`${m.category}/${m.id}`)
    try {
      await cancelModelDownload(m.category, m.id)
      toast.info(`已取消 ${m.display_name} 下载`)
    } catch {
      toast.error(`取消失败`)
    } finally {
      setBusy(null)
      await loadModels()
    }
  }

  if (loading) return <div className="text-center text-sm text-slate-400 py-8">加载中…</div>

  // Group by category preserving order.
  const grouped: Record<string, ModelDownloadState[]> = {}
  for (const m of models) {
    ;(grouped[m.category] ??= []).push(m)
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-700">
        模型文件较大（数十 MB ~ 数 GB），首次使用需下载。下载会缓存到程序目录下的 <code className="font-mono">models/</code>，可手动删除后重新下载。
      </div>
      {Object.entries(grouped).map(([cat, items]) => (
        <div key={cat} className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-700">{_MODEL_CATEGORY_LABELS[cat] ?? cat}</h3>
          <div className="space-y-2">
            {items.map((m) => {
              const key = `${m.category}/${m.id}`
              const isBusy = busy === key || m.status === 'downloading' || m.status === 'queued'
              const pct = Math.round((m.progress ?? 0) * 100)
              return (
                <div key={key} className="rounded-lg border border-slate-200 bg-white p-3 space-y-2 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-slate-900">{m.display_name}</span>
                        {m.status === 'done' && (
                          <span className="shrink-0 rounded bg-green-50 px-1.5 py-0.5 text-xs text-green-600">已下载</span>
                        )}
                        {m.status === 'downloading' && (
                          <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-600">下载中 {pct}%</span>
                        )}
                        {m.status === 'queued' && (
                          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">排队中</span>
                        )}
                        {m.status === 'error' && (
                          <span className="shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-500">失败</span>
                        )}
                      </div>
                      {m.error && (
                        <p className="mt-1 text-xs text-red-500 truncate" title={m.error}>{m.error}</p>
                      )}
                      {m.path && (
                        <p className="mt-0.5 text-xs text-slate-400 truncate" title={m.path}>路径: {m.path}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {m.status === 'downloading' || m.status === 'queued' ? (
                        <button
                          onClick={() => handleCancel(m)}
                          disabled={busy === key}
                          className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:border-red-200 hover:text-red-500 disabled:opacity-50"
                        >
                          <Ban className="h-3 w-3" />取消
                        </button>
                      ) : m.status === 'done' ? (
                        <button
                          onClick={() => handleDownload(m)}
                          className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
                        >
                          <Download className="h-3 w-3" />重新下载
                        </button>
                      ) : (
                        <button
                          onClick={() => handleDownload(m)}
                          disabled={isBusy}
                          className="flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1 text-xs text-white hover:bg-indigo-700 disabled:opacity-50"
                        >
                          {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                          下载
                        </button>
                      )}
                    </div>
                  </div>
                  {(m.status === 'downloading' || m.status === 'queued') && (
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-indigo-500 transition-all duration-500"
                        style={{ width: `${Math.max(2, pct)}%` }}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
