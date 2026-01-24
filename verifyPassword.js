require('dotenv').config();
const connectDB = require('./config/database');
const User = require('./models/User');
const bcrypt = require('bcryptjs');

const run = async () => {
  try {
    await connectDB();
    const user = await User.findOne({ idNumber: 'ADMIN001' }).lean();
    if (!user) {
      console.log('ADMIN001 not found');
      process.exit(1);
    }
    console.log('Found ADMIN001, checking password...');
    const attempt = '01012000';
    const match = await bcrypt.compare(attempt, user.password);
    console.log('Password match?', match);
    process.exit(0);
  } catch (err) {
    console.error('verifyPassword error:', err.message || err);
    process.exit(1);
  }
};

run();
