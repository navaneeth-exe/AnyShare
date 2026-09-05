import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import multer from 'multer';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createRoom, getRoom, addUserToRoom, removeUser, addFileToRoom, getRoomUsers, users } from './store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.ALLOWED_ORIGIN || '*',
    methods: ['GET', 'POST']
  },
  // Socket.io security: limit payload size to prevent memory exhaustion
  maxHttpBufferSize: 1e6 // 1MB max per message
});

// --- Security Middleware ---------------------------------------------

// Helmet: sets secure HTTP headers (XSS, clickjacking, content sniffing protection)
app.use(helmet({
  contentSecurityPolicy: false, // We handle CSP via meta tag or disable for flexibility
  crossOriginEmbedderPolicy: false, // Required for socket.io
}));

// Remove X-Powered-By header to reduce fingerprinting
app.disable('x-powered-by');

// CORS - restrict in production
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['GET', 'POST'],
}));

app.use(express.json({ limit: '1kb' })); // Limit JSON body size

// Rate limiting: prevent room creation spam
const roomCreateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 rooms per IP per 15 min
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many rooms created. Try again later.' }
});

// Rate limiting: prevent upload flooding
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50, // 50 uploads per IP per 15 min
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many uploads. Try again later.' }
});

// General API rate limiter
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', apiLimiter);

// --- Input Validation Helpers ----------------------------------------

// Blocked file extensions (executable / server-side script)
const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.sh', '.ps1', '.msi', '.com', '.scr', '.pif',
  '.php', '.jsp', '.asp', '.aspx', '.cgi', '.pl', '.py', '.rb',
  '.jar', '.war', '.dll', '.so', '.dylib',
  '.vbs', '.vbe', '.wsf', '.wsh', '.reg',
]);

function isBlockedFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return BLOCKED_EXTENSIONS.has(ext);
}

// Sanitize path params to prevent directory traversal
function isSafePath(param) {
  if (typeof param !== 'string') return false;
  if (param.includes('..') || param.includes('/') || param.includes('\\')) return false;
  if (param.length > 50) return false;
  return true;
}

// Validate room ID format (AD-XXXX)
function isValidRoomId(roomId) {
  return typeof roomId === 'string' && /^AD-[A-Z0-9]{4}$/.test(roomId);
}

// Sanitize and limit string length
function sanitizeString(str, maxLen = 200) {
  if (typeof str !== 'string') return '';
  return str.slice(0, maxLen).trim();
}

// --- Health Check ----------------------------------------------------

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// --- File Storage ----------------------------------------------------

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const roomId = req.params.roomId;
    // Path traversal protection
    if (!isSafePath(roomId)) {
      return cb(new Error('Invalid room ID'));
    }
    const roomDir = path.join(UPLOADS_DIR, roomId);
    if (!fs.existsSync(roomDir)) {
      fs.mkdirSync(roomDir, { recursive: true });
    }
    cb(null, roomDir);
  },
  filename: (req, file, cb) => {
    // Always use UUID — never the original filename — to prevent overwriting
    const fileId = uuidv4();
    cb(null, fileId);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max
    files: 1, // Only 1 file per request
  },
  fileFilter: (req, file, cb) => {
    // Block dangerous file types
    if (isBlockedFile(file.originalname)) {
      return cb(new Error(`File type not allowed: ${path.extname(file.originalname)}`));
    }
    cb(null, true);
  }
});

// --- API Routes ------------------------------------------------------

// Create Room
app.post('/api/rooms', roomCreateLimiter, (req, res) => {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let roomId = 'AD-';
  for (let i = 0; i < 4; i++) roomId += chars[Math.floor(Math.random() * chars.length)];

  createRoom(roomId);
  res.json({ roomId });
});

