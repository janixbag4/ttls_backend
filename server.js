require('dns').setDefaultResultOrder('ipv4first');
const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIO = require('socket.io');
require('dotenv').config();
const connectDB = require('./config/database');

// Connect to database
connectDB();

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: { origin: true, credentials: true }
});

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
// Allow Authorization header in CORS preflight and enable credentials
app.use(cors({ origin: true, credentials: true, allowedHeaders: ['Content-Type', 'Authorization'] }));

// Serve static files from uploads directory
app.use('/uploads', express.static('uploads'));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/users', require('./routes/users'));
app.use('/api/dashboard', require('./routes/dashboard'));
// Lesson routes (file uploads handled via Cloudinary)
app.use('/api/lessons', require('./routes/lessons'));
app.use('/api/activities', require('./routes/activities'));
app.use('/api/progress', require('./routes/progress'));
app.use('/api/assignments', require('./routes/assignments'));
app.use('/api/modules', require('./routes/modules'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/comments', require('./routes/comments'));
// Messaging routes for private chats
app.use('/api/messages', require('./routes/messages'));
// Settings routes
app.use('/api/settings', require('./routes/settings'));
// Proxy route for external file URLs
app.use('/api', require('./routes/proxy'));

// Basic route
app.get('/', (req, res) => {
  res.json({ message: 'TTLS Backend API is running' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : {},
  });
});

const PORT = process.env.PORT || 5000;

// Socket.io for real-time messaging
const userSockets = {}; // Map userId to socketId

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // User joins with their ID
  socket.on('user_join', (userId) => {
    userSockets[userId] = socket.id;
    socket.userId = userId;
    console.log(`User ${userId} connected with socket ${socket.id}`);
  });

  // Handle new message
  socket.on('send_message', async (messageData) => {
    const { senderId, receiverId, content } = messageData;
    
    // Save message to database
    const Message = require('./models/Message');
    try {
      const message = new Message({
        senderId,
        receiverId,
        content
      });
      await message.save();
      await message.populate('senderId', 'firstName lastName profilePicture');
      await message.populate('receiverId', 'firstName lastName profilePicture');

      // Send to receiver if online
      const receiverSocketId = userSockets[receiverId];
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('receive_message', {
          _id: message._id,
          senderId: message.senderId,
          receiverId: message.receiverId,
          content: message.content,
          createdAt: message.createdAt,
          isRead: message.isRead
        });
      }

      // Confirm to sender
      socket.emit('message_sent', {
        _id: message._id,
        senderId: message.senderId,
        receiverId: message.receiverId,
        content: message.content,
        createdAt: message.createdAt,
        isRead: message.isRead
      });
    } catch (err) {
      console.error('Error saving message:', err);
      socket.emit('message_error', { error: 'Failed to send message' });
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    if (socket.userId) {
      delete userSockets[socket.userId];
      console.log(`User ${socket.userId} disconnected`);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
});
