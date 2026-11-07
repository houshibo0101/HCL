// 下载任务的独立状态源：任务进度每秒更新十几次，不能让它触发整个 App 重渲染
import { useSyncExternalStore } from 'react';

let tasks = [];
const listeners = new Set();

function emit() {
  for (const listener of listeners) listener();
}

export function setAllTasks(next) {
  tasks = Array.isArray(next) ? [...next] : [];
  emit();
}

export function upsertTask(task) {
  if (!task?.id) return;
  const index = tasks.findIndex((item) => item.id === task.id);
  if (index >= 0) {
    const copy = tasks.slice();
    copy[index] = task;
    tasks = copy;
  } else {
    tasks = [...tasks, task];
  }
  emit();
}

export function subscribeTasks(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getTasksSnapshot() {
  return tasks;
}

export function useTasks() {
  return useSyncExternalStore(subscribeTasks, getTasksSnapshot, getTasksSnapshot);
}
