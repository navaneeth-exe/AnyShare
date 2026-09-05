import { describe, it, expect, beforeEach } from 'vitest';
import { 
  createRoom, getRoom, addUserToRoom, removeUser, 
  addFileToRoom, getRoomUsers, rooms, users 
} from '../server/store.js';

describe('Store Logic', () => {
  beforeEach(() => {
    rooms.clear();
    users.clear();
  });

  it('creates and retrieves a room', () => {
    const roomId = 'AD-TEST';
    createRoom(roomId);
    const room = getRoom(roomId);
    expect(room).toBeDefined();
    expect(room.files).toEqual([]);
    expect(room.users.size).toBe(0);
  });

  it('adds a user to a room', () => {
    const roomId = 'AD-TEST';
    createRoom(roomId);
    
    const added = addUserToRoom('socket-1', roomId, 'Alice');
    expect(added).toBe(true);
    
    const roomUsers = getRoomUsers(roomId);
    expect(roomUsers.length).toBe(1);
    expect(roomUsers[0]).toEqual({ id: 'socket-1', username: 'Alice' });
  });

  it('removes a user properly', () => {
    const roomId = 'AD-TEST';
    createRoom(roomId);
    addUserToRoom('socket-1', roomId, 'Alice');
    
    const removedUser = removeUser('socket-1');
    expect(removedUser).toEqual({ roomId, username: 'Alice' });
    
    expect(getRoomUsers(roomId).length).toBe(0);
  });

  it('handles adding files to a room', () => {
    const roomId = 'AD-TEST';
    createRoom(roomId);
    
    const fileMeta = { id: 'file-1', name: 'test.txt' };
    const added = addFileToRoom(roomId, fileMeta);
    
    expect(added).toBe(true);
    const room = getRoom(roomId);
    expect(room.files.length).toBe(1);
    expect(room.files[0].name).toBe('test.txt');
  });
});
