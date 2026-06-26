import { useEffect, useState, useCallback, useRef } from 'react'
import { RefreshCw, Trash2, FileText, Loader2 } from 'lucide-react'
import { listLogs, readLog, deleteLog, type LogFile } from '@/lib/api'

export default function Logs() {
  const [files, setFiles] = useState<LogFile[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingContent, setLoadingContent] = useState(false)
  const [tail, setTail] = useState(500)
  const [error, setError] = useState<string | null>(null)
  const logRef = useRef<HTMLPreElement>(null)
  const loadFiles = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listLogs()
      setFiles(res.files)
      if (res.files.length > 0 && !selected) {
        setSelected(res.files[0].name)
      }
    } catch {
      setError('加载日志列表失败')
    } finally {
      setLoading(false)
    }
  }, [selected])

  const loadContent = useCallback(async () => {
    if (!selected) return
    setLoadingContent(true)
    setError(null)
    try {
      const res = await readLog(selected, tail)
      setContent(res.content || '(空)')
    } catch {
      setError('读取日志内容失败')
      setContent('')
    } finally {
      setLoadingContent(false)
    }
  }, [selected, tail])

  // Auto-scroll to bottom (newest logs) when content changes
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [content])

  useEffect(() => { loadFiles() }, [loadFiles])
  useEffect(() => { if (selected) loadContent() }, [loadContent])

  async function handleDelete(name: string) {
    try {
      await deleteLog(name)
      if (selected === name) {
        setSelected(null)
        setContent('')
      }
      await loadFiles()
    } catch { /* ignore */ }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">系统日志</h1>
        <button
          onClick={() => { loadFiles(); if (selected) loadContent() }}
          className="flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50"
        >
          <RefreshCw className="h-4 w-4" />刷新
        </button>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      )}

      <div className="grid gap-4 md:grid-cols-[200px_1fr]">
        {/* File list */}
        <div className="space-y-1">
          {loading ? (
            <p className="py-4 text-center text-sm text-slate-400">加载中…</p>
          ) : files.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">暂无日志文件</p>
          ) : (
            files.map((f) => (
              <div
                key={f.name}
                onClick={() => setSelected(f.name)}
                className={`group flex cursor-pointer items-center gap-2 rounded-md border p-2 transition-colors ${
                  selected === f.name ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <FileText className="h-4 w-4 shrink-0 opacity-70" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{f.name}</p>
                  <p className={`text-xs ${selected === f.name ? 'text-slate-300' : 'text-slate-400'}`}>
                    {f.size_human} · {f.modified}
                  </p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(f.name) }}
                  className={`shrink-0 opacity-0 group-hover:opacity-100 ${selected === f.name ? 'text-slate-300 hover:text-red-300' : 'text-slate-400 hover:text-red-500'}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Log content */}
        <div className="space-y-2">
          {selected && (
            <div className="flex items-center gap-3">
              <select
                value={tail}
                onChange={(e) => setTail(Number(e.target.value))}
                className="rounded-md border border-slate-200 px-2 py-1 text-sm"
              >
                <option value={200}>最近 200 行</option>
                <option value={500}>最近 500 行</option>
                <option value={1000}>最近 1000 行</option>
                <option value={5000}>最近 5000 行</option>
              </select>
              {loadingContent && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
            </div>
          )}
          {selected ? (
            <pre ref={logRef} className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-slate-900 p-4 text-xs leading-relaxed text-slate-300">
              {content || '(空)'}
            </pre>
          ) : (
            <div className="flex h-48 items-center justify-center rounded-lg border border-slate-200 text-sm text-slate-400">
              选择左侧日志文件查看内容
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
