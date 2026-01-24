const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Cloudinary config relies on env vars. DO NOT commit credentials to the repo.
const hasCloudinary = process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET;

if (hasCloudinary) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

let storage;
if (hasCloudinary) {
  storage = new CloudinaryStorage({
    cloudinary,
    params: async (req, file) => {
      return {
        folder: 'ttls_lessons',
        format: undefined, // keep original format
        public_id: `${Date.now()}_${file.originalname.replace(/\.[^/.]+$/, '')}`,
      };
    },
  });
} else {
  // fallback to local disk storage under backend/uploads
  const uploadDir = path.join(__dirname, '..', 'uploads');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  storage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
      const name = `${Date.now()}_${file.originalname.replace(/\s+/g, '_')}`;
      cb(null, name);
    },
  });
}

module.exports = { cloudinary: hasCloudinary ? cloudinary : null, storage, hasCloudinary };
