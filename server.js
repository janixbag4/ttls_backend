require('dns').setDefaultResultOrder('ipv4first');
const express = require('express');
const cors = require('cors');
require('dotenv').config();
const connectDB = require('./config/database');

// Connect to database
connectDB();

const app = express();

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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
});
