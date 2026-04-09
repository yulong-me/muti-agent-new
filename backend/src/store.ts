import { DiscussionRoom } from './types.js';

const rooms = new Map<string, DiscussionRoom>();

export const store = {
  create(room: DiscussionRoom): DiscussionRoom {
    rooms.set(room.id, room);
    return room;
  },
  get(id: string): DiscussionRoom | undefined {
    return rooms.get(id);
  },
  update(id: string, partial: Partial<DiscussionRoom>): DiscussionRoom | undefined {
    const room = rooms.get(id);
    if (!room) return undefined;
    const updated: DiscussionRoom = { ...room, ...partial, updatedAt: Date.now() };
    rooms.set(id, updated);
    return updated;
  },
  list(): DiscussionRoom[] {
    return Array.from(rooms.values());
  },
};
