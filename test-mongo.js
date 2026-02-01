const { MongoClient } = require('mongodb');
// Use environment variable for MongoDB connection to avoid committing credentials
const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/abisDB?retryWrites=true&w=majority';
const client = new MongoClient(uri);

async function run() {
  try {
    await client.connect();
    await client.db('admin').command({ ping: 1 });
    console.log('Connected!');
  } catch (e) {
    console.error(e);
  } finally {
    await client.close();
  }
}
run();