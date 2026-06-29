import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, RefreshCw, ListTodo, ChevronLeft, ChevronRight, Trash2, X, CheckSquare } from 'lucide-react'
import { listTasks, deleteTask, type Task } from '@/lib/api'
import { TaskCard } from '@/components/TaskCard'
import { useToast } from '@/components/ui/toast'

const PAGE_SIZE = 10

export default function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [batchMode, setBatchMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchDeleting, setBatchDeleting] = useState(false)
  const toast = useToast()

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

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    setSelected(new Set(tasks.map(t => t.id)))
  }


  function enterBatchMode() {
    setBatchMode(true)
    setSelected(new Set())
  }

  function exitBatchMode() {
    setBatchMode(false)
    setSelected(new Set())
  }

  async function handleBatchDelete() {
    if (selected.size === 0) return
    setBatchDeleting(true)
    let ok = 0
    let fail = 0
    for (const id of selected) {
      try {
        await deleteTask(id)
        ok++
      } catch {
        fail++
      }
    }
    setBatchDeleting(false)
    exitBatchMode()
    await load()
    if (fail === 0) {
      toast.success(`已删除 ${ok} 个任务`)
    } else {
      toast.error(`删除完成：成功 ${ok}，失败 ${fail}`)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">翻译任务</h1>
        <div className="flex gap-2">
          {batchMode ? (
            <>
              <span className="flex items-center text-sm text-slate-500">已选 {selected.size}</span>
              <button onClick={selectAll} className="flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50">
                <CheckSquare className="h-4 w-4" />全选
              </button>
              <button
                onClick={handleBatchDelete}
                disabled={selected.size === 0 || batchDeleting}
                className="flex items-center gap-1 rounded-md bg-red-500 px-3 py-1.5 text-sm text-white hover:bg-red-600 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />{batchDeleting ? '删除中…' : `删除${selected.size > 0 ? `(${selected.size})` : ''}`}
              </button>
              <button onClick={exitBatchMode} className="flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50">
                <X className="h-4 w-4" />取消
              </button>
            </>
          ) : (
            <>
              <button onClick={() => load()} className="flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50">
                <RefreshCw className="h-4 w-4" />刷新
              </button>
              {tasks.length > 0 && (
                <button onClick={enterBatchMode} className="flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50">
                  <Trash2 className="h-4 w-4" />批量删除
                </button>
              )}
              <Link to="/" className="flex items-center gap-1 rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700">
                <Plus className="h-4 w-4" />新建
              </Link>
            </>
          )}
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
        {tasks.map((t) => (
          <div key={t.id} className={batchMode ? 'flex items-start gap-2' : ''}>
            {batchMode && (
              <button
                onClick={() => toggleSelect(t.id)}
                className={`mt-4 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors ${
                  selected.has(t.id) ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 hover:border-slate-400'
                }`}
              >
                {selected.has(t.id) && <CheckSquare className="h-3 w-3" />}
              </button>
            )}
            <div className="flex-1 min-w-0">
              <TaskCard task={t} onChanged={() => load()} />
            </div>
          </div>
        ))}
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
