interface ActiveAgentRun {
  roomId: string;
  agentId: string;
  agentName: string;
  abortController: AbortController;
  startedAt: number;
}

const activeRuns = new Map<string, ActiveAgentRun>();

function buildRunKey(roomId: string, agentId: string): string {
  return `${roomId}:${agentId}`;
}

export function registerActiveAgentRun(args: {
  roomId: string;
  agentId: string;
  agentName: string;
  abortController: AbortController;
}): void {
  activeRuns.set(buildRunKey(args.roomId, args.agentId), {
    ...args,
    startedAt: Date.now(),
  });
}

export function clearActiveAgentRun(
  roomId: string,
  agentId: string,
  abortController?: AbortController,
): void {
  const key = buildRunKey(roomId, agentId);
  const current = activeRuns.get(key);
  if (!current) return;
  if (abortController && current.abortController !== abortController) return;
  activeRuns.delete(key);
}

export function stopAgentRun(roomId: string, agentId: string): {
  stopped: boolean;
  agentName?: string;
  startedAt?: number;
} {
  const run = activeRuns.get(buildRunKey(roomId, agentId));
  if (!run) return { stopped: false };
  run.abortController.abort();
  return {
    stopped: true,
    agentName: run.agentName,
    startedAt: run.startedAt,
  };
}
