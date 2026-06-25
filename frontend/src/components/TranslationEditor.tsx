import { useEffect, useState } from 'react'
import { Loader2, Check, AlertCircle } from 'lucide-react'
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
  const pageEdits = edits[String(pageIdx)] ?? {}
  const totalPages = pages.length

  function getEditText(pageIdx: number, blockIdx: number, fallback: string): string {
    return edits[String(pageIdx)]?.[blockIdx] ?? fallback
  }

  function setEditText(pageIdx: number, blockIdx: number, text: string) {
    setEdits((prev) => ({
      ...prev,
      [pageIdx]: { ...(prev[String(pageIdx)] ?? {}), [blockIdx]: text },
    }))
  }

  // "Use original" = fill with translated_text (pre-polish)
  function useOriginal(blockIdx: number) {
    const block = currentPage.text_blocks[blockIdx]
    if (block) setEditText(pageIdx, blockIdx, block.translated_text || block.polished_text)
  }

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    // Build the payload: for each page, a list of edited texts in order
    const payload: Record<string, string[]> = {}
    for (const page of pages) {
      payload[String(page.page_index)] = page.text_blocks.map((b, i) =>
        getEditText(page.page_index, i, b.polished_text || b.translated_text),
      )
    }
    try {
      await submitEdits(taskId, payload)
      onCompleted()
    } catch {
      setError('提交失败，请重试')
      setSubmitting(false)
    }
  }

  const editedCount = Object.values(edits).reduce(
    (sum, pageEdits) => sum + Object.keys(pageEdits).length,
    0,
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">
          编辑翻译（{editedCount} 处已修改）
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

      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium w-16">#</th>
              <th className="px-3 py-2 text-left font-medium">原文</th>
              <th className="px-3 py-2 text-left font-medium">译文（可编辑）</th>
              <th className="px-3 py-2 w-20" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {currentPage.text_blocks.map((block, i) => {
              const currentText = getEditText(pageIdx, i, block.polished_text || block.translated_text)
              const isEdited = pageEdits[i] !== undefined && pageEdits[i] !== (block.polished_text || block.translated_text)
              return (
                <tr key={i} className={isEdited ? 'bg-amber-50' : 'hover:bg-slate-50'}>
                  <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                  <td className="px-3 py-2 text-slate-600 align-top">{block.original_text || '—'}</td>
                  <td className="px-3 py-2 align-top">
                    <textarea
                      value={currentText}
                      onChange={(e) => setEditText(pageIdx, i, e.target.value)}
                      rows={Math.max(1, Math.ceil(currentText.length / 40))}
                      className="w-full rounded border border-slate-200 px-2 py-1 text-sm focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300 resize-y"
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() => useOriginal(i)}
                      className="text-xs text-slate-400 hover:text-slate-700"
                      title="恢复为初翻译文"
                    >
                      初翻
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400">
        修改译文后点击「提交并嵌字」，将使用修改后的译文渲染到图片上。点击「初翻」可恢复为未润色的机翻译文。
      </p>
    </div>
  )
}
