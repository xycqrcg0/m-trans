import { useEffect, useState, useRef, useCallback } from 'react'
import { Loader2, Check, AlertCircle, RotateCcw, RefreshCw } from 'lucide-react'
import {
  getEditableBlocks,
  submitEdits,
  renderPreview,
  getInpaintedUrl,
  getTask,
  updateTaskConfig,
  listGlossaries,
  addGlossaryEntry,
  type EditablePage,
  type GlossaryMeta,
} from '@/lib/api'
import { PositionCanvas } from '@/components/PositionCanvas'
import { Switch } from '@/components/ui/switch'
import { FontSelector } from '@/components/FontSelector'
import { useToast } from '@/components/ui/toast'

interface TranslationEditorProps {
  taskId: string
  pageIndex: number
  onCompleted: () => void
}

const RENDER_DEBOUNCE_MS = 600

export function TranslationEditor({ taskId, pageIndex, onCompleted }: TranslationEditorProps) {
  const toast = useToast()
  const [pages, setPages] = useState<EditablePage[]>([])
  const [edits, setEdits] = useState<Record<string, Record<number, string>>>({})
  const [offsets, setOffsets] = useState<Record<string, Record<number, [number, number]>>>({})
  // Undo stacks keyed by `${pageKey}:${blockIdx}` — each entry is a prior text value.
  const [undoStacks, setUndoStacks] = useState<Record<string, string[]>>({})
  const [selected, setSelected] = useState<number | null>(null)
  const [imgSize, setImgSize] = useState({ w: 1, h: 1 })
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Backend-rendered DEFAULT embedding (text at original positions, no offsets).
  // Refreshed when text content changes; offsets never trigger a re-render.
  const [renderedUrl, setRenderedUrl] = useState<string | null>(null)
  // Cache of rendered preview URLs by page index — switching back to a
  // previously rendered page restores from cache instead of re-rendering.
  const renderCacheRef = useRef<Record<number, string>>({})
  const [rendering, setRendering] = useState(false)
  const [autoRender, setAutoRender] = useState(true)
  const renderTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [glossaries, setGlossaries] = useState<GlossaryMeta[]>([])
  const [addTermMsg, setAddTermMsg] = useState<string | null>(null)
  const [fontPath, setFontPath] = useState('')
  const [showFontSettings, setShowFontSettings] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  // No auto-scroll — keep page position stable during block selection
  // Clean (text-erased) base image, used by the canvas to erase-in-place.
  const inpaintedUrl = getInpaintedUrl(taskId, pageIndex + 1)

  useEffect(() => {
    setLoading(true)
    setError(null)
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

  useEffect(() => {
    listGlossaries().then(res => setGlossaries(res)).catch(() => {})
  }, [])
  // Fetch the task's current font_path so the selector shows the right value
  useEffect(() => {
    getTask(taskId).then(t => setFontPath(t.config.font_path ?? '')).catch(() => {})
  }, [taskId])
  const pageKey = String(pageIndex)
  const currentPage = pages.find(p => p.page_index === pageIndex) ?? null
  const pageOffsets = offsets[pageKey] ?? {}

  const getEditText = useCallback((bIdx: number, fallback: string): string => (
    edits[pageKey]?.[bIdx] ?? fallback
  ), [edits, pageKey])

  function setEditText(bIdx: number, text: string) {
    const undoKey = `${pageKey}:${bIdx}`
    // Push the current value onto the undo stack before replacing it.
    setUndoStacks(prev => {
      const stack = prev[undoKey] ?? []
      const current = edits[pageKey]?.[bIdx] ?? (currentPage?.text_blocks[bIdx]?.polished_text || currentPage?.text_blocks[bIdx]?.translated_text || '')
      // Don't push duplicates (e.g. rapid typing produces many identical intermediate states)
      if (stack.length > 0 && stack[stack.length - 1] === current) return prev
      return { ...prev, [undoKey]: [...stack, current].slice(-50) }
    })
    setEdits(prev => ({ ...prev, [pageKey]: { ...(prev[pageKey] ?? {}), [bIdx]: text } }))
  }

  function undoEdit(bIdx: number) {
    const undoKey = `${pageKey}:${bIdx}`
    setUndoStacks(prev => {
      const stack = prev[undoKey] ?? []
      if (stack.length === 0) return prev
      const last = stack[stack.length - 1]
      setEdits(e => ({ ...e, [pageKey]: { ...(e[pageKey] ?? {}), [bIdx]: last } }))
      return { ...prev, [undoKey]: stack.slice(0, -1) }
    })
  }

  function handleOffsetChange(bIdx: number, dx: number, dy: number) {
    setOffsets(prev => ({
      ...prev,
      [pageKey]: { ...(prev[pageKey] ?? {}), [bIdx]: [dx, dy] },
    }))
  }

  function resetOffset(bIdx: number) {
    setOffsets(prev => {
      const po = { ...(prev[pageKey] ?? {}) }
      delete po[bIdx]
      return { ...prev, [pageKey]: po }
    })
  }

  /** Update the task's font_path on the backend, then re-render the preview. */
  async function handleFontChange(path: string) {
    setFontPath(path)
    try {
      await updateTaskConfig(taskId, { font_path: path })
      void renderDefault()
    } catch {
      setError('更新字体配置失败')
      toast.error('更新字体配置失败')
    }
  }

  /**
   * Ask the backend to render the DEFAULT embedding for the current page
   * (current text content, zero offsets). This is the picture the canvas then
   * moves pixels on top of. Called on first load and when text content changes;
   * NEVER on position drags — those are pure client-side pixel offsets.
   */
  const renderDefault = useCallback(async () => {
    if (!currentPage) return
    setRendering(true)
    try {
      const texts = currentPage.text_blocks.map((b, i) =>
        getEditText(i, b.polished_text || b.translated_text),
      )
      const offs = currentPage.text_blocks.map(() => [0, 0])
      const url = await renderPreview(taskId, pageIndex, texts, offs)
      // Revoke the previously cached URL for this page (if any) to avoid leaks
      const oldCached = renderCacheRef.current[pageIndex]
      if (oldCached && oldCached !== url) URL.revokeObjectURL(oldCached)
      renderCacheRef.current[pageIndex] = url
      setRenderedUrl(old => { if (old && old !== url) URL.revokeObjectURL(old); return url })
    } catch (e) {
      const msg = e && typeof e === 'object' && 'code' in e && e.code === 'ECONNABORTED'
        ? '预览渲染超时，请稍后重试'
        : '预览渲染失败'
      setError(msg)
      toast.error(msg)
    } finally {
      setRendering(false)
    }
  }, [currentPage, getEditText, taskId, pageIndex])

  // Preload natural size from the inpainted image (geometry reference).
  useEffect(() => {
    const img = new Image()
    img.onload = () => setImgSize({ w: img.naturalWidth, h: img.naturalHeight })
    img.src = inpaintedUrl
  }, [inpaintedUrl])

  // First render: if we have a cached render for this page, restore it;
  // otherwise trigger a new render once blocks are available.
  useEffect(() => {
    if (!currentPage) return
    const cached = renderCacheRef.current[pageIndex]
    if (cached) {
      setRenderedUrl(cached)
    } else if (!renderedUrl) {
      void renderDefault()
    }
  }, [currentPage, pageIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  // Page switch: clear selection (but keep cached URLs).
  useEffect(() => {
    setSelected(null)
  }, [pageIndex])

  function scheduleRender() {
    clearTimeout(renderTimer.current)
    renderTimer.current = setTimeout(() => void renderDefault(), RENDER_DEBOUNCE_MS)
  }

  // Text content changes → debounced backend re-render of the default picture.
  // Only when auto-render is on; otherwise the user triggers re-renders manually.
  useEffect(() => {
    if (autoRender && currentPage && renderedUrl !== null) scheduleRender()
    return () => clearTimeout(renderTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edits, autoRender])

  // Revoke all cached object URLs on unmount.
  useEffect(() => {
    return () => {
      for (const url of Object.values(renderCacheRef.current)) {
        URL.revokeObjectURL(url)
      }
    }
  }, [])

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    const textPayload: Record<string, string[]> = {}
    const offsetPayload: Record<string, number[][]> = {}
    for (const page of pages) {
      const pk = String(page.page_index)
      textPayload[pk] = page.text_blocks.map((b, i) =>
        edits[pk]?.[i] ?? (b.polished_text || b.translated_text),
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
      toast.error('提交失败，请重试')
      setSubmitting(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-8 text-sm text-slate-400">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />加载可编辑文本…
    </div>
  )

  if (error && !currentPage) return (
    <div className="flex items-center gap-2 py-8 text-sm text-red-500">
      <AlertCircle className="h-4 w-4" />{error}
    </div>
  )

  if (pages.length === 0) return (
    <div className="py-8 text-center text-sm text-slate-400">没有可编辑的文本块</div>
  )

  if (!currentPage) return (
    <div className="py-8 text-center text-sm text-slate-400">该页无可编辑文本块</div>
  )

  const editedCount = Object.values(edits).reduce((s, pe) => s + Object.keys(pe).length, 0)
  const offsetCount = Object.values(offsets).reduce((s, pe) =>
    s + Object.keys(pe).filter(k => { const o = pe[Number(k)]; return o && (o[0] !== 0 || o[1] !== 0) }).length, 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-700">
          嵌字前编辑{editedCount > 0 && `（${editedCount} 处文字修改）`}{offsetCount > 0 && `（${offsetCount} 处位置微调）`}
        </h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-slate-500 select-none cursor-pointer">
            <Switch checked={autoRender} onCheckedChange={setAutoRender} />
            自动渲染
          </label>
          <button
            onClick={() => void renderDefault()}
            disabled={rendering}
            className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {rendering ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            重新渲染
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {submitting ? <><Loader2 className="h-4 w-4 animate-spin" />渲染中…</> : <><Check className="h-4 w-4" />提交并嵌字</>}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          <AlertCircle className="h-4 w-4" />{error}
        </div>
      )}

      {/* Pixel-true editor: default render on top, dragged blocks moved client-side */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
        {renderedUrl ? (
          <PositionCanvas
            inpaintedUrl={inpaintedUrl}
            renderedUrl={renderedUrl}
            blocks={currentPage.text_blocks}
            offsets={pageOffsets}
            selectedIdx={selected}
            onSelect={setSelected}
            onOffsetChange={handleOffsetChange}
            onDragEnd={() => { /* pure client-side; nothing to refresh */ }}
            imageNaturalSize={imgSize}
            rendering={rendering}
          />
        ) : (
          <div className="flex items-center justify-center py-16 text-sm text-slate-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />渲染默认嵌字效果…
          </div>
        )}
      </div>

      {/* Font settings: change font and see the effect via re-render */}
      <div className="rounded-lg border border-slate-200">
        <button
          onClick={() => setShowFontSettings(!showFontSettings)}
          className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          <span>字体设置</span>
          <span className="text-xs text-slate-400">{showFontSettings ? '收起' : '展开'}</span>
        </button>
        {showFontSettings && (
          <div className="border-t border-slate-100 px-3 py-3">
            <FontSelector value={fontPath} onChange={handleFontChange} />
            <p className="mt-1.5 text-xs text-slate-400">切换字体后自动重新渲染预览</p>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-400">
        图上文字即后端实时渲染的最终嵌字效果。拖拽方框微调位置时，前端直接平移该文字块的真实像素，无需重新渲染；{autoRender ? '修改译文内容后自动重新渲染底图' : '关闭自动渲染后，修改译文内容需点击「重新渲染」查看效果'}。完成后点击「提交并嵌字」由后端按偏移量最终嵌字。
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
              <button
                onClick={() => {
                  const block = currentPage.text_blocks[selected]
                  if (block) setEditText(selected, block.translated_text || block.polished_text)
                }}
                className="text-xs text-slate-400 hover:text-slate-700"
              >恢复初翻</button>
              {glossaries.length > 0 && (
                <select
                  className="text-xs rounded border border-slate-200 px-1 py-0.5"
                  defaultValue=""
                  onChange={async (e) => {
                    const gid = e.target.value
                    if (!gid || selected === null) return
                    const block = currentPage.text_blocks[selected]
                    if (!block) return
                    const src = block.original_text.trim()
                    const tgt = getEditText(selected, block.polished_text || block.translated_text).trim()
                    if (!src || !tgt) return
                    try {
                      await addGlossaryEntry(gid, src, tgt)
                      setAddTermMsg(`已加入：${src} → ${tgt}`)
                      setTimeout(() => setAddTermMsg(null), 3000)
                    } catch {
                      setAddTermMsg('加入失败')
                      setTimeout(() => setAddTermMsg(null), 3000)
                    }
                    e.target.value = ""
                  }}
                >
                  <option value="" disabled>加入术语表…</option>
                  {glossaries.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              )}
            </div>
          </div>
          {addTermMsg && <p className="text-xs text-green-600">{addTermMsg}</p>}
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
            <div className="flex items-center justify-between">
              <label className="text-xs text-slate-500">译文（可编辑）</label>
              {(undoStacks[`${pageKey}:${selected}`]?.length ?? 0) > 0 && (
                <button
                  onClick={() => undoEdit(selected)}
                  className="flex items-center gap-0.5 text-xs text-slate-400 hover:text-slate-700"
                >
                  <RotateCcw className="h-3 w-3" />撤销
                </button>
              )}
            </div>
            <textarea
              value={getEditText(selected, currentPage.text_blocks[selected].polished_text || currentPage.text_blocks[selected].translated_text)}
              onChange={(e) => setEditText(selected, e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                  e.preventDefault()
                  undoEdit(selected)
                }
              }}
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
      <details open className="rounded-lg border border-slate-200">
        <summary className="cursor-pointer px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
          全部文字块（{currentPage.text_blocks.length} 个）
        </summary>
        <div ref={listRef} className="divide-y divide-slate-100 max-h-48 overflow-y-auto">
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
