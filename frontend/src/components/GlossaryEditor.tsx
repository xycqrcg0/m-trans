import { useEffect, useState } from 'react'
import { Pencil, Trash2, Plus, Check, X } from 'lucide-react'
import {
  getGlossary, updateEntries, deleteEntry,
  type Glossary, type GlossaryEntry,
} from '@/lib/api'

interface GlossaryEditorProps {
  glossaryId: string
  onUpdated: () => void
}

export function GlossaryEditor({ glossaryId, onUpdated }: GlossaryEditorProps) {
  const [glossary, setGlossary] = useState<Glossary | null>(null)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [editRow, setEditRow] = useState<GlossaryEntry>({ source: '', target: '', note: '' })
  const [addingNew, setAddingNew] = useState(false)
  const [newRow, setNewRow] = useState<GlossaryEntry>({ source: '', target: '', note: '' })
  const [tsv, setTsv] = useState('')
  const [showTsv, setShowTsv] = useState(false)

  async function load() {
    const g = await getGlossary(glossaryId)
    setGlossary(g)
  }

  useEffect(() => { load() }, [glossaryId])

  async function saveEdit(idx: number) {
    if (!glossary) return
    const updated = glossary.entries.map((e, i) => i === idx ? editRow : e)
    await updateEntries(glossaryId, updated)
    setEditingIdx(null)
    await load()
    onUpdated()
  }

  async function handleDelete(source: string) {
    await deleteEntry(glossaryId, source)
    await load()
    onUpdated()
  }

  async function handleAdd() {
    if (!newRow.source || !newRow.target) return
    const current = glossary?.entries ?? []
    await updateEntries(glossaryId, [...current, newRow])
    setNewRow({ source: '', target: '', note: '' })
    setAddingNew(false)
    await load()
    onUpdated()
  }

  async function importTsv() {
    const rows = tsv.trim().split('\n').map((line) => {
      const [source = '', target = '', note = ''] = line.split('\t')
      return { source: source.trim(), target: target.trim(), note: note.trim() }
    }).filter((r) => r.source && r.target)
    if (!rows.length) return
    await updateEntries(glossaryId, [...(glossary?.entries ?? []), ...rows])
    setTsv('')
    setShowTsv(false)
    await load()
    onUpdated()
  }

  if (!glossary) return <div className="py-4 text-center text-sm text-slate-400">加载中…</div>

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">{glossary.entries.length} 条词条</span>
        <div className="flex gap-2">
          <button onClick={() => setShowTsv(!showTsv)} className="text-xs text-slate-500 hover:text-slate-900">
            批量导入 TSV
          </button>
          <button
            onClick={() => setAddingNew(true)}
            className="flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-900"
          >
            <Plus className="h-3.5 w-3.5" />添加词条
          </button>
        </div>
      </div>

      {showTsv && (
        <div className="space-y-2">
          <textarea
            value={tsv}
            onChange={(e) => setTsv(e.target.value)}
            placeholder={'原文\t译文\t备注（可选）\n勇者\t勇士\n'}
            rows={4}
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowTsv(false)} className="text-sm text-slate-500">取消</button>
            <button onClick={importTsv} className="text-sm font-medium text-slate-900">导入</button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">原文</th>
              <th className="px-3 py-2 text-left font-medium">译文</th>
              <th className="px-3 py-2 text-left font-medium">备注</th>
              <th className="px-3 py-2 w-16" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {glossary.entries.map((entry, i) => (
              <tr key={i} className="hover:bg-slate-50">
                {editingIdx === i ? (
                  <>
                    <td className="px-3 py-1.5">
                      <input value={editRow.source} onChange={(e) => setEditRow({ ...editRow, source: e.target.value })}
                        className="w-full rounded border border-slate-200 px-2 py-1 text-xs focus:outline-none" />
                    </td>
                    <td className="px-3 py-1.5">
                      <input value={editRow.target} onChange={(e) => setEditRow({ ...editRow, target: e.target.value })}
                        className="w-full rounded border border-slate-200 px-2 py-1 text-xs focus:outline-none" />
                    </td>
                    <td className="px-3 py-1.5">
                      <input value={editRow.note} onChange={(e) => setEditRow({ ...editRow, note: e.target.value })}
                        className="w-full rounded border border-slate-200 px-2 py-1 text-xs focus:outline-none" />
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex gap-1">
                        <button onClick={() => saveEdit(i)} className="text-green-600 hover:text-green-800"><Check className="h-4 w-4" /></button>
                        <button onClick={() => setEditingIdx(null)} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-3 py-2 text-slate-700">{entry.source}</td>
                    <td className="px-3 py-2 text-slate-700">{entry.target}</td>
                    <td className="px-3 py-2 text-slate-400 text-xs">{entry.note}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button onClick={() => { setEditingIdx(i); setEditRow(entry) }} className="text-slate-400 hover:text-slate-700"><Pencil className="h-3.5 w-3.5" /></button>
                        <button onClick={() => handleDelete(entry.source)} className="text-slate-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}

            {addingNew && (
              <tr className="bg-slate-50">
                <td className="px-3 py-1.5">
                  <input value={newRow.source} onChange={(e) => setNewRow({ ...newRow, source: e.target.value })}
                    placeholder="原文" className="w-full rounded border border-slate-200 px-2 py-1 text-xs focus:outline-none" />
                </td>
                <td className="px-3 py-1.5">
                  <input value={newRow.target} onChange={(e) => setNewRow({ ...newRow, target: e.target.value })}
                    placeholder="译文" className="w-full rounded border border-slate-200 px-2 py-1 text-xs focus:outline-none" />
                </td>
                <td className="px-3 py-1.5">
                  <input value={newRow.note} onChange={(e) => setNewRow({ ...newRow, note: e.target.value })}
                    placeholder="备注（可选）" className="w-full rounded border border-slate-200 px-2 py-1 text-xs focus:outline-none" />
                </td>
                <td className="px-3 py-1.5">
                  <div className="flex gap-1">
                    <button onClick={handleAdd} className="text-green-600 hover:text-green-800"><Check className="h-4 w-4" /></button>
                    <button onClick={() => setAddingNew(false)} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
                  </div>
                </td>
              </tr>
            )}

            {glossary.entries.length === 0 && !addingNew && (
              <tr><td colSpan={4} className="py-6 text-center text-sm text-slate-400">暂无词条</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
