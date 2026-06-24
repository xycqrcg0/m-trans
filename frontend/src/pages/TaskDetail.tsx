import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Download } from 'lucide-react'
import { getTask, getResultUrl, type Task } from '@/lib/api'
import { ResultViewer } from '@/components/ResultViewer'

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>()
  const [task, setTask] = useState<Task | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    getTask(id).then(setTask).catch(() => setError('加载任务失败'))
  }, [id])

  if (error) return (
    <div className="p-6 text-center text-sm text-red-500">{error}</div>
  )

  if (!task) return (
    <div className="p-6 text-center text-sm text-slate-400">加载中…</div>
  )

  if (task.status !== 'done') return (
    <div className="mx-auto max-w-2xl p-6">
      <Link to="/tasks" className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" />返回任务列表
      </Link>
      <p className="mt-6 text-center text-sm text-slate-400">任务尚未完成（当前状态：{task.status}）</p>
    </div>
  )

  const page = task.pages[0]
  const resultUrl = getResultUrl(task.id)
  const originalUrl = `/api/tasks/${task.id}/upload`

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-6">
      <div className="flex items-center justify-between">
        <Link to="/tasks" className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" />返回
        </Link>
        <a
          href={resultUrl}
          download={`translated_${task.id}.png`}
          className="flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700"
        >
          <Download className="h-4 w-4" />下载译图 PNG
        </a>
      </div>

      <div>
        <h1 className="text-xl font-bold text-slate-900 truncate">{page?.filename ?? task.id}</h1>
        <p className="text-xs text-slate-400">{new Date(task.created_at).toLocaleString('zh-CN')}</p>
      </div>

      <ResultViewer
        originalUrl={originalUrl}
        resultUrl={resultUrl}
        textBlocks={page?.text_blocks ?? []}
      />
    </div>
  )
}
