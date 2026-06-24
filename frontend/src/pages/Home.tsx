import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { createTask, type TaskConfig, DEFAULT_CONFIG } from '@/lib/api'
import { UploadZone } from '@/components/UploadZone'
import { ConfigPanel } from '@/components/ConfigPanel'

export default function Home() {
  const navigate = useNavigate()
  const [files, setFiles] = useState<File[]>([])
  const [config, setConfig] = useState<Partial<TaskConfig>>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (!files.length) { setError('请先选择图片'); return }
    setError(null)
    setLoading(true)
    try {
      await createTask(files, config)
      navigate('/tasks')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '提交失败'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">上传漫画</h1>
        <p className="mt-1 text-sm text-slate-500">上传图片后自动完成识别、翻译、润色、合成全流程</p>
      </div>

      <div className="rounded-lg border border-slate-200 p-5 space-y-5">
        <UploadZone files={files} onChange={setFiles} />

        <div className="border-t border-slate-100 pt-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">翻译配置</h2>
          <ConfigPanel config={config} onChange={setConfig} />
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={loading || !files.length}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {loading ? '提交中…' : '开始翻译'}
        </button>
      </div>
    </div>
  )
}
