const mongoose = require('mongoose');
require('dotenv').config();
const User = require('./models/User');
const bcrypt = require('bcryptjs');

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

const testUserData = {
  firstName: 'Test',
  lastName: 'User',
  idNumber: 'TEST001',
  email: 'testuser@ttls.local',
  password: 'testpassword', // plain password for login
  role: 'student',
  status: 'approved',
};

const run = async () => {
  try {
    if (!MONGODB_URI) throw new Error('MONGO_URI or MONGODB_URI not set in .env');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB for seeding');

    const existing = await User.findOne({ idNumber: testUserData.idNumber });
    if (existing) {
      console.log('Test user already exists:', existing.idNumber);
      process.exit(0);
    }

    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(testUserData.password, salt);

    const testUser = new User({
      firstName: testUserData.firstName,
      lastName: testUserData.lastName,
      idNumber: testUserData.idNumber,
      email: testUserData.email,
      password: hashed,
      role: testUserData.role,
      status: testUserData.status,
    });
    await testUser.save();
    console.log('Test user created:', testUser.idNumber);
    process.exit(0);
  } catch (err) {
    console.error('Error seeding test user:', err);
    process.exit(1);
  }
};

run();
