require('dotenv').config();
const connectDB = require('./config/database');
const User = require('./models/User');

const run = async () => {
  try {
    await connectDB();
    const user = await User.findOne({ idNumber: 'ADMIN001' }).lean();
    if (!user) {
      console.log('ADMIN001 not found');
      process.exit(1);
    }
    console.log('password hash:', user.password);
    console.log('hash length:', user.password ? user.password.length : 0);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

run();
