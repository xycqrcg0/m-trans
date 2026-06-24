import { useState, useEffect, useRef } from 'react'
import { subscribeProgress, type ProgressEvent, type TaskStatus } from '@/lib/api'

interface TaskProgressState {
  state: TaskStatus
  progress_pct: number
  message_cn: string
  done: boolean
}

export function useTaskProgress(taskId: string, skip: boolean) {
  const [progress, setProgress] = useState<TaskProgressState>({
    state: 'pending',
    progress_pct: 0,
    message_cn: '等待中',
    done: skip,
  })
  const unsubRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (skip) return
    unsubRef.current = subscribeProgress(
      taskId,
      (e: ProgressEvent) => setProgress(e),
    )
    return () => unsubRef.current?.()
  }, [taskId, skip])

  return progress
}
