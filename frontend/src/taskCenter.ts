export type TaskCenterStatus = 'queued' | 'running' | 'completed' | 'failed'

export type TaskCenterKind =
  | 'install'
  | 'uninstall'
  | 'bucket'
  | 'other'

export interface TaskCenterItem {
  id: string
  kind: TaskCenterKind
  title: string
  detail?: string
  status: TaskCenterStatus
  progress?: number
  currentItem?: string
  error?: string
  startedAt: number
  finishedAt?: number
  items?: string[]
}

export const TASK_CENTER_HISTORY_LIMIT = 80

export function upsertTaskCenterItem(
  prev: TaskCenterItem[],
  next: TaskCenterItem,
  limit = TASK_CENTER_HISTORY_LIMIT,
): TaskCenterItem[] {
  const existing = prev.find((item) => item.id === next.id)
  const mergedItem: TaskCenterItem = {
    ...next,
    startedAt: existing?.startedAt ?? next.startedAt,
    title: next.title || existing?.title || next.id,
    items: next.items ?? existing?.items,
  }
  const without = prev.filter((item) => item.id !== next.id)
  const merged = [mergedItem, ...without]
  if (merged.length <= limit) return merged
  const active = merged.filter((item) => item.status === 'running' || item.status === 'queued')
  const rest = merged.filter((item) => item.status !== 'running' && item.status !== 'queued')
  const keptRest = rest.slice(0, Math.max(0, limit - active.length))
  return [...active, ...keptRest]
}

export function taskCenterCounts(tasks: TaskCenterItem[]) {
  let running = 0
  let queued = 0
  let completed = 0
  let failed = 0
  for (const item of tasks) {
    if (item.status === 'running') running += 1
    else if (item.status === 'queued') queued += 1
    else if (item.status === 'completed') completed += 1
    else failed += 1
  }
  return { running, queued, completed, failed }
}

export function installTaskId(name: string) {
  return `install:${name.trim().toLowerCase()}`
}

export function uninstallTaskId(name: string) {
  return `uninstall:${name.trim().toLowerCase()}`
}
