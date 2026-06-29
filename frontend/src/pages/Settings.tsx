import { useEffect, useState } from 'react'
import { KeyRound, Check, AlertCircle, Loader2, Type } from 'lucide-react'
import {
  getTranslatorConfigs,
  saveTranslatorConfig,
  type TranslatorConfigItem,
} from '@/lib/api'
import { FontSelector } from '@/components/FontSelector'

export default function Settings() {
  const [configs, setConfigs] = useState<TranslatorConfigItem[]>([])
  const [loading, setLoading] = useState(true)
  // editValues: { translator_id: { env_var: new_value } }
  const [editValues, setEditValues] = useState<Record<string, Record<string, string>>>({})
  const [saving, setSaving] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const data = await getTranslatorConfigs()
      setConfigs(data)
      const edits: Record<string, Record<string, string>> = {}
      data.forEach((c) => {
        edits[c.translator] = {}
      })
      setEditValues(edits)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

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
        <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
          <Type className="h-4 w-4 text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-700">字体管理</h2>
        </div>
        <p className="text-sm text-slate-500 -mt-2">
          上传、删除字体文件，或为字体添加备注。上传的字体可在新建任务时选择，也可在嵌字前编辑中切换并预览效果。
        </p>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          {/* FontSelector with no value binding — purely for managing fonts */}
          <FontSelector value="" onChange={() => {}} />
        </div>
      </section>
    </div>
  )
}
