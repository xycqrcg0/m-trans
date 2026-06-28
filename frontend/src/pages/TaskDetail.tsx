import { useEffect, useState } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Download, ChevronLeft, ChevronRight, Loader2, CheckCircle, XCircle, Clock, Edit3 } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { getTask, getResultUrl, getInpaintedUrl, getDownloadAllUrl, type Task, type PageStatus } from '@/lib/api'
import { ResultViewer } from '@/components/ResultViewer'
import { TranslationEditor } from '@/components/TranslationEditor'
import { useTaskProgress } from '@/hooks/useTaskProgress'

const PAGE_STATUS_LABELS: Record<PageStatus, string> = {
  pending: '排队中', processing: '处理中', awaiting_edit: '可编辑', done: '已完成', failed: '失败',
}

function PageStatusIcon({ status }: { status: PageStatus }) {
  if (status === 'done') return <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
  if (status === 'failed') return <XCircle className="h-4 w-4 text-red-500 shrink-0" />
  if (status === 'awaiting_edit') return <Edit3 className="h-4 w-4 text-amber-500 shrink-0" />
  if (status === 'processing') return <Loader2 className="h-4 w-4 text-blue-500 animate-spin shrink-0" />
  return <Clock className="h-4 w-4 text-slate-400 shrink-0" />
}

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const [task, setTask] = useState<Task | null>(null)
  const [error, setError] = useState<string | null>(null)

  const taskId = id ?? ''
  // page index from ?page=N (0-based), default 0
  const pageIdx = Math.max(0, Math.min((task?.pages.length ?? 1) - 1, parseInt(searchParams.get('page') ?? '0', 10) || 0))

  function setPageIdx(i: number) {
    setSearchParams(prev => { prev.set('page', String(i)); return prev })
  }

  function refresh() {
    if (!taskId) return
    getTask(taskId).then(setTask).catch(() => setError('加载任务失败'))
  }

  useEffect(() => { refresh() }, [taskId])

  // Subscribe to live progress while the task isn't fully done, so pages
  // transition into awaiting_edit/done automatically.
  const isFullyDone = !!task && task.status === 'done'
  const isFullyFailed = !!task && task.status === 'failed'
  const skipProgress = isFullyDone || isFullyFailed
  const progress = useTaskProgress(taskId, skipProgress)
  useEffect(() => {
    if (['awaiting_edit', 'done', 'failed', 'cancelled'].includes(progress.state)) {
      refresh()
    }
  }, [progress.state])

  if (error) return (
    <div className="p-6 text-center text-sm text-red-500">{error}</div>
  )

  if (!task) return (
    <div className="p-6 text-center text-sm text-slate-400">加载中…</div>
  )

  const totalPages = task.pages.length
  const page = task.pages[pageIdx]

  // If the task is still running (no page ready yet), show progress
  const hasReadyPage = task.pages.some(p => p.status === 'awaiting_edit' || p.status === 'done')
  if (!hasReadyPage && task.status !== 'done') {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Link to="/tasks" className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" />返回任务列表
        </Link>
        <div className="mt-8 space-y-3 text-center">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-indigo-500" />
          <p className="text-sm text-slate-600">{progress.message_cn || `任务处理中（${task.status}）`}</p>
          <Progress value={progress.progress_pct} />
          <p className="text-xs text-slate-400">{progress.progress_pct}%</p>
          <p className="text-xs text-slate-400">页面处理完成后将自动进入编辑</p>
        </div>
      </div>
    )
  }

  // Page navigation with per-page status
  const PageNav = () => totalPages > 1 ? (
    <div className="flex items-center justify-center gap-2 flex-wrap">
      <button
        onClick={() => setPageIdx(Math.max(0, pageIdx - 1))}
        disabled={pageIdx === 0}
        className="rounded-md border border-slate-200 p-1.5 disabled:opacity-30 hover:bg-slate-50"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      {task.pages.map((pg, i) => (
        <button
          key={i}
          onClick={() => setPageIdx(i)}
          className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
            i === pageIdx ? 'bg-slate-900 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
          title={pg.filename}
        >
          <span className={i === pageIdx ? 'text-white' : ''}>
            <PageStatusIcon status={pg.status} />
          </span>
          {i + 1}
        </button>
      ))}
      <button
        onClick={() => setPageIdx(Math.min(totalPages - 1, pageIdx + 1))}
        disabled={pageIdx === totalPages - 1}
        className="rounded-md border border-slate-200 p-1.5 disabled:opacity-30 hover:bg-slate-50"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  ) : null

  // awaiting_edit page: show editor
  if (page?.status === 'awaiting_edit') {
    return (
      <div className="mx-auto max-w-4xl space-y-5 p-6">
        <Link to="/tasks" className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" />返回任务列表
        </Link>

        <div>
          <h1 className="text-xl font-bold text-slate-900 truncate">{page?.filename ?? task.id}</h1>
          {totalPages > 1 && <p className="text-xs text-slate-400">第 {pageIdx + 1} / {totalPages} 页</p>}
          <p className="text-xs text-slate-400">
            翻译和擦字已完成，请检查并修改译文，然后点击提交进行嵌字渲染
          </p>
        </div>

        <PageNav />

        <TranslationEditor taskId={task.id} pageIndex={pageIdx} onCompleted={refresh} />
      </div>
    )
  }

  // done page: show result
  if (page?.status === 'done' || task.status === 'done') {
    const resultUrl = getResultUrl(task.id, pageIdx + 1)
    const inpaintedUrl = getInpaintedUrl(task.id, pageIdx + 1)

    return (
      <div className="mx-auto max-w-3xl space-y-5 p-6">
        <div className="flex items-center justify-between">
          <Link to="/tasks" className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">
            <ArrowLeft className="h-4 w-4" />返回
          </Link>
          <div className="flex items-center gap-2">
            {totalPages > 1 && (
              <>
                <a
                  href={getDownloadAllUrl(task.id, "cbz")}
                  className="flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                >
                  <Download className="h-4 w-4" />下载全部 (CBZ)
                </a>
                <a
                  href={getDownloadAllUrl(task.id, "zip")}
                  className="flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                >
                  <Download className="h-4 w-4" />下载全部 (ZIP)
                </a>
              </>
            )}
            <a
              href={resultUrl}
              download={`translated_${task.id}_p${pageIdx + 1}.png`}
              className="flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700"
            >
              <Download className="h-4 w-4" />下载本页
            </a>
          </div>
        </div>

        <div>
          <h1 className="text-xl font-bold text-slate-900 truncate">{page?.filename ?? task.id}</h1>
          <p className="text-xs text-slate-400">{new Date(task.created_at).toLocaleString('zh-CN')}</p>
        </div>

        <PageNav />

        <ResultViewer
          originalUrl={inpaintedUrl}
          resultUrl={resultUrl}
          textBlocks={page?.text_blocks ?? []}
        />
      </div>
    )
  }

  // Page is processing/pending — show waiting state
  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6">
      <Link to="/tasks" className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" />返回任务列表
      </Link>
      <div>
        <h1 className="text-xl font-bold text-slate-900 truncate">{page?.filename ?? task.id}</h1>
        {totalPages > 1 && <p className="text-xs text-slate-400">第 {pageIdx + 1} / {totalPages} 页</p>}
      </div>
      <PageNav />
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
        <p className="text-sm text-slate-500">
          {page ? `此页${PAGE_STATUS_LABELS[page.status]}…` : '加载中…'}
        </p>
        <p className="text-xs text-slate-400">可点击上方页码切换到已完成的页面</p>
      </div>
    </div>
  )
}
