import { useState, useEffect, useRef } from 'react'
import { subscribeProgress, getTask, type ProgressEvent, type TaskStatus } from '@/lib/api'

export interface TaskProgressState {
  state: TaskStatus
  progress_pct: number
  message_cn: string
  done: boolean
}

export function useTaskProgress(taskId: string, skip: boolean): TaskProgressState {
  const [progress, setProgress] = useState<TaskProgressState>({
    state: 'pending',
    progress_pct: 0,
    message_cn: '等待中',
    done: skip,
  })
  const unsubRef = useRef<(() => void) | null>(null)
  const pollRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (skip) return

    // SSE subscription
    unsubRef.current = subscribeProgress(
      taskId,
      (e: ProgressEvent) => setProgress(e),
      () => {
        // On SSE error, fall back to polling
        pollRef.current = setInterval(async () => {
          try {
            const task = await getTask(taskId)
            if (['done', 'failed', 'cancelled', 'awaiting_edit'].includes(task.status)) {
              setProgress({
                state: task.status,
                progress_pct: task.status === 'done' ? 100 : (task.status === 'awaiting_edit' ? 82 : 0),
                message_cn: task.status === 'done' ? '完成'
                  : task.status === 'cancelled' ? '已取消'
                  : task.status === 'awaiting_edit' ? '等待编辑翻译'
                  : (task.error ?? '失败'),
                done: true,
              })
              clearInterval(pollRef.current)
            }
          } catch { /* ignore */ }
        }, 2000)
      },
    )

    return () => {
      unsubRef.current?.()
      clearInterval(pollRef.current)
    }
  }, [taskId, skip])

  return progress
}
