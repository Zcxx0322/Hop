import { useEffect, useState } from 'react';
import { listTransfers, type Transfer } from '../api/workspace';

/** 底栏只关心这三类字段，前端各处共用一份 */
export type TransferRow = Transfer;

const POLL_MS = 900;
const FINISHED_KEEP = 6;

let rows: TransferRow[] = [];
let hostId: string | null = null;
let timer: number | null = null;
let disposed = false;

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function publish(next: TransferRow[]): void {
  rows = next;
  emit();
}

/** 进行中的排前面，已结束的按时间倒序保留若干条 */
export function orderTransfers(list: TransferRow[]): TransferRow[] {
  const active = list.filter((row) => row.status === 'active');
  const finished = list
    .filter((row) => row.status !== 'active')
    .sort((a, b) => (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt))
    .slice(0, FINISHED_KEEP);
  return [...active, ...finished];
}

async function tick(): Promise<void> {
  const current = hostId;
  if (!current) return;
  try {
    const next = await listTransfers(current);
    if (!disposed && current === hostId) publish(orderTransfers(next));
  } catch {
    /* 轮询失败不打扰主界面，下一轮会自然恢复 */
  }
}

function start(host: string): void {
  hostId = host;
  disposed = false;
  if (timer !== null) window.clearTimeout(timer);
  const loop = () => {
    if (disposed) return;
    void tick();
    timer = window.setTimeout(loop, POLL_MS);
  };
  loop();
}

function stop(): void {
  disposed = true;
  hostId = null;
  if (timer !== null) window.clearTimeout(timer);
  timer = null;
  publish([]);
}

/** 立即刷新一次（上传/下载刚发起时用，让底栏立刻出现卡片） */
export function refreshTransfers(): void {
  if (hostId) void tick();
}

export function getTransfers(): TransferRow[] {
  return rows;
}

export function subscribeTransfers(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 跟随当前会话主机启动/停止轮询 */
export function useTransferHost(nextHostId: string | null): void {
  useEffect(() => {
    if (!nextHostId) {
      stop();
      return;
    }
    start(nextHostId);
    return stop;
  }, [nextHostId]);
}

/** 订阅传输列表；组件卸载时自动退订 */
export function useTransfers(): TransferRow[] {
  const [snapshot, setSnapshot] = useState<TransferRow[]>(rows);
  useEffect(() => {
    setSnapshot(rows);
    return subscribeTransfers(() => setSnapshot(rows));
  }, []);
  return snapshot;
}
