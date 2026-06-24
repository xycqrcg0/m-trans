import { ReactCompareSlider, ReactCompareSliderImage } from 'react-compare-slider'
import type { TextBlockResult } from '@/lib/api'

interface ResultViewerProps {
  originalUrl: string
  resultUrl: string
  textBlocks: TextBlockResult[]
}

export function ResultViewer({ originalUrl, resultUrl, textBlocks }: ResultViewerProps) {
  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-lg border border-slate-200">
        <ReactCompareSlider
          itemOne={<ReactCompareSliderImage src={originalUrl} alt="原图" />}
          itemTwo={<ReactCompareSliderImage src={resultUrl} alt="译图" />}
          style={{ maxHeight: 600 }}
        />
        <div className="flex justify-between bg-slate-50 px-3 py-1.5 text-xs text-slate-500">
          <span>← 原图</span>
          <span>译图 →</span>
        </div>
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
    </div>
  )
}
