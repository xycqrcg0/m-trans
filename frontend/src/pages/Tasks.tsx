import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, RefreshCw } from 'lucide-react'
import { listTasks, type Task } from '@/lib/api'
import { TaskCard } from '@/components/TaskCard'

export default function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const res = await listTasks()
      setTasks(res.items)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">翻译任务</h1>
        <div className="flex gap-2">
          <button onClick={load} className="flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50">
            <RefreshCw className="h-4 w-4" />刷新
          </button>
          <Link to="/" className="flex items-center gap-1 rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700">
            <Plus className="h-4 w-4" />新建
          </Link>
        </div>
      </div>

      {loading && <p className="text-center text-sm text-slate-400 py-12">加载中…</p>}

      {!loading && tasks.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-200 py-16 text-center">
          <p className="text-sm text-slate-400">暂无翻译任务</p>
          <Link to="/" className="mt-3 inline-block text-sm font-medium text-slate-700 hover:underline">去上传第一张漫画</Link>
        </div>
      )}

      <div className="space-y-3">
        {tasks.map((t) => <TaskCard key={t.id} task={t} />)}
      </div>
    </div>
  )
}
