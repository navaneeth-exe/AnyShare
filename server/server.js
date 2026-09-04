import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import multer from 'multer';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRoom, getRoom, addUserToRoom, removeUser, addFileToRoom, getRoomUsers, users } from './store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// Health check endpoint for cron keep-alive
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Multer storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const roomId = req.params.roomId;
    const roomDir = path.join(UPLOADS_DIR, roomId);
    if (!fs.existsSync(roomDir)) {
      fs.mkdirSync(roomDir, { recursive: true });
    }
    cb(null, roomDir);
  },
  filename: (req, file, cb) => {
    const fileId = uuidv4();
    cb(null, fileId);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Create Room API
app.post('/api/rooms', (req, res) => {
  // Generate a random 4-letter room code
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let roomId = 'AD-';
  for (let i = 0; i < 4; i++) roomId += chars[Math.floor(Math.random() * chars.length)];
  
  createRoom(roomId);
  res.json({ roomId });
});

// Upload File API
app.post('/api/rooms/:roomId/upload', upload.single('file'), (req, res) => {
  const { roomId } = req.params;
  const { username } = req.body;
  const room = getRoom(roomId);
  
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const fileMeta = {
    id: req.file.filename,
    name: req.file.originalname,
    size: req.file.size,
    type: req.file.mimetype,
    uploadedBy: username || 'Unknown',
    uploadedAt: Date.now()
  };

  addFileToRoom(roomId, fileMeta);
  
  // Broadcast to room
  io.to(roomId).emit('file_added', fileMeta);

  res.json(fileMeta);
});

// Download File API
app.get('/api/rooms/:roomId/files/:fileId', (req, res) => {
  const { roomId, fileId } = req.params;
  const room = getRoom(roomId);
  
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  const fileMeta = room.files.find(f => f.id === fileId);
  if (!fileMeta) {
    return res.status(404).json({ error: 'File not found' });
  }

  const filePath = path.join(UPLOADS_DIR, roomId, fileId);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File missing on disk' });
  }

  res.download(filePath, fileMeta.name);
});

// Socket.IO Events
io.on('connection', (socket) => {
  
  socket.on('join_room', ({ roomId, username }, callback) => {
    const room = getRoom(roomId);
    if (!room) {
      if (callback) callback({ error: 'Room not found' });
      return;
    }

    socket.join(roomId);
    addUserToRoom(socket.id, roomId, username);
    
    // Send current state to joining user
    if (callback) callback({
      success: true,
      files: room.files,
      users: getRoomUsers(roomId)
    });

    // Broadcast to others
    socket.to(roomId).emit('user_joined', { id: socket.id, username });
    io.to(roomId).emit('peers_updated', getRoomUsers(roomId));
  });

  socket.on('chat_message', ({ roomId, text }) => {
    const user = users.get(socket.id);
    if (user && user.roomId === roomId) {
      const msg = {
        id: uuidv4(),
        text,
        username: user.username,
        senderId: socket.id,
        ts: Date.now()
      };
      io.to(roomId).emit('chat_message', msg);
    }
  });

  socket.on('clipboard_update', ({ roomId, text }) => {
    const user = users.get(socket.id);
    if (user && user.roomId === roomId) {
      socket.to(roomId).emit('clipboard_update', { text, username: user.username });
    }
  });

  socket.on('disconnect', () => {
    const user = removeUser(socket.id);
    if (user) {
      io.to(user.roomId).emit('user_left', { id: socket.id, username: user.username });
      io.to(user.roomId).emit('peers_updated', getRoomUsers(user.roomId));
      
      // Cleanup logic could go here (e.g. if room is empty, set timer to delete)
    }
  });
});

// Serve frontend in production if dist folder exists
const DIST_DIR = path.join(__dirname, '../dist');
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get('{*splat}', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io') || req.path === '/health') {
      return next();
    }
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
