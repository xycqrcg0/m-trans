import { useEffect, useState } from 'react'
import { Info, ChevronDown, ChevronUp } from 'lucide-react'
import {
  getOptions, listGlossaries,
  type TaskConfig, type OptionItem, type TranslatorOption, type GlossaryMeta,
} from '@/lib/api'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'

interface ConfigPanelProps {
  config: Partial<TaskConfig>
  onChange: (c: Partial<TaskConfig>) => void
}

const FALLBACK_LANGS: OptionItem[] = [
  { id: 'CHS', name: '简体中文' }, { id: 'CHT', name: '繁体中文' },
  { id: 'ENG', name: '英语' }, { id: 'JPN', name: '日语' }, { id: 'KOR', name: '韩语' },
]
const FALLBACK_TRANSLATORS: TranslatorOption[] = [
  { id: 'google', name: 'Google', requires_key: false },
  { id: 'deepseek', name: 'DeepSeek', requires_key: true },
  { id: 'original', name: '原文', requires_key: false },
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

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">目标语言</label>
            <Select value={config.target_lang ?? 'CHS'} onValueChange={(v) => onChange({ ...config, target_lang: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {langs.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {!isEraseOnly && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">翻译引擎</label>
              <Select value={config.translator ?? 'google'} onValueChange={(v) => onChange({ ...config, translator: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {translators.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {!isEraseOnly && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-center gap-2">
              <Switch
                id="polish"
                checked={config.polish ?? false}
                onCheckedChange={(v) => onChange({ ...config, polish: v })}
              />
              <label htmlFor="polish" className="flex items-center gap-1 text-sm font-medium cursor-pointer">
                LLM 润色
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-slate-400" />
                  </TooltipTrigger>
                  <TooltipContent>使用 Claude 将译文改写为二次元语境风格</TooltipContent>
                </Tooltip>
              </label>
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
                  value={config.context_size ?? 0}
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
