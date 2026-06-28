import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle, XCircle, Clock, Loader2, ChevronRight, ChevronDown, ChevronUp, Square, Trash2, FolderOpen, FileText, Edit3 } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { useTaskProgress } from '@/hooks/useTaskProgress'
import { cancelTask, deleteTask, type Task, type TaskStatus, type PageStatus } from '@/lib/api'

const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: '等待中', detecting: '检测文字', ocr: '识别文字',
  translating: '翻译中', polishing: '润色中', inpainting: '修复图像',
  rendering: '渲染文字', awaiting_edit: '待编辑', done: '已完成', failed: '失败', cancelled: '已取消',
}

const PAGE_STATUS_LABELS: Record<PageStatus, string> = {
  pending: '排队中', processing: '处理中', awaiting_edit: '可编辑', done: '已完成', failed: '失败',
}

function StatusBadge({ status }: { status: TaskStatus }) {
  const base = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium'
  if (status === 'done') return <span className={`${base} bg-green-100 text-green-700`}><CheckCircle className="h-3 w-3" />已完成</span>
  if (status === 'cancelled') return <span className={`${base} bg-slate-200 text-slate-500`}><XCircle className="h-3 w-3" />已取消</span>
  if (status === 'failed') return <span className={`${base} bg-red-100 text-red-700`}><XCircle className="h-3 w-3" />失败</span>
  if (status === 'pending') return <span className={`${base} bg-slate-100 text-slate-600`}><Clock className="h-3 w-3" />等待中</span>
  if (status === 'awaiting_edit') return <span className={`${base} bg-amber-100 text-amber-700`}><Edit3 className="h-3 w-3" />待编辑</span>
  return <span className={`${base} bg-blue-100 text-blue-700`}><Loader2 className="h-3 w-3 animate-spin" />运行中</span>
}

function PageStatusIcon({ status }: { status: PageStatus }) {
  if (status === 'done') return <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
  if (status === 'failed') return <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
  if (status === 'awaiting_edit') return <Edit3 className="h-3.5 w-3.5 text-amber-500 shrink-0" />
  if (status === 'processing') return <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin shrink-0" />
  return <Clock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
}

