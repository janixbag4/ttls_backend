const { MongoClient } = require('mongodb');
const uri = 'mongodb+srv://ttls_admin:ttls1234567890@cluster0.8i1sn.mongodb.net/abisDB?retryWrites=true&w=majority';
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