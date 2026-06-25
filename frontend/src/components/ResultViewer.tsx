import { useState } from 'react'
import { ReactCompareSlider, ReactCompareSliderImage } from 'react-compare-slider'
import { Maximize2, X } from 'lucide-react'
import type { TextBlockResult } from '@/lib/api'

interface ResultViewerProps {
  originalUrl: string
  resultUrl: string
  textBlocks: TextBlockResult[]
}

export function ResultViewer({ originalUrl, resultUrl, textBlocks }: ResultViewerProps) {
  const [lightbox, setLightbox] = useState(false)

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-lg border border-slate-200">
        <ReactCompareSlider
          style={{ width: '100%' }}
          itemOne={<ReactCompareSliderImage src={originalUrl} alt="原图" style={{ objectFit: 'contain' }} />}
          itemTwo={<ReactCompareSliderImage src={resultUrl} alt="译图" style={{ objectFit: 'contain' }} />}
        />
        <div className="flex justify-between bg-slate-50 px-3 py-1.5 text-xs text-slate-500">
          <span>← 擦字图</span>
          <span>译图 →</span>
        </div>
        <button
          onClick={() => setLightbox(true)}
          className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-xs text-white backdrop-blur hover:bg-black/80"
        >
          <Maximize2 className="h-3 w-3" />查看大图
        </button>
      </div>

      {textBlocks.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">文字块对比（{textBlocks.length} 个）</h2>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">原文</th>
                  <th className="px-4 py-2 text-left font-medium">初翻</th>
                  <th className="px-4 py-2 text-left font-medium">润色后</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {textBlocks.map((b, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-2 text-slate-600">{b.original_text || '—'}</td>
                    <td className="px-4 py-2 text-slate-600">{b.translated_text || '—'}</td>
                    <td className="px-4 py-2 text-slate-900 font-medium">{b.polished_text || b.translated_text || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setLightbox(false)}
        >
          <button
            onClick={() => setLightbox(false)}
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={resultUrl}
            alt="译图大图"
            className="max-h-full max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
