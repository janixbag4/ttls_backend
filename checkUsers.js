require('dotenv').config();
const connectDB = require('./config/database');
const User = require('./models/User');

const run = async () => {
  try {
    await connectDB();
    const total = await User.countDocuments();
    console.log('Total users in DB:', total);

    const admin = await User.findOne({ idNumber: 'ADMIN001' }).lean();
    if (admin) {
      console.log('Found ADMIN001:');
      console.log({ idNumber: admin.idNumber, role: admin.role, status: admin.status, email: admin.email });
    } else {
      console.log('ADMIN001 not found');
    }

    // list first 10 users
    const users = await User.find().limit(10).select('idNumber role status email firstName lastName').lean();
    console.log('Sample users:', users);
    process.exit(0);
  } catch (err) {
    console.error('checkUsers error:', err.message || err);
    process.exit(1);
  }
};

run();
