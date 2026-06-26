import { useState, useRef, useCallback } from 'react'
import type { EditableTextBlock } from '@/lib/api'

interface PositionOverlayProps {
  imageUrl: string
  blocks: EditableTextBlock[]
  offsets: Record<number, [number, number]>
  textEdits: Record<number, string>
  selectedIdx: number | null
  onSelect: (idx: number | null) => void
  onOffsetChange: (idx: number, dx: number, dy: number) => void
  imageNaturalSize: { w: number; h: number }
}

/**
 * Simulate the backend's font shrink-to-fit logic.
 * Backend: starts with region.font_size, shrinks by 0.9x until text fits
 * max_width * max_lines, min 8px.
 */
function calcPreviewFontSize(text: string, fontSize: number, boxW: number, boxH: number): number {
  if (!text || fontSize <= 0) return 12
  let fs = fontSize
  const minFs = 8
  // Approximate: each CJK char is ~1.0 * fs wide, latin ~0.6 * fs
  const charWidth = text.match(/[\u4e00-\u9fff\u3000-\u30ff]/) ? fs : fs * 0.6
  const textWidth = text.length * charWidth
  while (fs > minFs) {
    const maxLines = Math.max(1, Math.floor(boxH / fs))
    const maxW = boxW * maxLines
    if (maxW >= textWidth) break
    fs = Math.max(Math.floor(fs * 0.9), minFs)
  }
  return fs
}

function rgbStr(c: number[]): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

export function PositionOverlay({
  imageUrl,
  blocks,
  offsets,
  textEdits,
  selectedIdx,
  onSelect,
  onOffsetChange,
  imageNaturalSize,
}: PositionOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 })
  const [dragging, setDragging] = useState<{ idx: number; startX: number; startY: number; baseDx: number; baseDy: number } | null>(null)

  const scale = displaySize.w > 0 ? displaySize.w / imageNaturalSize.w : 1

  const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    setDisplaySize({ w: img.clientWidth, h: img.clientHeight })
  }, [])

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

  const handleMouseUp = useCallback(() => setDragging(null), [])

  const validBlocks = blocks
    .map((block, index) => ({ block, index }))
    .filter(o => o.block.xyxy?.length === 4 && (o.block.xyxy[2] - o.block.xyxy[0]) > 0)

  return (
    <div
      ref={containerRef}
      className="relative inline-block w-full"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onClick={() => onSelect(null)}
    >
      <img src={imageUrl} alt="擦字图" className="w-full block" onLoad={onImageLoad} draggable={false} />
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
            const previewText = textEdits[index] ?? (block.polished_text || block.translated_text) ?? ''
            // Calculate preview font size: simulate backend shrink-to-fit
            const natFontSize = block.font_size > 0 ? block.font_size : 16
            const boxWNat = x2 - x1
            const boxHNat = y2 - y1
            const natFs = calcPreviewFontSize(previewText, natFontSize, boxWNat, boxHNat)
            const dispFs = natFs * scale
            const fg = rgbStr(block.fg_color)
            // Background/stroke color — use bg_color for text stroke
            const stroke = rgbStr(block.bg_color)
            const strokeW = Math.max(1, dispFs * 0.12)

            return (
              <g key={index} style={{ pointerEvents: 'auto', cursor: 'move' }} onMouseDown={(e) => handleMouseDown(e, index)}>
                {/* Box outline */}
                <rect
                  x={x} y={y} width={w} height={h}
                  fill={isSel ? 'rgba(99,102,241,0.08)' : 'transparent'}
                  stroke={isSel ? '#6366f1' : 'rgba(99,102,241,0.4)'}
                  strokeWidth={isSel ? 2 : 1}
                  strokeDasharray={isSel ? '0' : '3 2'}
                  rx={2}
                />
                {/* WYSIWYG text preview using foreignObject */}
                {previewText && (
                  <foreignObject x={x + 1} y={y + 1} width={Math.max(w - 2, 1)} height={Math.max(h - 2, 1)}>
                    <div style={{
                      width: '100%', height: '100%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      textAlign: 'center', overflow: 'hidden',
                      fontSize: `${dispFs}px`, lineHeight: 1.15,
                      color: fg, wordBreak: 'break-all',
                      padding: '2px', userSelect: 'none',
                      fontFamily: 'sans-serif', fontWeight: 500,
                      // Simulate text stroke (border) like the renderer
                      WebkitTextStroke: `${strokeW}px ${stroke}`,
                      paintOrder: 'stroke',
                    }}>
                      {previewText}
                    </div>
                  </foreignObject>
                )}
                {/* Index label */}
                <rect x={x} y={Math.max(0, y - 13)} width={18} height={11} fill={isSel ? '#6366f1' : 'rgba(99,102,241,0.6)'} rx={2} />
                <text x={x + 9} y={Math.max(7, y - 4)} fill="white" fontSize={8} textAnchor="middle" style={{ pointerEvents: 'none', userSelect: 'none' }}>
                  {index + 1}
                </text>
                {/* Offset indicator */}
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
    </div>
  )
}
