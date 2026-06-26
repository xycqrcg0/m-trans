import { useEffect, useState } from 'react'
import { Loader2, Check, AlertCircle, Move } from 'lucide-react'
import {
  getEditableBlocks,
  submitEdits,
  type EditablePage,
} from '@/lib/api'

interface TranslationEditorProps {
  taskId: string
  onCompleted: () => void
}

export function TranslationEditor({ taskId, onCompleted }: TranslationEditorProps) {
  const [pages, setPages] = useState<EditablePage[]>([])
  const [pageIdx, setPageIdx] = useState(0)
  const [edits, setEdits] = useState<Record<string, Record<number, string>>>({})
  const [offsets, setOffsets] = useState<Record<string, Record<number, [number, number]>>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getEditableBlocks(taskId)
      .then((res) => {
        setPages(res.pages)
        setLoading(false)
      })
      .catch(() => {
        setError('加载可编辑文本失败')
        setLoading(false)
      })
  }, [taskId])

  if (loading) return (
    <div className="flex items-center justify-center py-8 text-sm text-slate-400">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />加载可编辑文本…
    </div>
  )

  if (error) return (
    <div className="flex items-center gap-2 py-8 text-sm text-red-500">
      <AlertCircle className="h-4 w-4" />{error}
    </div>
  )

  if (pages.length === 0) return (
    <div className="py-8 text-center text-sm text-slate-400">没有可编辑的文本块</div>
  )

  const currentPage = pages[pageIdx]
  const totalPages = pages.length

  function getEditText(pIdx: number, bIdx: number, fallback: string): string {
    return edits[String(pIdx)]?.[bIdx] ?? fallback
  }

  function setEditText(pIdx: number, bIdx: number, text: string) {
    setEdits((prev) => ({
      ...prev,
      [pIdx]: { ...(prev[String(pIdx)] ?? {}), [bIdx]: text },
    }))
  }

  function getOffset(pIdx: number, bIdx: number): [number, number] {
    return offsets[String(pIdx)]?.[bIdx] ?? [0, 0]
  }

  function setOffset(pIdx: number, bIdx: number, axis: 0 | 1, val: number) {
    setOffsets((prev) => {
      const pageOffsets = prev[String(pIdx)] ?? {}
      const current = pageOffsets[bIdx] ?? [0, 0]
      const next: [number, number] = [...current] as [number, number]
      next[axis] = val
      return {
        ...prev,
        [pIdx]: { ...pageOffsets, [bIdx]: next },
      }
    })
  }

  function useOriginal(bIdx: number) {
    const block = currentPage.text_blocks[bIdx]
    if (block) setEditText(pageIdx, bIdx, block.translated_text || block.polished_text)
  }

  function resetOffset(bIdx: number) {
    setOffsets((prev) => {
      const pageOffsets = { ...(prev[String(pageIdx)] ?? {}) }
      delete pageOffsets[bIdx]
      return { ...prev, [String(pageIdx)]: pageOffsets }
    })
  }

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    const textPayload: Record<string, string[]> = {}
    const offsetPayload: Record<string, number[][]> = {}
    for (const page of pages) {
      const pKey = String(page.page_index)
      textPayload[pKey] = page.text_blocks.map((b, i) =>
        getEditText(page.page_index, i, b.polished_text || b.translated_text),
      )
      // Only include offsets that are non-zero
      const pageOffsets = offsets[pKey] ?? {}
      const hasOffsets = Object.keys(pageOffsets).length > 0
      if (hasOffsets) {
        offsetPayload[pKey] = page.text_blocks.map((_, i) => {
          const o = pageOffsets[i] ?? [0, 0]
          return [o[0], o[1]]
        })
      }
    }
    try {
      await submitEdits(taskId, textPayload, Object.keys(offsetPayload).length > 0 ? offsetPayload : undefined)
      onCompleted()
    } catch {
      setError('提交失败，请重试')
      setSubmitting(false)
    }
  }

  const editedCount = Object.values(edits).reduce(
    (sum, pe) => sum + Object.keys(pe).length, 0,
  )
  const offsetCount = Object.values(offsets).reduce(
    (sum, pe) => sum + Object.keys(pe).filter(k => {
      const o = pe[Number(k)]
      return o && (o[0] !== 0 || o[1] !== 0)
    }).length, 0,
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">
          编辑翻译（{editedCount} 处文字修改{offsetCount > 0 ? `，${offsetCount} 处位置微调` : ''}）
        </h2>
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {submitting ? (
            <><Loader2 className="h-4 w-4 animate-spin" />渲染中…</>
          ) : (
            <><Check className="h-4 w-4" />提交并嵌字</>
          )}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          <AlertCircle className="h-4 w-4" />{error}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => setPageIdx(Math.max(0, pageIdx - 1))}
            disabled={pageIdx === 0}
            className="rounded-md border border-slate-200 px-3 py-1 text-sm disabled:opacity-30 hover:bg-slate-50"
          >
            上一页
          </button>
          <span className="text-sm text-slate-600">第 {pageIdx + 1} / {totalPages} 页</span>
          <button
            onClick={() => setPageIdx(Math.min(totalPages - 1, pageIdx + 1))}
            disabled={pageIdx === totalPages - 1}
            className="rounded-md border border-slate-200 px-3 py-1 text-sm disabled:opacity-30 hover:bg-slate-50"
          >
            下一页
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium w-10">#</th>
              <th className="px-3 py-2 text-left font-medium">原文</th>
              <th className="px-3 py-2 text-left font-medium">译文（可编辑）</th>
              <th className="px-3 py-2 text-left font-medium w-28">
                <Move className="mr-1 inline h-3 w-3" />位置微调
              </th>
              <th className="px-3 py-2 w-16" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {currentPage.text_blocks.map((block, i) => {
              const currentText = getEditText(pageIdx, i, block.polished_text || block.translated_text)
              const isEdited = edits[String(pageIdx)]?.[i] !== undefined &&
                edits[String(pageIdx)][i] !== (block.polished_text || block.translated_text)
              const [dx, dy] = getOffset(pageIdx, i)
              const hasOffset = dx !== 0 || dy !== 0
              return (
                <tr key={i} className={isEdited || hasOffset ? 'bg-amber-50/50' : 'hover:bg-slate-50'}>
                  <td className="px-3 py-2 text-slate-400 align-top">{i + 1}</td>
                  <td className="px-3 py-2 text-slate-600 align-top max-w-32">{block.original_text || '—'}</td>
                  <td className="px-3 py-2 align-top">
                    <textarea
                      value={currentText}
                      onChange={(e) => setEditText(pageIdx, i, e.target.value)}
                      rows={Math.max(1, Math.ceil(currentText.length / 40))}
                      className="w-full rounded border border-slate-200 px-2 py-1 text-sm focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300 resize-y"
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={dx}
                        onChange={(e) => setOffset(pageIdx, i, 0, parseInt(e.target.value) || 0)}
                        className="w-12 rounded border border-slate-200 px-1 py-0.5 text-xs text-center"
                        title="水平偏移（像素）"
                      />
                      <span className="text-xs text-slate-400">×</span>
                      <input
                        type="number"
                        value={dy}
                        onChange={(e) => setOffset(pageIdx, i, 1, parseInt(e.target.value) || 0)}
                        className="w-12 rounded border border-slate-200 px-1 py-0.5 text-xs text-center"
                        title="垂直偏移（像素）"
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center align-top">
                    <button
                      onClick={() => useOriginal(i)}
                      className="block text-xs text-slate-400 hover:text-slate-700"
                      title="恢复为初翻译文"
                    >
                      初翻
                    </button>
                    {hasOffset && (
                      <button
                        onClick={() => resetOffset(i)}
                        className="block mt-1 text-xs text-slate-400 hover:text-red-500"
                        title="重置位置"
                      >
                        重置
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400">
        修改译文后点击「提交并嵌字」。位置微调的 X/Y 值为像素偏移量（正数向右/下，负数向左/上）。
      </p>
    </div>
  )
}
