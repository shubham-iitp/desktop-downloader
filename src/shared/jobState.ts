import type { JobStatus } from './types';

/**
 * Every legal job transition. Paused and failed jobs always go back through `queued`,
 * so the concurrency limit is never bypassed. Anything else is rejected by JobManager.
 */
export const TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  probing: ['queued', 'cancelled', 'error'],
  queued: ['active', 'paused', 'cancelled', 'error', 'completed'],
  active: ['queued', 'paused', 'postprocessing', 'completed', 'error', 'cancelled'],
  // ffmpeg merge / audio extraction (yt-dlp jobs). Pause isn't offered; a restart re-queues it.
  postprocessing: ['queued', 'completed', 'error', 'cancelled'],
  paused: ['queued', 'cancelled'],
  error: ['queued', 'cancelled'],
  completed: ['cancelled'],
  cancelled: []
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

export class IllegalTransitionError extends Error {
  constructor(
    public from: JobStatus,
    public to: JobStatus
  ) {
    super(`Illegal job transition ${from} → ${to}`);
  }
}

export function assertTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}
