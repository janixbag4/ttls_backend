require('dotenv').config();
const connectDB = require('./config/database');
const User = require('./models/User');
const bcrypt = require('bcryptjs');

const run = async () => {
  try {
    await connectDB();
    const user = await User.findOne({ idNumber: 'ADMIN001' });
    if (!user) {
      console.log('ADMIN001 not found');
      process.exit(1);
    }

    const newPass = '01012000';
    // assign plaintext here; User model pre-save hook will hash it
    user.password = newPass;
    await user.save();

    console.log('ADMIN001 password has been reset to', newPass);
    process.exit(0);
  } catch (err) {
    console.error('resetAdminPassword error:', err.message || err);
    process.exit(1);
  }
};

run();
