import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, ChevronDown, ChevronUp, Info } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  type GlossaryMeta, type OptionItem, type TaskConfig, type TranslatorOption,
  getOptions, listGlossaries,
} from '@/lib/api'
import { FontSelector } from '@/components/FontSelector'

interface ConfigPanelProps {
  config: Partial<TaskConfig>
  onChange: (config: Partial<TaskConfig>) => void
}

const FALLBACK_LANGS: OptionItem[] = [
  { id: 'CHS', name: '简体中文' }, { id: 'CHT', name: '繁体中文' },
  { id: 'ENG', name: '英语' }, { id: 'JPN', name: '日语' }, { id: 'KOR', name: '韩语' },
]
const FALLBACK_TRANSLATORS: TranslatorOption[] = [
  { id: 'google', name: 'Google', requires_key: false, configured: true, supported_langs: null },
  { id: 'youdao', name: 'Youdao', requires_key: true, configured: false, supported_langs: null },
  { id: 'deepl', name: 'DeepL', requires_key: true, configured: false, supported_langs: null },
  { id: 'chatgpt', name: 'ChatGPT', requires_key: true, configured: false, supported_langs: null },
  { id: 'deepseek', name: 'DeepSeek', requires_key: true, configured: false, supported_langs: null },
  { id: 'gemini', name: 'Gemini', requires_key: true, configured: false, supported_langs: null },
  { id: 'groq', name: 'Groq', requires_key: true, configured: false, supported_langs: null },
  { id: 'sakura', name: 'Sakura', requires_key: false, configured: true, supported_langs: null },
  { id: 'custom_openai', name: 'Custom OpenAI', requires_key: true, configured: false, supported_langs: null },
  { id: 'original', name: '原文', requires_key: false, configured: true, supported_langs: null },
  { id: 'none', name: '不翻译', requires_key: false, configured: true, supported_langs: null },
]
const FALLBACK_DETECTORS: OptionItem[] = [
  { id: 'default', name: 'Default' }, { id: 'ctd', name: 'CTD' },
]
const FALLBACK_OCR: OptionItem[] = [
  { id: 'ocr48px', name: 'OCR 48px' }, { id: 'ocr32px', name: 'OCR 32px' },
]
const FALLBACK_INPAINTERS: OptionItem[] = [
  { id: 'lama_large', name: 'LaMa Large' }, { id: 'none', name: '不擦字' },
]
// Translators that are already LLM-based — polish would be redundant.
const LLM_TRANSLATORS = new Set([
  'chatgpt', 'chatgpt_2stage', 'deepseek', 'groq', 'gemini',
  'gemini_2stage', 'custom_openai', 'sakura',
])

// Short descriptions shown under the translator selector
const _TRANSLATOR_DESC: Record<string, string> = {
  google: '免费网页翻译，无需配置，质量一般',
  youdao: '有道智云翻译，需要应用 ID 和密钥',
  baidu: '百度翻译开放平台，需要 APP ID 和密钥',
  deepl: 'DeepL 翻译，翻译质量较高，需要 Auth Key',
  papago: 'Naver Papago 翻译，适合韩语/日语',
  caiyun: '彩云小译，需要访问令牌',
  chatgpt: 'OpenAI GPT 翻译，质量高，需要 API Key',
  chatgpt_2stage: 'ChatGPT 两阶段翻译（先初翻再校对），质量更高但更慢',
  none: '不翻译，仅擦字',
  original: '保留原文，不做任何翻译',
  sakura: '本地 LLM 翻译（Sakura 模型），需要本地部署推理服务',
  deepseek: 'DeepSeek API 翻译，性价比高',
  groq: 'Groq API 翻译，推理速度极快',
  gemini: 'Google Gemini 翻译',
  gemini_2stage: 'Gemini 两阶段翻译',
  custom_openai: '自定义 OpenAI 兼容 API（如 Ollama、vLLM 等）',
  sugoi: '离线翻译（Sugoi V4.0 模型），仅支持日→英，首次使用需下载模型',
  jparacrawl: '离线翻译（JParaCrawl 基础模型），仅支持日↔英，首次使用需下载模型',
  jparacrawl_big: '离线翻译（JParaCrawl 大模型），仅支持日↔英，首次使用需下载模型',
}

