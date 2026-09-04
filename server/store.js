export const rooms = new Map(); // roomId -> { createdAt, files: [], users: Set(socketId) }
export const users = new Map(); // socketId -> { roomId, username }

export function createRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      createdAt: Date.now(),
      files: [],
      users: new Set()
    });
  }
  return rooms.get(roomId);
}

export function getRoom(roomId) {
  return rooms.get(roomId);
}

export function addUserToRoom(socketId, roomId, username) {
  const room = rooms.get(roomId);
  if (room) {
    room.users.add(socketId);
    users.set(socketId, { roomId, username });
    return true;
  }
  return false;
}

export function removeUser(socketId) {
  const user = users.get(socketId);
  if (user) {
    const room = rooms.get(user.roomId);
    if (room) {
      room.users.delete(socketId);
    }
    users.delete(socketId);
    return user;
  }
  return null;
}

export function addFileToRoom(roomId, fileMeta) {
  const room = rooms.get(roomId);
  if (room) {
    room.files.push(fileMeta);
    return true;
  }
  return false;
}

export function getRoomUsers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  const roomUsers = [];
  for (const socketId of room.users) {
    const u = users.get(socketId);
    if (u) roomUsers.push({ id: socketId, username: u.username });
  }
  return roomUsers;
}
