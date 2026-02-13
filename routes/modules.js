const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const Module = require('../models/Module');
const Lesson = require('../models/Lesson');
const multer = require('multer');
const { storage, cloudinary, hasCloudinary } = require('../config/cloudinary');

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

// Helper function to upload buffer to Cloudinary
function uploadBufferToCloudinary(buffer, originalname, folder = 'ttls_modules') {
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

// Get all modules (filtered by category if provided)
router.get('/', protect, async (req, res) => {
  try {
    const { category } = req.query;
    const query = {};
    
    if (category) {
      query.category = category;
    }

    const modules = await Module.find(query)
      .populate('createdBy', '_id firstName lastName idNumber role profilePicture coverPhoto bio')
      .sort({ category: 1, moduleNumber: 1 });

    res.json({ success: true, data: modules });
  } catch (error) {
    console.error('Get modules error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get module count (public endpoint for home page stats)
router.get('/count', async (req, res) => {
  try {
    const count = await Module.countDocuments();
    res.json({ success: true, data: { count } });
  } catch (error) {
    console.error('Error fetching module count:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch module count' });
  }
});

// Get single module with lessons
router.get('/:id', protect, async (req, res) => {
  try {
    const module = await Module.findById(req.params.id)
      .populate('createdBy', '_id firstName lastName idNumber role profilePicture coverPhoto bio');

    if (!module) {
      return res.status(404).json({ success: false, message: 'Module not found' });
    }

    const lessons = await Lesson.find({ module: module._id })
      .populate('createdBy', '_id firstName lastName idNumber role profilePicture coverPhoto bio')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: { module, lessons } });
  } catch (error) {
    console.error('Get module error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Create module (teachers or admins)
router.post('/', protect, authorize('teacher', 'admin'), upload.single('coverPhoto'), async (req, res) => {
  try {
    const { title, description, category, moduleNumber } = req.body;

    if (!title || !category) {
      return res.status(400).json({ 
        success: false, 
        message: 'Title and category are required' 
      });
    }

    // Check if module number already exists for this category
    const existingModule = await Module.findOne({ 
      category, 
      moduleNumber: moduleNumber || 1 
    });

    if (existingModule) {
      return res.status(400).json({ 
        success: false, 
        message: `Module number ${moduleNumber || 1} already exists for ${category}` 
      });
    }

    const module = new Module({
      title,
      description: description || '',
      category: category || 'e-module',
      moduleNumber: moduleNumber || 1,
      createdBy: req.user.id,
    });

    // Handle cover photo upload if provided
    if (req.file) {
      // Validate file type
      if (!req.file.mimetype.startsWith('image/')) {
        return res.status(400).json({ success: false, message: 'Cover photo must be an image' });
      }

      let imageUrl = null;

      if (hasCloudinary) {
        try {
          const uploaded = await uploadBufferToCloudinary(req.file.buffer, req.file.originalname, 'ttls_modules');
          imageUrl = uploaded.secure_url;
        } catch (uploadErr) {
          console.error('Cloudinary upload error:', uploadErr);
          return res.status(500).json({ success: false, message: 'Failed to upload cover photo to Cloudinary' });
        }
      } else {
        // Local storage fallback
        imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
      }

      module.coverPhoto = imageUrl;
    }

    await module.save();
    await module.populate('createdBy', '_id firstName lastName idNumber role profilePicture coverPhoto bio');

    res.status(201).json({ success: true, data: module });
  } catch (error) {
    console.error('Create module error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Update module
router.put('/:id', protect, authorize('teacher', 'admin'), upload.single('coverPhoto'), async (req, res) => {
  try {
    const module = await Module.findById(req.params.id);

    if (!module) {
      return res.status(404).json({ success: false, message: 'Module not found' });
    }

    // Check if user is the creator or admin
    if (module.createdBy.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized to update this module' 
      });
    }

    const { title, description, moduleNumber } = req.body;

    if (title) module.title = title;
    if (description !== undefined) module.description = description;
    if (moduleNumber !== undefined) {
      // Check if new module number conflicts
      const existingModule = await Module.findOne({ 
        category: module.category, 
        moduleNumber,
        _id: { $ne: module._id }
      });
      if (existingModule) {
        return res.status(400).json({ 
          success: false, 
          message: `Module number ${moduleNumber} already exists for ${module.category}` 
        });
      }
      module.moduleNumber = moduleNumber;
    }

    // Handle cover photo upload if provided
    if (req.file) {
      // Validate file type
      if (!req.file.mimetype.startsWith('image/')) {
        return res.status(400).json({ success: false, message: 'Cover photo must be an image' });
      }

      let imageUrl = null;

      if (hasCloudinary) {
        try {
          // Delete old cover photo if exists
          if (module.coverPhoto) {
            const oldPublicId = module.coverPhoto.split('/').slice(-2).join('/').split('.')[0];
            try {
              await cloudinary.uploader.destroy(oldPublicId);
            } catch (err) {
              console.warn('Failed to delete old cover photo:', err);
            }
          }

          const uploaded = await uploadBufferToCloudinary(req.file.buffer, req.file.originalname, 'ttls_modules');
          imageUrl = uploaded.secure_url;
        } catch (uploadErr) {
          console.error('Cloudinary upload error:', uploadErr);
          return res.status(500).json({ success: false, message: 'Failed to upload cover photo to Cloudinary' });
        }
      } else {
        // Local storage fallback
        imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
      }

      module.coverPhoto = imageUrl;
    }

    await module.save();
    await module.populate('createdBy', '_id firstName lastName idNumber role profilePicture coverPhoto bio');

    res.json({ success: true, data: module });
  } catch (error) {
    console.error('Update module error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Delete module
router.delete('/:id', protect, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const module = await Module.findById(req.params.id);

    if (!module) {
      return res.status(404).json({ success: false, message: 'Module not found' });
    }

    // Check if user is the creator or admin
    if (module.createdBy.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized to delete this module' 
      });
    }

    // Check if module has lessons
    const lessonsCount = await Lesson.countDocuments({ module: module._id });
    if (lessonsCount > 0) {
      return res.status(400).json({ 
        success: false, 
        message: `Cannot delete module. It contains ${lessonsCount} lesson(s). Please delete or move the lessons first.` 
      });
    }

    await Module.findByIdAndDelete(req.params.id);

    res.json({ success: true, message: 'Module deleted successfully' });
  } catch (error) {
    console.error('Delete module error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
