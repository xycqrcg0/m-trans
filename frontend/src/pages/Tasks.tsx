import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, RefreshCw, ListTodo, ChevronLeft, ChevronRight } from 'lucide-react'
import { listTasks, type Task } from '@/lib/api'
import { TaskCard } from '@/components/TaskCard'

const PAGE_SIZE = 10

export default function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  async function load(p = page) {
    setLoading(true)
    try {
      const res = await listTasks(p, PAGE_SIZE)
      setTasks(res.items)
      setTotal(res.total)
      setPage(p)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(1) }, [])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">翻译任务</h1>
        <div className="flex gap-2">
          <button onClick={() => load()} className="flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50">
            <RefreshCw className="h-4 w-4" />刷新
          </button>
          <Link to="/" className="flex items-center gap-1 rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700">
            <Plus className="h-4 w-4" />新建
          </Link>
        </div>
      </div>

      {loading && <p className="text-center text-sm text-slate-400 py-12">加载中…</p>}

      {!loading && tasks.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 py-16 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
            <ListTodo className="h-6 w-6 text-slate-300" />
          </div>
          <p className="text-sm text-slate-400">暂无翻译任务</p>
          <Link to="/" className="mt-3 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-700">
            去上传第一张漫画 →
          </Link>
        </div>
      )}

      <div className="space-y-3">
        {tasks.map((t) => <TaskCard key={t.id} task={t} onChanged={() => load()} />)}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            onClick={() => load(page - 1)}
            disabled={page <= 1}
            className="flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />上一页
          </button>
          <span className="text-sm text-slate-500">
            {page} / {totalPages}
            <span className="text-slate-300">（共 {total} 个任务）</span>
          </span>
          <button
            onClick={() => load(page + 1)}
            disabled={page >= totalPages}
            className="flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-30"
          >
            下一页<ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  )
}