// Upload File
app.post('/api/rooms/:roomId/upload', uploadLimiter, (req, res) => {
  const { roomId } = req.params;

  // Validate roomId format and path safety
  if (!isSafePath(roomId) || !isValidRoomId(roomId)) {
    return res.status(400).json({ error: 'Invalid room ID' });
  }

  const room = getRoom(roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: 'File too large (max 50MB)' });
        }
        return res.status(400).json({ error: `Upload error: ${err.message}` });
      }
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const username = sanitizeString(req.body.username || 'Unknown', 20);

    const fileMeta = {
      id: req.file.filename,
      name: sanitizeString(req.file.originalname, 255),
      size: req.file.size,
      type: req.file.mimetype,
      uploadedBy: username,
      uploadedAt: Date.now()
    };

    addFileToRoom(roomId, fileMeta);
    io.to(roomId).emit('file_added', fileMeta);
    res.json(fileMeta);
  });
});

// Download File
app.get('/api/rooms/:roomId/files/:fileId', (req, res) => {
  const { roomId, fileId } = req.params;

  // Path traversal protection
  if (!isSafePath(roomId) || !isSafePath(fileId)) {
    return res.status(400).json({ error: 'Invalid parameters' });
  }

  const room = getRoom(roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  const fileMeta = room.files.find(f => f.id === fileId);
  if (!fileMeta) {
    return res.status(404).json({ error: 'File not found' });
  }

  const filePath = path.join(UPLOADS_DIR, roomId, fileId);

  // Extra safety: ensure resolved path is within UPLOADS_DIR
  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(path.resolve(UPLOADS_DIR))) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File missing on disk' });
  }

  res.download(filePath, fileMeta.name);
});

// --- Socket.IO Events -----------------------------------------------

// Track socket-to-room mapping for access control
const socketRooms = new Map(); // socketId -> roomId

io.on('connection', (socket) => {

  // Global error handler to prevent uncaught exceptions from crashing the server
  socket.on('error', (err) => {
    console.error(`Socket error [${socket.id}]:`, err.message);
  });

  socket.on('join_room', ({ roomId, username }, callback) => {
    // Input validation
    if (!isValidRoomId(roomId)) {
      if (callback) callback({ error: 'Invalid room code format' });
      return;
    }
    username = sanitizeString(username || 'Anonymous', 20);

    const room = getRoom(roomId);
    if (!room) {
      if (callback) callback({ error: 'Room not found' });
      return;
    }

    // Leave any previous room first (prevent multi-room abuse)
    const prevRoom = socketRooms.get(socket.id);
    if (prevRoom && prevRoom !== roomId) {
      socket.leave(prevRoom);
      removeUser(socket.id);
    }

    socket.join(roomId);
    socketRooms.set(socket.id, roomId);
    addUserToRoom(socket.id, roomId, username);

    if (callback) callback({
      success: true,
      files: room.files,
      users: getRoomUsers(roomId)
    });

    socket.to(roomId).emit('user_joined', { id: socket.id, username });
    io.to(roomId).emit('peers_updated', getRoomUsers(roomId));
  });

  socket.on('chat_message', ({ roomId, text }) => {
    // Validate room membership
    const userRoom = socketRooms.get(socket.id);
    if (!userRoom || userRoom !== roomId) return; // Silent drop if not in room

    // Validate inputs
    if (!isValidRoomId(roomId)) return;
    text = sanitizeString(text, 500);
    if (!text) return;

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
    // Validate room membership
    const userRoom = socketRooms.get(socket.id);
    if (!userRoom || userRoom !== roomId) return;

    if (!isValidRoomId(roomId)) return;
    text = sanitizeString(text, 2000);

    const user = users.get(socket.id);
    if (user && user.roomId === roomId) {
      socket.to(roomId).emit('clipboard_update', { text, username: user.username });
    }
  });

  socket.on('disconnect', () => {
    const user = removeUser(socket.id);
    socketRooms.delete(socket.id);
    if (user) {
      io.to(user.roomId).emit('user_left', { id: socket.id, username: user.username });
      io.to(user.roomId).emit('peers_updated', getRoomUsers(user.roomId));
    }
  });
});

// --- Global error handlers -------------------------------------------

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // Don't exit — keep the server alive
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

// --- Serve Frontend --------------------------------------------------

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