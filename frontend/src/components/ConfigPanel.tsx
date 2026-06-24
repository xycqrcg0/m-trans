import { useEffect, useState } from 'react'
import { Info } from 'lucide-react'
import { getOptions, listGlossaries, type TaskConfig, type OptionItem, type TranslatorOption, type GlossaryMeta } from '@/lib/api'
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
  { id: 'deepseek', name: 'DeepSeek', requires_key: true },
  { id: 'chatgpt', name: 'ChatGPT', requires_key: true },
  { id: 'sugoi', name: 'Sugoi (离线)', requires_key: false },
]

export function ConfigPanel({ config, onChange }: ConfigPanelProps) {
  const [langs, setLangs] = useState<OptionItem[]>(FALLBACK_LANGS)
  const [translators, setTranslators] = useState<TranslatorOption[]>(FALLBACK_TRANSLATORS)
  const [glossaries, setGlossaries] = useState<GlossaryMeta[]>([])

  useEffect(() => {
    getOptions().then((o) => {
      if (o.languages.length) setLangs(o.languages)
      if (o.translators.length) setTranslators(o.translators)
    }).catch(() => {})
    listGlossaries().then(setGlossaries).catch(() => {})
  }, [])

  return (
    <TooltipProvider>
      <div className="space-y-4">
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

          <div className="space-y-1.5">
            <label className="text-sm font-medium">翻译引擎</label>
            <Select value={config.translator ?? 'deepseek'} onValueChange={(v) => onChange({ ...config, translator: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {translators.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex items-center gap-2">
            <Switch
              id="polish"
              checked={config.polish ?? true}
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
      </div>
    </TooltipProvider>
  )
}
