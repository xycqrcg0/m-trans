import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Trash2, ImageOff } from 'lucide-react'
import { listTasks, deleteTask, getResultUrl, type Task } from '@/lib/api'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog'

export default function Gallery() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await listTasks(1, 100)
      setTasks(res.items.filter((t) => t.status === 'done'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleDelete(id: string) {
    await deleteTask(id)
    setDeleteConfirm(null)
    await load()
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="mb-6 text-2xl font-bold text-slate-900">历史记录</h1>

      {loading && <p className="py-12 text-center text-sm text-slate-400">加载中…</p>}

      {!loading && tasks.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-200 py-20 text-center">
          <ImageOff className="mx-auto mb-3 h-10 w-10 text-slate-300" />
          <p className="text-sm text-slate-400">暂无翻译历史</p>
          <Link to="/" className="mt-3 inline-block text-sm font-medium text-slate-700 hover:underline">
            去翻译第一张漫画
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {tasks.map((task) => {
          const filename = task.pages[0]?.filename ?? task.id
          const resultUrl = getResultUrl(task.id, 1)
          return (
            <div key={task.id} className="group relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
              <Link to={`/tasks/${task.id}`}>
                <img
                  src={resultUrl}
                  alt={filename}
                  className="aspect-[3/4] w-full object-cover transition-transform group-hover:scale-105"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
              </Link>
              <div className="p-2">
                <p className="truncate text-xs font-medium text-slate-700">{filename}</p>
                <p className="text-xs text-slate-400">{new Date(task.created_at).toLocaleDateString('zh-CN')}</p>
              </div>
              <button
                onClick={() => setDeleteConfirm(task.id)}
                className="absolute right-2 top-2 rounded-full bg-black/50 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )
        })}
      </div>

      <Dialog open={!!deleteConfirm} onOpenChange={(o) => !o && setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>确认删除</DialogTitle></DialogHeader>
          <p className="mt-2 text-sm text-slate-600">确定删除该翻译记录吗？原图和译图将一并删除，不可撤销。</p>
          <div className="mt-4 flex justify-end gap-2">
            <DialogClose asChild>
              <button className="rounded-md border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50">取消</button>
            </DialogClose>
            <button
              onClick={() => deleteConfirm && handleDelete(deleteConfirm)}
              className="rounded-md bg-red-500 px-4 py-2 text-sm text-white hover:bg-red-600"
            >
              删除
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
