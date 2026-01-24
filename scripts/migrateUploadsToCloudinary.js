// Migration script: upload local lesson files under backend/uploads to Cloudinary
// Usage: set CLOUDINARY_* in .env and run: node scripts/migrateUploadsToCloudinary.js

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const connectDB = require('../config/database');
const Lesson = require('../models/Lesson');
const cloudinary = require('cloudinary').v2;

if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  console.error('Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET in .env before running this script.');
  process.exit(1);
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function run() {
  try {
    await connectDB();
    console.log('Connected to DB');

    const lessons = await Lesson.find();
    for (const lesson of lessons) {
      let modified = false;
      for (const file of lesson.files) {
        if (file.url && !/^https?:\/\//i.test(file.url)) {
          const localPath = file.url;
          if (!fs.existsSync(localPath)) {
            console.warn(`Local file not found: ${localPath} — skipping`);
            continue;
          }
          console.log(`Uploading ${localPath} to Cloudinary...`);
          try {
            const res = await cloudinary.uploader.upload(localPath, {
              folder: 'ttls_lessons',
              use_filename: true,
              unique_filename: false,
            });
            file.url = res.secure_url || res.url;
            file.public_id = res.public_id;
            file.filename = file.filename || path.basename(localPath);
            modified = true;
            console.log(`Uploaded -> ${file.url}`);
          } catch (err) {
            console.error('Upload failed for', localPath, err.message || err);
          }
        }
      }
      if (modified) {
        await lesson.save();
        console.log(`Updated lesson ${lesson._id}`);
      }
    }

    console.log('Migration complete. Optionally remove local files in backend/uploads if desired.');
    process.exit(0);
  } catch (err) {
    console.error('Migration error', err);
    process.exit(1);
  }
}

run();
