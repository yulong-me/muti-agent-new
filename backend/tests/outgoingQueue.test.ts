import { describe, expect, it } from 'vitest';

import {
  createOutgoingQueueItem,
  findRecallableOutgoingQueueItem,
  getNextQueuedOutgoingItem,
  isRoomBusy,
  markOutgoingQueueItemDispatching,
  recallOutgoingQueueItem,
  removeOutgoingQueueItem,
} from '../../frontend/lib/outgoingQueue.ts';

describe('F015 outgoing queue helpers', () => {
  it('treats streaming agents or thinking/waiting agents as busy', () => {
    expect(isRoomBusy({
      streamingCount: 1,
      agents: [{ status: 'idle' }],
    })).toBe(true);

    expect(isRoomBusy({
      streamingCount: 0,
      agents: [{ status: 'thinking' }],
    })).toBe(true);

    expect(isRoomBusy({
      streamingCount: 0,
      agents: [{ status: 'waiting' }],
    })).toBe(true);

    expect(isRoomBusy({
      streamingCount: 0,
      agents: [{ status: 'idle' }, { status: 'done' }],
    })).toBe(false);
  });

  it('creates queued items and finds the next queued item in FIFO order', () => {
    const first = createOutgoingQueueItem({
      content: '@架构师 第一条',
      toAgentId: 'worker-1',
      toAgentName: '架构师',
      createdAt: 1,
      idFactory: () => 'q-1',
    });
    const second = createOutgoingQueueItem({
      content: '@Reviewer 第二条',
      toAgentId: 'worker-2',
      toAgentName: 'Reviewer',
      createdAt: 2,
      idFactory: () => 'q-2',
    });

    expect(first).toMatchObject({
      id: 'q-1',
      content: '@架构师 第一条',
      toAgentId: 'worker-1',
      toAgentName: '架构师',
      createdAt: 1,
      status: 'queued',
    });
    expect(getNextQueuedOutgoingItem([first, second])).toEqual(first);
  });

  it('marks a queue item as dispatching without changing order', () => {
    const first = createOutgoingQueueItem({
      content: '@架构师 第一条',
      toAgentId: 'worker-1',
      toAgentName: '架构师',
      idFactory: () => 'q-1',
    });
    const second = createOutgoingQueueItem({
      content: '@Reviewer 第二条',
      toAgentId: 'worker-2',
      toAgentName: 'Reviewer',
      idFactory: () => 'q-2',
    });

    expect(markOutgoingQueueItemDispatching([first, second], 'q-1')).toEqual([
      { ...first, status: 'dispatching' },
      second,
    ]);
  });

  it('only recalls the last queued item and leaves dispatching items untouched', () => {
    const dispatching = {
      ...createOutgoingQueueItem({
        content: '@架构师 第一条',
        toAgentId: 'worker-1',
        toAgentName: '架构师',
        idFactory: () => 'q-1',
      }),
      status: 'dispatching' as const,
    };
    const queued = createOutgoingQueueItem({
      content: '@Reviewer 第二条',
      toAgentId: 'worker-2',
      toAgentName: 'Reviewer',
      idFactory: () => 'q-2',
    });

    expect(findRecallableOutgoingQueueItem([dispatching, queued])).toEqual(queued);
    expect(recallOutgoingQueueItem([dispatching, queued], 'q-1')).toEqual({
      recalledItem: null,
      items: [dispatching, queued],
    });
    expect(recallOutgoingQueueItem([dispatching, queued], 'q-2')).toEqual({
      recalledItem: queued,
      items: [dispatching],
    });
  });

  it('removes cancelled items from the queue', () => {
    const first = createOutgoingQueueItem({
      content: '@架构师 第一条',
      toAgentId: 'worker-1',
      toAgentName: '架构师',
      idFactory: () => 'q-1',
    });
    const second = createOutgoingQueueItem({
      content: '@Reviewer 第二条',
      toAgentId: 'worker-2',
      toAgentName: 'Reviewer',
      idFactory: () => 'q-2',
    });

    expect(removeOutgoingQueueItem([first, second], 'q-1')).toEqual([second]);
  });
});
