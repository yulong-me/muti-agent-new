const rooms = new Map();
export const store = {
    create(room) {
        rooms.set(room.id, room);
        return room;
    },
    get(id) {
        return rooms.get(id);
    },
    update(id, partial) {
        const room = rooms.get(id);
        if (!room)
            return undefined;
        const updated = { ...room, ...partial, updatedAt: Date.now() };
        rooms.set(id, updated);
        return updated;
    },
    list() {
        return Array.from(rooms.values());
    },
};