interface TaskCardProps {
  task: Task
  onChanged?: () => void
}
export function TaskCard({ task, onChanged }: TaskCardProps) {
  const isTerminal = task.status === 'done' || task.status === 'failed' || task.status === 'cancelled'
  const isAwaitingEdit = task.status === 'awaiting_edit'
  const isRunning = !isTerminal && !isAwaitingEdit
  const skipProgress = isTerminal || isAwaitingEdit
  const progress = useTaskProgress(task.id, skipProgress)
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const status = skipProgress ? task.status : progress.state
  const pct = isTerminal ? (task.status === 'done' ? 100 : 0) : (isAwaitingEdit ? 82 : progress.progress_pct)
  const message = skipProgress
    ? (task.status === 'done' ? '完成'
      : task.status === 'cancelled' ? '已取消'
      : isAwaitingEdit ? '等待编辑翻译'
      : task.error ?? '失败')
    : progress.message_cn

  const filename = task.pages[0]?.filename ?? '未知文件'
  const isArchive = task.pages.length > 1
  const createdAt = new Date(task.created_at).toLocaleString('zh-CN')

  // Count pages by status for the folder summary
  const readyCount = task.pages.filter(p => p.status === 'awaiting_edit').length
  const doneCount = task.pages.filter(p => p.status === 'done').length

  async function handleCancel() {
    setBusy(true)
    try { await cancelTask(task.id); onChanged?.() } catch { /* ignore */ }
    setBusy(false)
  }

  async function handleDelete() {
    setBusy(true)
    try { await deleteTask(task.id); onChanged?.() } catch { /* ignore */ }
    setBusy(false)
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 shadow-sm transition-all hover:shadow-md hover:border-slate-300">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {isArchive && (
              <button onClick={() => setExpanded(!expanded)} className="text-slate-400 hover:text-slate-700 shrink-0">
                {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
            )}
            {isArchive
              ? <FolderOpen className="h-4 w-4 text-amber-500 shrink-0" />
              : <FileText className="h-4 w-4 text-slate-400 shrink-0" />
            }
            <p className="truncate text-sm font-medium text-slate-900">
              {isArchive ? `${task.pages.length} 张图片` : filename}
            </p>
          </div>
          <p className="text-xs text-slate-400 pl-6">{createdAt}</p>
          {isArchive && (
            <p className="text-xs text-slate-400 pl-6">
              {readyCount > 0 && <span className="text-amber-600">{readyCount} 页可编辑</span>}
              {readyCount > 0 && doneCount > 0 && ' · '}
              {doneCount > 0 && <span className="text-green-600">{doneCount} 页完成</span>}
              {readyCount === 0 && doneCount === 0 && `${task.pages.length} 页处理中`}
            </p>
          )}
        </div>
        <StatusBadge status={status} />
      </div>

      {isRunning && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-slate-500">
            <span>{STATUS_LABELS[status] ?? message}</span>
            <span>{pct}%</span>
          </div>
          <Progress value={pct} />
        </div>
      )}

      {isAwaitingEdit && !isArchive && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-slate-500">
            <span>等待编辑翻译</span>
            <span>82%</span>
          </div>
          <Progress value={82} />
        </div>
      )}

      {isAwaitingEdit && isArchive && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-slate-500">
            <span>{readyCount} 页可编辑，点击展开查看</span>
            <span>{doneCount}/{task.pages.length} 完成</span>
          </div>
          <Progress value={Math.round((doneCount / task.pages.length) * 100)} />
        </div>
      )}

      {task.status === 'failed' && task.error && (
        <p className="text-xs text-red-500 truncate">{task.error}</p>
      )}

      {/* Expanded folder: list each page with its status and edit link */}
      {isArchive && expanded && (
        <div className="rounded-lg border border-slate-100 bg-slate-50 divide-y divide-slate-100">
          {task.pages.map((pg, i) => {
            const canEdit = pg.status === 'awaiting_edit'
            const canView = pg.status === 'done'
            return (
              <div key={i} className="flex items-center gap-2 px-3 py-2 text-sm">
                <PageStatusIcon status={pg.status} />
                <span className="truncate flex-1 text-slate-700">{pg.filename}</span>
                <span className="text-xs text-slate-400 shrink-0">{PAGE_STATUS_LABELS[pg.status]}</span>
                {(canEdit || canView) && (
                  <Link
                    to={`/tasks/${task.id}?page=${i}`}
                    className="flex items-center gap-0.5 text-xs font-medium text-slate-700 hover:text-slate-900 shrink-0"
                  >
                    {canEdit ? '编辑' : '查看'} <ChevronRight className="h-3 w-3" />
                  </Link>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="flex items-center justify-between">
        {!isArchive && (task.status === 'done' || isAwaitingEdit) ? (
          <Link
            to={`/tasks/${task.id}`}
            className="flex items-center gap-1 text-sm font-medium text-slate-700 hover:text-slate-900"
          >
            {isAwaitingEdit ? '编辑翻译' : '查看结果'} <ChevronRight className="h-4 w-4" />
          </Link>
        ) : isArchive && (isAwaitingEdit || isTerminal) ? (
          <Link
            to={`/tasks/${task.id}`}
            className="flex items-center gap-1 text-sm font-medium text-slate-700 hover:text-slate-900"
          >
            打开 <ChevronRight className="h-4 w-4" />
          </Link>
        ) : <span />}

        <div className="flex items-center gap-2">
          {isRunning && (
            <button
              onClick={handleCancel}
              disabled={busy}
              className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              <Square className="h-3 w-3" />终止
            </button>
          )}
          <button
            onClick={handleDelete}
            disabled={busy}
            className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-400 hover:border-red-200 hover:text-red-500 disabled:opacity-50"
          >
            <Trash2 className="h-3 w-3" />删除
          </button>
        </div>
      </div>
    </div>
  )
}
