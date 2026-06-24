import { useEffect, useState } from 'react'
import { KeyRound, Check, AlertCircle } from 'lucide-react'
import { getTranslatorConfigs, saveTranslatorConfig, type TranslatorConfigItem } from '@/lib/api'

export default function Settings() {
  const [configs, setConfigs] = useState<TranslatorConfigItem[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Record<string, { api_key: string; api_base: string; model: string }>>({})
  const [saving, setSaving] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const data = await getTranslatorConfigs()
      setConfigs(data)
      const editState: Record<string, { api_key: string; api_base: string; model: string }> = {}
      data.forEach((c) => {
        editState[c.translator] = { api_key: '', api_base: c.api_base, model: c.model }
      })
      setEditing(editState)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleSave(translator: string) {
    setSaving(translator)
    try {
      const ed = editing[translator]
      await saveTranslatorConfig({
        translator,
        api_key: ed.api_key || undefined,
        api_base: ed.api_base || undefined,
        model: ed.model || undefined,
      })
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
        <h1 className="text-2xl font-bold text-slate-900">翻译器配置</h1>
      </div>

      <div className="space-y-4">
        {configs.map((c) => (
          <div key={c.translator} className="rounded-lg border border-slate-200 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-900">{c.translator}</span>
              {c.configured ? (
                <span className="flex items-center gap-1 text-xs text-green-600">
                  <Check className="h-3 w-3" />已配置
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-slate-400">
                  <AlertCircle className="h-3 w-3" />未配置
                </span>
              )}
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <input
                type="password"
                placeholder="API Key"
                value={editing[c.translator]?.api_key ?? ''}
                onChange={(e) => setEditing({
                  ...editing,
                  [c.translator]: { ...editing[c.translator], api_key: e.target.value },
                })}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-sm sm:col-span-1"
              />
              <input
                type="text"
                placeholder="API Base URL（可选）"
                value={editing[c.translator]?.api_base ?? ''}
                onChange={(e) => setEditing({
                  ...editing,
                  [c.translator]: { ...editing[c.translator], api_base: e.target.value },
                })}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-sm sm:col-span-1"
              />
              <input
                type="text"
                placeholder="Model（可选）"
                value={editing[c.translator]?.model ?? ''}
                onChange={(e) => setEditing({
                  ...editing,
                  [c.translator]: { ...editing[c.translator], model: e.target.value },
                })}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-sm sm:col-span-1"
              />
            </div>

            <button
              onClick={() => handleSave(c.translator)}
              disabled={saving === c.translator}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {saving === c.translator ? '保存中…' : '保存'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
