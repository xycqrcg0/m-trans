import { useState, useRef, useCallback, useEffect } from 'react'
import type { EditableTextBlock } from '@/lib/api'

interface PositionCanvasProps {
  /** Clean (text-erased) base image — the canvas we composite text onto. */
  inpaintedUrl: string
  /** Backend-rendered default result (all text at original positions, no offsets). */
  renderedUrl: string
  blocks: EditableTextBlock[]
  offsets: Record<number, [number, number]>
  selectedIdx: number | null
  onSelect: (idx: number | null) => void
  onOffsetChange: (idx: number, dx: number, dy: number) => void
  onDragEnd: () => void
  imageNaturalSize: { w: number; h: number }
  /** Whether a backend re-render is in flight (shows subtle loading state). */
  rendering?: boolean
}

/**
 * Pixel-true offset editor.
 *
 * The backend renders the default embedding ONCE; this canvas then moves each
 * block's real rendered pixels by the user's drag offset, with NO further
 * backend calls. For every offset block we:
 *   1. capture its rendered pixels (the lettering) at the original bbox,
 *   2. repaint that bbox from the clean inpainted image (erase in place),
 *   3. stamp the captured pixels at the offset position.
 *
 * The picture therefore always shows the genuine rendered lettering at the
 * exact position the final embedding will use. Dragging is pure canvas work.
 */
