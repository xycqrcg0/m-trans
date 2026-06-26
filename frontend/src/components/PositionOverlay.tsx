import { useState, useRef, useCallback } from 'react'
import type { EditableTextBlock } from '@/lib/api'

interface BlockOverlay {
  block: EditableTextBlock
  index: number
}

interface PositionOverlayProps {
  imageUrl: string
  blocks: EditableTextBlock[]
  offsets: Record<number, [number, number]>
  selectedIdx: number | null
  onSelect: (idx: number | null) => void
  onOffsetChange: (idx: number, dx: number, dy: number) => void
  imageNaturalSize: { w: number; h: number }
}

export function PositionOverlay({
  imageUrl,
  blocks,
  offsets,
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

  const handleMouseUp = useCallback(() => {
    setDragging(null)
  }, [])

  // Build overlays from blocks
  const overlays: BlockOverlay[] = blocks
    .map((block, index) => ({ block, index }))
    .filter(o => o.block.xyxy && o.block.xyxy.length === 4 && (o.block.xyxy[2] - o.block.xyxy[0]) > 0)

  return (
    <div
      ref={containerRef}
      className="relative inline-block w-full"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onClick={() => onSelect(null)}
    >
      <img
        src={imageUrl}
        alt="擦字图"
        className="w-full block"
        onLoad={onImageLoad}
        draggable={false}
      />
      {displaySize.w > 0 && (
        <svg
          className="absolute inset-0"
          width={displaySize.w}
          height={displaySize.h}
          style={{ pointerEvents: 'none' }}
        >
          {overlays.map(({ block, index }) => {
            const [x1, y1, x2, y2] = block.xyxy
            const [dx, dy] = offsets[index] ?? [0, 0]
            const isSel = selectedIdx === index
            const x = (x1 + dx) * scale
            const y = (y1 + dy) * scale
            const w = (x2 - x1) * scale
            const h = (y2 - y1) * scale
            return (
              <g key={index} style={{ pointerEvents: 'auto', cursor: 'move' }}
                onMouseDown={(e) => handleMouseDown(e, index)}
              >
                <rect
                  x={x} y={y} width={w} height={h}
                  fill={isSel ? 'rgba(99,102,241,0.15)' : 'rgba(0,0,0,0.05)'}
                  stroke={isSel ? '#6366f1' : 'rgba(99,102,241,0.4)'}
                  strokeWidth={isSel ? 2 : 1}
                  strokeDasharray={isSel ? '0' : '4 2'}
                  rx={2}
                />
                {/* Label */}
                <rect
                  x={x} y={Math.max(0, y - 16)} width={24} height={14}
                  fill={isSel ? '#6366f1' : 'rgba(99,102,241,0.6)'}
                  rx={2}
                />
                <text
                  x={x + 12} y={Math.max(10, y - 5)}
                  fill="white" fontSize={10} textAnchor="middle"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {index + 1}
                </text>
                {/* Offset indicator */}
                {(dx !== 0 || dy !== 0) && (
                  <text
                    x={x + w + 4} y={y + 12}
                    fill="#f59e0b" fontSize={10}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
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