export function ConfigPanel({ config, onChange }: ConfigPanelProps) {
  const [langs, setLangs] = useState<OptionItem[]>(FALLBACK_LANGS)
  const [translators, setTranslators] = useState<TranslatorOption[]>(FALLBACK_TRANSLATORS)
  const [detectors, setDetectors] = useState<OptionItem[]>(FALLBACK_DETECTORS)
  const [ocrList, setOcrList] = useState<OptionItem[]>(FALLBACK_OCR)
  const [inpainters, setInpainters] = useState<OptionItem[]>(FALLBACK_INPAINTERS)
  const [glossaries, setGlossaries] = useState<GlossaryMeta[]>([])
  const [showAdvanced, setShowAdvanced] = useState(false)

  useEffect(() => {
    getOptions().then((o) => {
      if (o.languages?.length) setLangs(o.languages)
      if (o.translators?.length) setTranslators(o.translators)
      if (o.detectors?.length) setDetectors(o.detectors)
      if (o.ocr?.length) setOcrList(o.ocr)
      if (o.inpainters?.length) setInpainters(o.inpainters)
    }).catch(() => {})
    listGlossaries().then(setGlossaries).catch(() => {})
  }, [])

  const isEraseOnly = config.render_translated_text === false
  const isLLMTranslator = !!config.translator && LLM_TRANSLATORS.has(config.translator)
  const selectedTranslator = translators.find((t) => t.id === config.translator)
  const langUnsupported = !!selectedTranslator?.supported_langs &&
    !!config.target_lang && !selectedTranslator.supported_langs.includes(config.target_lang)

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* 模式选择 */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onChange({ ...config, render_translated_text: true, translator: config.translator || 'google' })}
            className={`flex-1 rounded-md border px-3 py-2 text-sm transition-colors ${
              !isEraseOnly ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            翻译嵌字
          </button>
          <button
            type="button"
            onClick={() => onChange({ ...config, render_translated_text: false, translator: 'none' })}
            className={`flex-1 rounded-md border px-3 py-2 text-sm transition-colors ${
              isEraseOnly ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            仅擦字
          </button>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">目标语言</label>
            <Select value={config.target_lang ?? 'CHS'} onValueChange={(v) => onChange({ ...config, target_lang: v })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-60 overflow-y-auto">
                {langs.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {!isEraseOnly && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">翻译引擎</label>
              <Select value={config.translator ?? 'google'} onValueChange={(v) => onChange({ ...config, translator: v })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-60 overflow-y-auto">
                  {translators.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}{t.requires_key && !t.configured ? ' ⚠️' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedTranslator && (
                <p className="text-xs text-slate-400">{_TRANSLATOR_DESC[selectedTranslator.id] ?? ''}</p>
              )}
              {selectedTranslator?.requires_key && !selectedTranslator?.configured && (
                <div className="flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-700">
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  <span>该翻译引擎需要配置，</span>
                  <Link to="/settings" className="underline">去配置</Link>
                </div>
              )}
              {langUnsupported && (
                <div className="flex items-center gap-1.5 rounded-md bg-red-50 px-2 py-1 text-xs text-red-600">
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  <span>
                    不支持「{config.target_lang}」，仅支持：{selectedTranslator?.supported_langs?.join('、')}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {!isEraseOnly && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className={`flex items-center gap-2 ${isLLMTranslator ? 'opacity-50' : ''}`}>
              <Switch
                id="polish"
                checked={config.polish ?? false}
                disabled={isLLMTranslator}
                onCheckedChange={(v) => onChange({ ...config, polish: v })}
              />
              <label htmlFor="polish" className="flex items-center gap-1 text-sm font-medium cursor-pointer">
                LLM 润色
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-slate-400" />
                  </TooltipTrigger>
                  <TooltipContent>
                    {isLLMTranslator
                      ? '当前翻译引擎已是 LLM，润色会重复且可能冲突，已自动跳过'
                      : '使用 Claude 将译文改写为二次元语境风格'}
                  </TooltipContent>
                </Tooltip>
              </label>
              {isLLMTranslator && (
                <span className="text-xs text-slate-400">LLM 引擎无需润色</span>
              )}
            </div>

            {glossaries.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">术语表</label>
                <Select
                  value={config.glossary_id ?? '__none__'}
                  onValueChange={(v) => onChange({ ...config, glossary_id: v === '__none__' ? null : v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">不使用术语表</SelectItem>
                    {glossaries.map((g) => (
                      <SelectItem key={g.id} value={g.id}>{g.name}（{g.entry_count} 词）</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}

        {!isEraseOnly && (
          <div className="flex items-center gap-2">
            <Switch
              id="interactive_edit"
              checked={config.interactive_edit ?? false}
              onCheckedChange={(v) => onChange({ ...config, interactive_edit: v })}
            />
            <label htmlFor="interactive_edit" className="flex items-center gap-1 text-sm font-medium cursor-pointer">
              嵌字前编辑
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-slate-400" />
                </TooltipTrigger>
                <TooltipContent>
                  翻译和擦字完成后暂停，允许修改译文再嵌字。不开启则全自动完成。
                </TooltipContent>
              </Tooltip>
            </label>
          </div>
        )}
        {/* 字体管理 */}
        {!isEraseOnly && (
          <div className="space-y-2 rounded-md border border-slate-100 p-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-slate-700">字体管理</label>
              <span className="text-xs text-slate-400">上传 / 删除 / 备注</span>
            </div>
            <FontSelector value={config.font_path ?? ''} onChange={(p) => onChange({ ...config, font_path: p })} />
            <p className="text-xs text-slate-400">
              选择的字体将用于嵌字渲染。上传后可在嵌字前编辑中切换并预览效果。
            </p>
          </div>
        )}

        {/* 高级设置 */}
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          高级设置
        </button>
        {showAdvanced && (
          <div className="space-y-4 rounded-md border border-slate-100 p-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">检测器</label>
                <Select value={config.detector ?? 'default'} onValueChange={(v) => onChange({ ...config, detector: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {detectors.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">OCR 模型</label>
                <Select value={config.ocr ?? 'ocr48px'} onValueChange={(v) => onChange({ ...config, ocr: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ocrList.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">修复模型</label>
                <Select value={config.inpainter ?? 'lama_large'} onValueChange={(v) => onChange({ ...config, inpainter: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {inpainters.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {!isEraseOnly && (
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium">跨页上下文</label>
                <input
                  type="number"
                  min={0}
                  max={5}
                  value={config.context_size ?? 2}
                  onChange={(e) => onChange({ ...config, context_size: parseInt(e.target.value) || 0 })}
                  className="w-16 rounded-md border border-slate-200 px-2 py-1 text-sm"
                />
                <span className="text-xs text-slate-400">页（GPT 翻译器用前 N 页译文做上下文）</span>
              </div>
            )}
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
