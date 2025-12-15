require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');
const session = require('express-session');
const GameServerManager = require('./server/game-server');
const adminRoutes = require('./server/routes/admin');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
    console.warn('[SECURITY] WARNING: SESSION_SECRET not set in environment variables. Using default (INSECURE for production)!');
}
app.use(session({
    secret: sessionSecret || 'your-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production', // Set to true if using HTTPS
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.warn('Warning: MONGODB_URI not found in environment variables');
} else {
  mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB successfully');
  })
  .catch((error) => {
    console.error('MongoDB connection error:', error);
  });

  // Handle connection events
  mongoose.connection.on('error', (err) => {
    console.error('MongoDB error:', err);
  });

  mongoose.connection.on('disconnected', () => {
    console.log('MongoDB disconnected');
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    await mongoose.connection.close();
    console.log('MongoDB connection closed through app termination');
    process.exit(0);
  });
}

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html for the root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve map builder page
app.get('/map-builder', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'map-builder.html'));
});

// Serve admin panel page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Chat message storage (simple in-memory array) - must be defined before sendSystemMessage
const chatMessages = [];
const MAX_CHAT_MESSAGES = 100; // Keep last 100 messages

// Helper function to send system messages (must be defined before gameServer)
function sendSystemMessage(message) {
  const systemMessage = {
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
    username: 'System',
    message: message,
    timestamp: Date.now(),
    isSystem: true
  };
  
  chatMessages.push(systemMessage);
  
  // Keep only last MAX_CHAT_MESSAGES messages
  if (chatMessages.length > MAX_CHAT_MESSAGES) {
    chatMessages.shift();
  }
  
  // Broadcast to all clients
  io.emit('chatMessage', systemMessage);
}

// Initialize game server (map name can be configured via environment variable)
const MAP_NAME = process.env.MAP_NAME || 'map1';
const gameServer = new GameServerManager(io, MAP_NAME, sendSystemMessage);

// Admin API routes (pass gameServer instance - must be after gameServer is created)
app.use('/api/admin', adminRoutes(gameServer));

// Player API routes
const playerRoutes = require('./server/routes/player');
app.use('/api/player', playerRoutes);

// Token Stats API routes
const tokenStatsRoutes = require('./server/routes/tokenStats');
app.use('/api/token-stats', tokenStatsRoutes);

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Generate unique player ID
  const playerId = socket.id;
  
  // Send existing chat messages to newly connected client
  socket.emit('chatHistory', chatMessages);
  
  // Add as spectator initially (can watch without playing)
  gameServer.handleSpectatorJoin(socket, playerId);

  // Handle player join request
  socket.on('joinGame', () => {
    // Just add to queue, teams will be assigned when game starts
    gameServer.handlePlayerJoin(socket, playerId);
  });

  // Handle player input
  socket.on('playerInput', (data) => {
    gameServer.handlePlayerInput(socket, data);
  });

  // Handle player state sync
  socket.on('playerStateSync', (data) => {
    gameServer.handlePlayerStateSync(socket, data);
  });

  // Handle bomb thrown
  socket.on('bombThrown', (data) => {
    gameServer.handleBombThrown(socket, data);
  });

  // Handle chat message
  socket.on('chatMessage', async (data) => {
    try {
      const { message, username } = data;
      
      // Validate message
      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return;
      }
      
      if (message.length > 200) {
        socket.emit('chatError', { error: 'Message too long (max 200 characters)' });
        return;
      }
      
      // Get username from player stats if not provided
      let displayUsername = username || 'Anonymous';
      if (!username) {
        try {
          const PlayerStats = require('./models/playerStats');
          const playerStats = await PlayerStats.findOne({ clientId: playerId });
          if (playerStats && playerStats.username) {
            displayUsername = playerStats.username;
          }
        } catch (error) {
          console.error('Error fetching player username:', error);
        }
      }
      
      // Create chat message
      const chatMessage = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        username: displayUsername,
        message: message.trim(),
        timestamp: Date.now(),
        isSystem: false
      };
      
      // Add to chat history
      chatMessages.push(chatMessage);
      
      // Keep only last MAX_CHAT_MESSAGES messages
      if (chatMessages.length > MAX_CHAT_MESSAGES) {
        chatMessages.shift();
      }
      
      // Broadcast to all clients
      io.emit('chatMessage', chatMessage);
    } catch (error) {
      console.error('Error handling chat message:', error);
      socket.emit('chatError', { error: 'Failed to send message' });
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    gameServer.handleDisconnect(socket, playerId);
  });
});

// Export for use in other modules
module.exports.sendSystemMessage = sendSystemMessage;
module.exports.io = io; // Export io for game-server to send system messages

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Multiplayer enabled with Socket.io');
});

