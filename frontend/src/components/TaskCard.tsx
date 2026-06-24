import { Link } from 'react-router-dom'
import { CheckCircle, XCircle, Clock, Loader2, ChevronRight } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { useTaskProgress } from '@/hooks/useTaskProgress'
import type { Task, TaskStatus } from '@/lib/api'

const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: '等待中', detecting: '检测文字', ocr: '识别文字',
  translating: '翻译中', polishing: '润色中', inpainting: '修复图像',
  rendering: '渲染文字', done: '已完成', failed: '失败',
}

function StatusBadge({ status }: { status: TaskStatus }) {
  const base = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium'
  if (status === 'done') return <span className={`${base} bg-green-100 text-green-700`}><CheckCircle className="h-3 w-3" />已完成</span>
  if (status === 'failed') return <span className={`${base} bg-red-100 text-red-700`}><XCircle className="h-3 w-3" />失败</span>
  if (status === 'pending') return <span className={`${base} bg-slate-100 text-slate-600`}><Clock className="h-3 w-3" />等待中</span>
  return <span className={`${base} bg-blue-100 text-blue-700`}><Loader2 className="h-3 w-3 animate-spin" />运行中</span>
}

interface TaskCardProps {
  task: Task
}

export function TaskCard({ task }: TaskCardProps) {
  const isTerminal = task.status === 'done' || task.status === 'failed'
  const progress = useTaskProgress(task.id, isTerminal)

  const status = isTerminal ? task.status : progress.state
  const pct = isTerminal ? (task.status === 'done' ? 100 : 0) : progress.progress_pct
  const message = isTerminal
    ? (task.status === 'done' ? '完成' : task.error ?? '失败')
    : progress.message_cn

  const filename = task.pages[0]?.filename ?? '未知文件'
  const createdAt = new Date(task.created_at).toLocaleString('zh-CN')

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-900">{filename}</p>
          <p className="text-xs text-slate-400">{createdAt}</p>
        </div>
        <StatusBadge status={status} />
      </div>

      {!isTerminal && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-slate-500">
            <span>{STATUS_LABELS[status] ?? message}</span>
            <span>{pct}%</span>
          </div>
          <Progress value={pct} />
        </div>
      )}

      {task.status === 'failed' && task.error && (
        <p className="text-xs text-red-500 truncate">{task.error}</p>
      )}

      {task.status === 'done' && (
        <Link
          to={`/tasks/${task.id}`}
          className="flex items-center gap-1 text-sm font-medium text-slate-700 hover:text-slate-900"
        >
          查看结果 <ChevronRight className="h-4 w-4" />
        </Link>
      )}
    </div>
  )
}
