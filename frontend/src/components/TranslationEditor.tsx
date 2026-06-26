import { useEffect, useState, useCallback } from 'react'
import { Loader2, Check, AlertCircle, RotateCcw, Eye, Edit3 } from 'lucide-react'
import {
  getEditableBlocks,
  submitEdits,
  renderPreview,
  type EditablePage,
} from '@/lib/api'
import { PositionOverlay } from '@/components/PositionOverlay'

interface TranslationEditorProps {
  taskId: string
  imageUrl: string
  onCompleted: () => void
}

export function TranslationEditor({ taskId, imageUrl, onCompleted }: TranslationEditorProps) {
  const [pages, setPages] = useState<EditablePage[]>([])
  const [pageIdx] = useState(0)
  const [edits, setEdits] = useState<Record<string, Record<number, string>>>({})
  const [offsets, setOffsets] = useState<Record<string, Record<number, [number, number]>>>({})
  const [selected, setSelected] = useState<number | null>(null)
  const [imgSize, setImgSize] = useState({ w: 1, h: 1 })
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewMode, setPreviewMode] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

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

  // Preload image natural size
  useEffect(() => {
    const img = new Image()
    img.onload = () => setImgSize({ w: img.naturalWidth, h: img.naturalHeight })
    img.src = imageUrl
  }, [imageUrl])

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
  const pageKey = String(pageIdx)
  const pageOffsets = offsets[pageKey] ?? {}

  function getEditText(bIdx: number, fallback: string): string {
    return edits[pageKey]?.[bIdx] ?? fallback
  }

  function setEditText(bIdx: number, text: string) {
    setEdits(prev => ({ ...prev, [pageKey]: { ...(prev[pageKey] ?? {}), [bIdx]: text } }))
  }

  function handleOffsetChange(bIdx: number, dx: number, dy: number) {
    setOffsets(prev => ({
      ...prev,
      [pageKey]: { ...(prev[pageKey] ?? {}), [bIdx]: [dx, dy] },
    }))
  }

  function useOriginal(bIdx: number) {
    const block = currentPage.text_blocks[bIdx]
    if (block) setEditText(bIdx, block.translated_text || block.polished_text)
  }

  function resetOffset(bIdx: number) {
    setOffsets(prev => {
      const po = { ...(prev[pageKey] ?? {}) }
      delete po[bIdx]
      return { ...prev, [pageKey]: po }
    })
  }
  const updatePreview = useCallback(async () => {
    if (!currentPage) return
    setPreviewLoading(true)
    try {
      const texts = currentPage.text_blocks.map((b, i) =>
        getEditText(i, b.polished_text || b.translated_text),
      )
      const offs = currentPage.text_blocks.map((_, i) => {
        const o = pageOffsets[i] ?? [0, 0]
        return [o[0], o[1]]
      })
      const url = await renderPreview(taskId, pageIdx, texts, offs)
      setPreviewUrl(old => { if (old) URL.revokeObjectURL(old); return url })
    } catch {
      setError('预览渲染失败')
    } finally {
      setPreviewLoading(false)
    }
  }, [currentPage, pageOffsets, taskId, pageIdx])

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    const textPayload: Record<string, string[]> = {}
    const offsetPayload: Record<string, number[][]> = {}
    for (const page of pages) {
      const pk = String(page.page_index)
      textPayload[pk] = page.text_blocks.map((b, i) =>
        getEditTextFor(page.page_index, i, b.polished_text || b.translated_text),
      )
      const po = offsets[pk] ?? {}
      if (Object.keys(po).length > 0) {
        offsetPayload[pk] = page.text_blocks.map((_, i) => {
          const o = po[i] ?? [0, 0]
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

  function getEditTextFor(pIdx: number, bIdx: number, fallback: string): string {
    return edits[String(pIdx)]?.[bIdx] ?? fallback
  }

  const editedCount = Object.values(edits).reduce((s, pe) => s + Object.keys(pe).length, 0)
  const offsetCount = Object.values(offsets).reduce((s, pe) =>
    s + Object.keys(pe).filter(k => { const o = pe[Number(k)]; return o && (o[0] !== 0 || o[1] !== 0) }).length, 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">
          编辑翻译{editedCount > 0 && `（${editedCount} 处文字修改）`}{offsetCount > 0 && `（${offsetCount} 处位置微调）`}
        </h2>
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {submitting ? <><Loader2 className="h-4 w-4 animate-spin" />渲染中…</> : <><Check className="h-4 w-4" />提交并嵌字</>}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          <AlertCircle className="h-4 w-4" />{error}
        </div>
      )}

      {/* Mode toggle */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setPreviewMode(false)}
          className={`flex items-center gap-1 rounded-md px-3 py-1 text-sm ${!previewMode ? 'bg-slate-900 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
        >
          <Edit3 className="h-3.5 w-3.5" />编辑
        </button>
        <button
          onClick={async () => {
            setPreviewMode(true)
            await updatePreview()
          }}
          className={`flex items-center gap-1 rounded-md px-3 py-1 text-sm ${previewMode ? 'bg-slate-900 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
        >
          <Eye className="h-3.5 w-3.5" />预览最终效果
        </button>
        {previewLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
      </div>

      {/* Image display: overlay mode or preview mode */}
      {previewMode ? (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
          {previewUrl ? (
            <img src={previewUrl} alt="预览" className="w-full block" />
          ) : (
            <div className="flex h-48 items-center justify-center text-sm text-slate-400">
              {previewLoading ? '渲染中…' : '点击「预览最终效果」查看'}
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
          <PositionOverlay
            imageUrl={imageUrl}
            blocks={currentPage.text_blocks}
            offsets={pageOffsets}
            textEdits={edits[pageKey] ?? {}}
            selectedIdx={selected}
            onSelect={setSelected}
            onOffsetChange={handleOffsetChange}
            imageNaturalSize={imgSize}
          />
        </div>
      )}

      <p className="text-xs text-slate-400">
        {previewMode
          ? '此为最终渲染效果预览。切回编辑模式可继续调整。'
          : '图上方框为文字块位置，拖拽方框可微调嵌入位置。点击方框选中后在下方编辑译文。'}
      </p>
      {/* Text editing panel for selected block */}
      {selected !== null && currentPage.text_blocks[selected] ? (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-indigo-700">文字块 #{selected + 1}</span>
            <div className="flex items-center gap-2">
              {(() => {
                const [dx, dy] = pageOffsets[selected] ?? [0, 0]
                return (dx !== 0 || dy !== 0) ? (
                  <button onClick={() => resetOffset(selected)} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
                    <RotateCcw className="h-3 w-3" />重置位置
                  </button>
                ) : null
              })()}
              <button onClick={() => useOriginal(selected)} className="text-xs text-slate-400 hover:text-slate-700">恢复初翻</button>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="text-xs text-slate-500">原文</label>
              <p className="text-sm text-slate-600 mt-0.5 min-h-[1.5rem]">{currentPage.text_blocks[selected].original_text || '—'}</p>
            </div>
            <div>
              <label className="text-xs text-slate-500">位置偏移</label>
              <div className="flex items-center gap-1 mt-0.5">
                <input
                  type="number"
                  value={pageOffsets[selected]?.[0] ?? 0}
                  onChange={(e) => handleOffsetChange(selected, parseInt(e.target.value) || 0, pageOffsets[selected]?.[1] ?? 0)}
                  className="w-16 rounded border border-slate-200 px-1 py-0.5 text-xs text-center"
                />
                <span className="text-xs text-slate-400">X</span>
                <input
                  type="number"
                  value={pageOffsets[selected]?.[1] ?? 0}
                  onChange={(e) => handleOffsetChange(selected, pageOffsets[selected]?.[0] ?? 0, parseInt(e.target.value) || 0)}
                  className="w-16 rounded border border-slate-200 px-1 py-0.5 text-xs text-center"
                />
                <span className="text-xs text-slate-400">Y (px)</span>
              </div>
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500">译文（可编辑）</label>
            <textarea
              value={getEditText(selected, currentPage.text_blocks[selected].polished_text || currentPage.text_blocks[selected].translated_text)}
              onChange={(e) => setEditText(selected, e.target.value)}
              rows={2}
              className="mt-0.5 w-full rounded border border-slate-200 px-2 py-1 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-300 resize-y"
            />
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 p-3 text-center text-xs text-slate-400">
          点击图上任意方框选中文字块进行编辑
        </div>
      )}

      {/* Compact list of all blocks */}
      <details className="rounded-lg border border-slate-200">
        <summary className="cursor-pointer px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
          全部文字块（{currentPage.text_blocks.length} 个）
        </summary>
        <div className="divide-y divide-slate-100">
          {currentPage.text_blocks.map((block, i) => {
            const [dx, dy] = pageOffsets[i] ?? [0, 0]
            const isModified = (edits[pageKey]?.[i] !== undefined && edits[pageKey][i] !== (block.polished_text || block.translated_text))
              || dx !== 0 || dy !== 0
            return (
              <div
                key={i}
                onClick={() => setSelected(i)}
                className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer ${selected === i ? 'bg-indigo-50' : isModified ? 'bg-amber-50/30' : 'hover:bg-slate-50'}`}
              >
                <span className="w-6 text-xs text-slate-400">{i + 1}</span>
                <span className="flex-1 truncate text-xs text-slate-600">{block.original_text || '—'}</span>
                <span className="flex-1 truncate text-xs text-slate-900 font-medium">{getEditText(i, block.polished_text || block.translated_text)}</span>
                {(dx !== 0 || dy !== 0) && <span className="text-xs text-amber-500">{dx >= 0 ? '+' : ''}{dx},{dy >= 0 ? '+' : ''}{dy}</span>}
              </div>
            )
          })}
        </div>
      </details>
    </div>
  )
}
