const mongoose = require('mongoose');
require('dotenv').config();
const User = require('./models/User');
const bcrypt = require('bcryptjs');

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

const adminData = {
  firstName: 'System',
  lastName: 'Administrator',
  idNumber: 'ADMIN001',
  email: 'admin@ttls.local',
  password: '01012000',
  role: 'admin',
  status: 'approved',
};

const run = async () => {
  try {
    if (!MONGODB_URI) throw new Error('MONGO_URI or MONGODB_URI not set in .env');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB for seeding');

    const existing = await User.findOne({ idNumber: adminData.idNumber });
    if (existing) {
      console.log('Admin already exists:', existing.idNumber);
      process.exit(0);
    }

    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(adminData.password, salt);

    const adminUser = new User({
      firstName: adminData.firstName,
      lastName: adminData.lastName,
      idNumber: adminData.idNumber,
      email: adminData.email,
      password: hashed,
      role: adminData.role,
      status: adminData.status,
    });

    await adminUser.save();
    console.log('Admin user created:', adminData.idNumber);
    process.exit(0);
  } catch (err) {
    console.error('Seeding error:', err.message || err);
    process.exit(1);
  }
};

run();