export function PositionCanvas({
  inpaintedUrl,
  renderedUrl,
  blocks,
  offsets,
  selectedIdx,
  onSelect,
  onOffsetChange,
  onDragEnd,
  imageNaturalSize,
  rendering,
}: PositionCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Off-screen sources at natural resolution.
  const inpaintedImgRef = useRef<HTMLImageElement | null>(null)
  const renderedImgRef = useRef<HTMLImageElement | null>(null)
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 })
  const [inpaintedReady, setInpaintedReady] = useState(false)
  const [renderedReady, setRenderedReady] = useState(false)
  const sourcesReady = inpaintedReady && renderedReady
  const [dragging, setDragging] = useState<{ idx: number; startX: number; startY: number; baseDx: number; baseDy: number } | null>(null)

  const scale = displaySize.w > 0 ? displaySize.w / imageNaturalSize.w : 1

  const validBlocks = blocks
    .map((block, index) => ({ block, index }))
    .filter(o => o.block.xyxy?.length === 4 && (o.block.xyxy[2] - o.block.xyxy[0]) > 0)

  /** Pad a block bbox a little so stroke/anti-aliasing spillover is captured. */
  const bbox = useCallback((b: EditableTextBlock) => {
    const [x1, y1, x2, y2] = b.xyxy
    const pad = Math.max(2, Math.round((b.font_size || 16) * 0.18))
    return {
      x: Math.max(0, Math.floor(x1 - pad)),
      y: Math.max(0, Math.floor(y1 - pad)),
      w: Math.ceil((x2 - x1) + pad * 2),
      h: Math.ceil((y2 - y1) + pad * 2),
    }
  }, [])

  // Persistent scratch canvas for capturing block pixels (avoid GC churn).
  const snapRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | undefined>(undefined)

  /** Repaint the visible canvas from the two source images + current offsets.
   *  Cheap: a few drawImage calls per offset block. Called via rAF so rapid
   *  drag moves coalesce into one frame. */
  const paint = useCallback(() => {
    const canvas = canvasRef.current
    const inpainted = inpaintedImgRef.current
    const rendered = renderedImgRef.current
    if (!canvas || !inpainted || !rendered || !sourcesReady) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { w: nw, h: nh } = imageNaturalSize
    // Keep the backing store at natural size (setting w/h clears the canvas).
    if (canvas.width !== nw || canvas.height !== nh) {
      canvas.width = nw
      canvas.height = nh
    }

    // Start from the default render (all text at original positions).
    ctx.drawImage(rendered, 0, 0)

    if (!snapRef.current) snapRef.current = document.createElement('canvas')
    const snap = snapRef.current
    const sctx = snap.getContext('2d')
    if (!sctx) return

    // Move each offset block: erase-in-place then stamp at offset position.
    for (const { block, index } of validBlocks) {
      const [dx, dy] = offsets[index] ?? [0, 0]
      if (dx === 0 && dy === 0) continue
      const r = bbox(block)
      const capX = Math.min(r.x, nw - 1)
      const capY = Math.min(r.y, nh - 1)
      const capW = Math.max(1, Math.min(r.w, nw - capX))
      const capH = Math.max(1, Math.min(r.h, nh - capY))
      if (snap.width !== capW || snap.height !== capH) {
        snap.width = capW
        snap.height = capH
      }
      // 1. capture rendered pixels at original bbox.
      sctx.clearRect(0, 0, capW, capH)
      sctx.drawImage(canvas, capX, capY, capW, capH, 0, 0, capW, capH)
      // 2. erase in place from the clean inpainted image.
      ctx.drawImage(inpainted, capX, capY, capW, capH, capX, capY, capW, capH)
      // 3. stamp captured pixels at the offset position.
      ctx.drawImage(snap, 0, 0, capW, capH, Math.round(capX + dx), Math.round(capY + dy), capW, capH)
    }
  }, [bbox, offsets, validBlocks, imageNaturalSize, sourcesReady])

  // Repaint via rAF so rapid offset updates (drag) coalesce into one frame.
  useEffect(() => {
    if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => paint())
    return () => { if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current) }
  }, [paint])

  // Load the clean inpainted base (changes only on page switch).
  useEffect(() => {
    let cancelled = false
    const inp = new Image()
    inp.onload = () => { if (!cancelled) { inpaintedImgRef.current = inp; setInpaintedReady(true) } }
    inp.src = inpaintedUrl
    return () => { cancelled = true; setInpaintedReady(false) }
  }, [inpaintedUrl])

  // Load the rendered default embedding (changes on first render and on text edits).
  useEffect(() => {
    let cancelled = false
    const rnd = new Image()
    rnd.onload = () => { if (!cancelled) { renderedImgRef.current = rnd; setRenderedReady(true) } }
    rnd.src = renderedUrl
    return () => { cancelled = true; setRenderedReady(false) }
  }, [renderedUrl])


  const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    setDisplaySize({ w: img.clientWidth, h: img.clientHeight })
  }, [])

  // Use the rendered image (not inpainted) as the layout/sizing element so the
  // canvas overlay matches the visible picture dimensions. The canvas paints
  // on top; the <img> is just for sizing and as a hidden fallback.
  const handleMouseDown = useCallback((e: React.MouseEvent, idx: number) => {
    e.preventDefault()
    e.stopPropagation()
    const [dx, dy] = offsets[idx] ?? [0, 0]
    setDragging({ idx, startX: e.clientX, startY: e.clientY, baseDx: dx, baseDy: dy })
    onSelect(idx)
  }, [offsets, onSelect])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return
    const deltaPxX = (e.clientX - dragging.startX) / scale
    const deltaPxY = (e.clientY - dragging.startY) / scale
    onOffsetChange(dragging.idx, Math.round(dragging.baseDx + deltaPxX), Math.round(dragging.baseDy + deltaPxY))
  }, [dragging, scale, onOffsetChange])

  const handleMouseUp = useCallback(() => {
    if (dragging) onDragEnd()
    setDragging(null)
  }, [dragging, onDragEnd])

  return (
    <div
      className="relative inline-block w-full"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onClick={() => onSelect(null)}
    >
      {/* Sizing element (hidden visually, drives layout + onLoad). */}
      <img
        src={renderedUrl}
        alt="嵌字预览"
        className="w-full block"
        onLoad={onImageLoad}
        draggable={false}
        style={{ visibility: sourcesReady ? 'hidden' : 'visible' }}
      />
      {/* The composited picture. */}
      {displaySize.w > 0 && (
        <canvas
          ref={canvasRef}
          className="absolute inset-0"
          width={imageNaturalSize.w}
          height={imageNaturalSize.h}
          style={{ width: displaySize.w, height: displaySize.h, pointerEvents: 'none', visibility: sourcesReady ? 'visible' : 'hidden' }}
        />
      )}
      {/* Drag handles + selection overlay. */}
      {displaySize.w > 0 && (
        <svg className="absolute inset-0" width={displaySize.w} height={displaySize.h} style={{ pointerEvents: 'none' }}>
          {validBlocks.map(({ block, index }) => {
            const [x1, y1, x2, y2] = block.xyxy
            const [dx, dy] = offsets[index] ?? [0, 0]
            const isSel = selectedIdx === index
            const x = (x1 + dx) * scale
            const y = (y1 + dy) * scale
            const w = (x2 - x1) * scale
            const h = (y2 - y1) * scale
            return (
              <g key={index} style={{ pointerEvents: 'auto', cursor: 'move' }} onMouseDown={(e) => handleMouseDown(e, index)}>
                <rect
                  x={x} y={y} width={w} height={h}
                  fill={isSel ? 'rgba(99,102,241,0.10)' : 'transparent'}
                  stroke={isSel ? '#6366f1' : 'rgba(99,102,241,0.45)'}
                  strokeWidth={isSel ? 2 : 1}
                  strokeDasharray={isSel ? '0' : '4 3'}
                  rx={2}
                />
                <rect x={x} y={Math.max(0, y - 13)} width={18} height={11} fill={isSel ? '#6366f1' : 'rgba(99,102,241,0.6)'} rx={2} />
                <text x={x + 9} y={Math.max(7, y - 4)} fill="white" fontSize={8} textAnchor="middle" style={{ pointerEvents: 'none', userSelect: 'none' }}>
                  {index + 1}
                </text>
                {(dx !== 0 || dy !== 0) && (
                  <text x={x + w + 3} y={y + 10} fill="#f59e0b" fontSize={9} fontWeight="bold" style={{ pointerEvents: 'none', userSelect: 'none' }}>
                    {dx >= 0 ? '+' : ''}{dx},{dy >= 0 ? '+' : ''}{dy}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      )}
      {rendering && (
        <div className="absolute right-2 top-2 flex items-center gap-1 rounded bg-slate-900/70 px-2 py-0.5 text-[10px] text-white">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />重新渲染中
        </div>
      )}
    </div>
  )
}
