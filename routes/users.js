const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const multer = require('multer');
const cloudinaryConfig = require('../config/cloudinary');
const hasCloudinary = cloudinaryConfig.hasCloudinary;
const cloudinary = hasCloudinary ? require('cloudinary').v2 : null;

// Helper function to upload buffer to Cloudinary
function uploadBufferToCloudinary(buffer, originalname, folder = 'ttls_profiles') {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: folder,
        resource_type: 'image',
        format: undefined,
        public_id: `${Date.now()}_${originalname.replace(/\.[^/.]+$/, '')}`,
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    uploadStream.end(buffer);
  });
}

// Configure multer for memory storage (for Cloudinary) or disk storage
const memOpts = { storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } };
const diskOpts = { 
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
      cb(null, `${Date.now()}_${file.originalname}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 }
};
const upload = hasCloudinary ? multer(memOpts) : multer(diskOpts);

// Get all users (for messaging/directory)
router.get('/', protect, async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.user.id } }) // Exclude current user
      .select('_id firstName lastName email idNumber role profilePicture status')
      .sort({ firstName: 1, lastName: 1 });

    res.json({
      success: true,
      count: users.length,
      data: users
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch users' });
  }
});

// Update profile picture
router.put('/profile/picture', protect, upload.single('profilePicture'), async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      console.warn('Unauthorized profile/picture request: missing req.user');
      return res.status(401).json({ success: false, message: 'Not authorized' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file provided' });
    }

    // Validate file type
    if (!req.file.mimetype.startsWith('image/')) {
      return res.status(400).json({ success: false, message: 'File must be an image' });
    }

    let imageUrl = null;

    if (hasCloudinary) {
      try {
        // Delete old profile picture if exists
        if (user.profilePicture) {
          const oldPublicId = user.profilePicture.split('/').slice(-2).join('/').split('.')[0];
          try {
            await cloudinary.uploader.destroy(oldPublicId);
          } catch (err) {
            console.warn('Failed to delete old profile picture:', err);
          }
        }

        // Upload new profile picture
        const uploaded = await uploadBufferToCloudinary(req.file.buffer, req.file.originalname, 'ttls_profiles');
        imageUrl = uploaded.secure_url;
      } catch (uploadErr) {
        console.error('Cloudinary upload error:', uploadErr);
        return res.status(500).json({ success: false, message: 'Failed to upload image to Cloudinary' });
      }
    } else {
      // Local storage fallback
      imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    }

    user.profilePicture = imageUrl;
    await user.save();

    res.json({ success: true, profilePicture: imageUrl });
  } catch (err) {
    console.error('Error updating profile picture:', err);
    res.status(500).json({ success: false, message: 'Failed to update profile picture' });
  }
});

// Update cover photo
router.put('/profile/cover', protect, upload.single('coverPhoto'), async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      console.warn('Unauthorized profile/cover request: missing req.user');
      return res.status(401).json({ success: false, message: 'Not authorized' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file provided' });
    }

    // Validate file type
    if (!req.file.mimetype.startsWith('image/')) {
      return res.status(400).json({ success: false, message: 'File must be an image' });
    }

    let imageUrl = null;

    if (hasCloudinary) {
      try {
        // Delete old cover photo if exists
        if (user.coverPhoto) {
          const oldPublicId = user.coverPhoto.split('/').slice(-2).join('/').split('.')[0];
          try {
            await cloudinary.uploader.destroy(oldPublicId);
          } catch (err) {
            console.warn('Failed to delete old cover photo:', err);
          }
        }

        // Upload new cover photo
        const uploaded = await uploadBufferToCloudinary(req.file.buffer, req.file.originalname, 'ttls_profiles');
        imageUrl = uploaded.secure_url;
      } catch (uploadErr) {
        console.error('Cloudinary upload error:', uploadErr);
        return res.status(500).json({ success: false, message: 'Failed to upload image to Cloudinary' });
      }
    } else {
      // Local storage fallback
      imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    }

    user.coverPhoto = imageUrl;
    await user.save();

    res.json({ success: true, coverPhoto: imageUrl });
  } catch (err) {
    console.error('Error updating cover photo:', err);
    res.status(500).json({ success: false, message: 'Failed to update cover photo' });
  }
});

// Update bio
router.put('/profile/bio', protect, async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      console.warn('Unauthorized profile/bio request: missing req.user');
      return res.status(401).json({ success: false, message: 'Not authorized' });
    }

    const { bio } = req.body;
    
    // Validate bio length
    if (bio && bio.length > 150) {
      return res.status(400).json({ success: false, message: 'Bio must be 150 characters or less' });
    }

    // Validate bio contains only text and basic punctuation
    if (bio && !/^[\w\s.,!?;:'"()-]*$/.test(bio)) {
      return res.status(400).json({ success: false, message: 'Bio can only contain text and basic punctuation' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.bio = bio || '';
    await user.save();

    res.json({ success: true, bio: user.bio });
  } catch (err) {
    console.error('Error updating bio:', err);
    res.status(500).json({ success: false, message: 'Failed to update bio' });
  }
});

// Get user profile by ID (for viewing other users' profiles)
router.get('/profile/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select('-password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, data: user });
  } catch (err) {
    console.error('Error fetching user profile:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch user profile' });
  }
});

// Get user profile
router.get('/profile', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, data: user });
  } catch (err) {
    console.error('Error fetching profile:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch profile' });
  }
});

// Get user count (public endpoint for home page stats)
router.get('/count', async (req, res) => {
  try {
    const count = await User.countDocuments({ role: 'student', status: 'approved' });
    res.json({ success: true, data: { count } });
  } catch (error) {
    console.error('Error fetching user count:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch user count' });
  }
});

module.exports = router;
