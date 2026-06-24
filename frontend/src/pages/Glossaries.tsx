import { useEffect, useState } from 'react'
import { Plus, Trash2, BookOpen } from 'lucide-react'
import { listGlossaries, createGlossary, deleteGlossary, type GlossaryMeta } from '@/lib/api'
import { GlossaryEditor } from '@/components/GlossaryEditor'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from '@/components/ui/dialog'

export default function Glossaries() {
  const [glossaries, setGlossaries] = useState<GlossaryMeta[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  async function load() {
    try {
      const list = await listGlossaries()
      setGlossaries(list)
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '加载术语库失败')
    }
  }

  useEffect(() => { load() }, [])
  async function handleCreate() {
    if (!newName.trim()) return
    const g = await createGlossary(newName.trim())
    setNewName('')
    setCreateOpen(false)
    await load()
    setSelected(g.id)
  }

  async function handleDelete(id: string) {
    await deleteGlossary(id)
    if (selected === id) setSelected(null)
    setDeleteConfirm(null)
    await load()
  }

  const selectedMeta = glossaries.find((g) => g.id === selected)

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900">术语库</h1>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <button className="flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700">
              <Plus className="h-4 w-4" />新建术语表
            </button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>新建术语表</DialogTitle>
            </DialogHeader>
            <div className="mt-4 space-y-4">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                placeholder="术语表名称"
                autoFocus
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
              <div className="flex justify-end gap-2">
                <DialogClose asChild>
                  <button className="rounded-md border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50">取消</button>
                </DialogClose>
                <button onClick={handleCreate} className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700">
                  创建
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      <div className="grid gap-6 md:grid-cols-[240px_1fr]">
        <div className="space-y-2">
          {glossaries.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-400">暂无术语表</p>
          )}
          {glossaries.map((g) => (
            <div
              key={g.id}
              onClick={() => setSelected(g.id)}
              className={`group flex cursor-pointer items-center justify-between rounded-lg border p-3 transition-colors ${
                selected === g.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <BookOpen className="h-4 w-4 shrink-0 opacity-70" />
                  <p className="truncate text-sm font-medium">{g.name}</p>
                </div>
                <p className={`text-xs mt-0.5 ${selected === g.id ? 'text-slate-300' : 'text-slate-400'}`}>
                  {g.entry_count} 词条
                </p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); setDeleteConfirm(g.id) }}
                className={`ml-2 shrink-0 opacity-0 group-hover:opacity-100 ${selected === g.id ? 'text-slate-300 hover:text-red-300' : 'text-slate-400 hover:text-red-500'}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="min-h-48 rounded-lg border border-slate-200 p-4">
          {selected ? (
            <>
              <h2 className="mb-4 text-sm font-semibold text-slate-700">{selectedMeta?.name}</h2>
              <GlossaryEditor glossaryId={selected} onUpdated={load} />
            </>
          ) : (
            <div className="flex h-full items-center justify-center py-12 text-sm text-slate-400">
              选择左侧术语表查看词条
            </div>
          )}
        </div>
      </div>

      <Dialog open={!!deleteConfirm} onOpenChange={(o) => !o && setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
          </DialogHeader>
          <p className="mt-2 text-sm text-slate-600">
            确定要删除术语表「{glossaries.find((g) => g.id === deleteConfirm)?.name}」吗？此操作不可撤销。
          </p>
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
