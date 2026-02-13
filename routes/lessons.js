const express = require('express');
const router = express.Router();
const Lesson = require('../models/Lesson');
const LessonView = require('../models/LessonView');
const Progress = require('../models/Progress');
const Submission = require('../models/Submission');
const Assignment = require('../models/Assignment');
const User = require('../models/User');
const { protect, authorize } = require('../middleware/auth');
const multer = require('multer');
const streamifier = require('streamifier');
const { storage, cloudinary, hasCloudinary } = require('../config/cloudinary');
const axios = require('axios'); // npm install axios
const rateLimit = require('express-rate-limit');
const archiver = require('archiver');
const validator = require('validator');
const fs = require('fs');
const path = require('path');

// map common mime -> extension
const mimeExt = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'application/zip': '.zip',
  'text/plain': '.txt',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx'
};

function extractFilenameFromContentDisposition(header) {
  if (!header) return null;
  // try RFC5987 first: filename*=UTF-8''encoded
  const rfcMatch = header.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  if (rfcMatch && rfcMatch[1]) return decodeURIComponent(rfcMatch[1].replace(/"/g, ''));
  const match = header.match(/filename=(?:"?)([^";]+)(?:"?)/i);
  if (match && match[1]) return match[1];
  return null;
}

function ensureFilenameHasExtension(filename, mime) {
  if (!filename) return filename;
  if (filename.indexOf('.') !== -1) return filename; // has extension
  const ext = mimeExt[mime];
  if (ext) return filename + ext;
  return filename; // fallback
}

function sanitizeName(name) {
  if (!name) return name;
  // remove surrounding quotes
  let s = name.replace(/^"|"$/g, '');
  // replace spaces and slashes
  s = s.replace(/[\\/\s]+/g, '_');
  // remove characters unsafe for filenames
  s = s.replace(/[^A-Za-z0-9_\-\.\(\)\[\]]+/g, '');
  // limit length
  if (s.length > 120) s = s.slice(0, 120);
  return s;
}

function looksLikeGeneratedId(name) {
  if (!name) return true;
  // e.g. pure numbers or timestamps or cloudinary public ids like 1765152789664_PPTX
  const base = name.replace(/\.[^.]+$/, '');
  return /^\d+(_[A-Z0-9]+)?$/.test(base);
}

function chooseDownloadFilename(storedFilename, fallbackTitle, mime) {
  // prefer a sane storedFilename if it has extension and doesn't look like an id
  if (storedFilename && storedFilename.indexOf('.') !== -1 && !looksLikeGeneratedId(storedFilename)) {
    return sanitizeName(storedFilename);
  }
  // if storedFilename looks bad but contains readable text, use it
  if (storedFilename && !looksLikeGeneratedId(storedFilename)) {
    return sanitizeName(ensureFilenameHasExtension(storedFilename, mime));
  }
  // otherwise build from fallbackTitle
  const base = fallbackTitle ? fallbackTitle.replace(/[^A-Za-z0-9\s]/g, '').trim().slice(0, 80).replace(/\s+/g, '_') : 'download';
  const ext = mimeExt[mime] || '';
  return sanitizeName(base) + ext;
}

// For routes that want to use configured storage (disk) directly
const upload = multer({ storage });

// Helper: upload a buffer to Cloudinary using upload_stream
function uploadBufferToCloudinary(buffer, originalname) {
  return new Promise((resolve, reject) => {
    if (!cloudinary) {
      return reject(new Error('Cloudinary is not configured. Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET environment variables.'));
    }
    if (!buffer || buffer.length === 0) {
      return reject(new Error('File buffer is empty'));
    }
    const publicId = `${Date.now()}_${originalname.replace(/\.[^/.]+$/, '')}`;
    const uploadStream = cloudinary.uploader.upload_stream(
      { 
        folder: 'ttls_lessons', 
        public_id: publicId, 
        resource_type: 'auto',
        timeout: 60000, // 60 second timeout
      }, 
      (error, result) => {
        if (error) {
          console.error('Cloudinary upload_stream error:', error);
          return reject(new Error(`Cloudinary upload failed: ${error.message || String(error)}`));
        }
        if (!result || !result.secure_url) {
          return reject(new Error('Cloudinary upload succeeded but no URL returned'));
        }
        resolve(result);
      }
    );
    
    uploadStream.on('error', (err) => {
      console.error('Cloudinary stream error:', err);
      reject(new Error(`Cloudinary stream error: ${err.message || String(err)}`));
    });
    
    try {
      streamifier.createReadStream(buffer).pipe(uploadStream);
    } catch (pipeError) {
      console.error('Error piping to Cloudinary:', pipeError);
      reject(new Error(`Failed to pipe file to Cloudinary: ${pipeError.message || String(pipeError)}`));
    }
  });
}

// Rate limiter for uploads
const uploadLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: 'Too many upload attempts, please try again later' });

// Create a lesson (teachers or admins)
// Accepts multipart/form-data with optional files under `files`
router.post('/', uploadLimiter, protect, authorize('teacher', 'admin'), async (req, res) => {
  // Pick parser: when Cloudinary is enabled, parse into memory so we can stream buffers
  // When Cloudinary is not enabled, use configured storage (disk) so files are saved to disk
  // Add limits: 50MB per file, up to 20 files, 10MB for cover photo
  const memOpts = { storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 20 } };
  const diskOpts = { storage, limits: { fileSize: 50 * 1024 * 1024, files: 20 } };
  const fields = [
    { name: 'files', maxCount: 20 },
    { name: 'coverPhoto', maxCount: 1 }
  ];
  const parser = hasCloudinary ? multer(memOpts).fields(fields) : multer(diskOpts).fields(fields);

  parser(req, res, async function (err) {
    if (err) {
      console.error('multer parse error', err);
      return res.status(500).json({ success: false, message: 'Failed to parse multipart form data' });
    }

    try {
      console.log('Create lesson request - hasCloudinary:', !!hasCloudinary);
      console.log('Content-Type:', req.headers['content-type']);
      console.log('Incoming files:', Array.isArray(req.files) ? req.files.map(f => ({ fieldname: f.fieldname, originalname: f.originalname, mimetype: f.mimetype, path: f.path || f.filename || (f.secure_url || '<memory>'), size: f.size })) : req.files);
      console.log('req.body (post-multer):', req.body);

      const { title, description, youtubeLink, iframeUrl, iframeTitle, category, module } = req.body;
      // parse links if provided (FormData sends as JSON string) and validate
      let links = [];
      if (req.body.links) {
        try {
          const raw = typeof req.body.links === 'string' ? JSON.parse(req.body.links) : req.body.links;
          if (Array.isArray(raw)) {
            links = raw.map(item => {
              const url = item && item.url ? String(item.url).trim() : '';
              const label = item && item.label ? String(item.label).trim() : '';
              if (!url) return null;
              try {
                const parsed = new URL(url);
                if (!['http:', 'https:'].includes(parsed.protocol)) return null;
                return { url: parsed.toString(), label };
              } catch (err) {
                if (validator.isURL(url, { protocols: ['http','https'], require_protocol: true })) return { url, label };
                return null;
              }
            }).filter(Boolean);
          }
        } catch (e) {
          console.warn('Failed to parse links:', e.message);
        }
      }

      const files = [];

      if (req.files && req.files.files && req.files.files.length) {
        const fileList = req.files.files;
        if (hasCloudinary) {
          // Upload each in-memory buffer to Cloudinary
          for (const f of fileList) {
            if (!f.buffer) {
              console.warn('Expected buffer for file but none present, skipping', f.originalname);
              continue;
            }
            try {
              const uploaded = await uploadBufferToCloudinary(f.buffer, f.originalname);
              files.push({ url: uploaded.secure_url, public_id: uploaded.public_id, filename: f.originalname, fileType: f.mimetype });
            } catch (uploadErr) {
              console.error('Failed to upload file to Cloudinary', f.originalname, uploadErr);
              const errorMsg = uploadErr.message || String(uploadErr);
              
              // Check if it's a password-protected PDF or other unsupported file type
              const isPasswordProtectedPDF = errorMsg.toLowerCase().includes('password-protected');
              const isUnsupportedFile = errorMsg.toLowerCase().includes('not supported') || 
                                       errorMsg.toLowerCase().includes('unsupported');
              
              if (isPasswordProtectedPDF || isUnsupportedFile) {
                // Fallback to local storage for unsupported files
                console.warn(`File "${f.originalname}" is not supported by Cloudinary (${errorMsg}), saving to local storage instead`);
                try {
                  const fs = require('fs');
                  const path = require('path');
                  const uploadDir = path.join(__dirname, '..', 'uploads');
                  if (!fs.existsSync(uploadDir)) {
                    fs.mkdirSync(uploadDir, { recursive: true });
                  }
                  const localFilename = `${Date.now()}_${f.originalname.replace(/\s+/g, '_')}`;
                  const localPath = path.join(uploadDir, localFilename);
                  fs.writeFileSync(localPath, f.buffer);
                  files.push({ url: localPath, public_id: null, filename: f.originalname, fileType: f.mimetype });
                  console.log(`File "${f.originalname}" saved to local storage: ${localPath}`);
                } catch (localErr) {
                  console.error('Failed to save file to local storage', localErr);
                  return res.status(500).json({ 
                    success: false, 
                    message: `Failed to upload file "${f.originalname}": Cloudinary doesn't support this file type (${errorMsg}), and local storage also failed. Please remove password protection from PDFs or use a different file format.`,
                    error: process.env.NODE_ENV !== 'production' ? localErr.message : undefined
                  });
                }
              } else {
                // Other Cloudinary errors (network, auth, etc.)
                console.error('Cloudinary upload error details:', {
                  message: errorMsg,
                  originalname: f.originalname,
                  size: f.buffer?.length,
                  mimetype: f.mimetype,
                });
                return res.status(500).json({ 
                  success: false, 
                  message: `Failed to upload file "${f.originalname}" to cloud storage: ${errorMsg}. Please check your Cloudinary configuration in the .env file (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET). If Cloudinary is not available, remove these variables to use local file storage instead.`,
                  error: process.env.NODE_ENV !== 'production' ? errorMsg : undefined
                });
              }
            }
          }
        } else {
          // Files were stored to disk by the multer diskStorage
          for (const f of req.files.files) {
            // Ensure we have a valid path
            const filePath = f.path || f.filename;
            if (!filePath) {
              console.error('File has no path or filename:', f);
              return res.status(500).json({ 
                success: false, 
                message: `Failed to save file "${f.originalname}" to disk storage.` 
              });
            }
            files.push({ url: filePath, public_id: null, filename: f.originalname, fileType: f.mimetype });
          }
        }
      }

      // Handle cover photo upload
      let coverPhotoUrl = '';
      if (req.files && req.files.coverPhoto && req.files.coverPhoto.length > 0) {
        const coverFile = req.files.coverPhoto[0];
        
        // Validate file type
        if (!coverFile.mimetype.startsWith('image/')) {
          return res.status(400).json({ success: false, message: 'Cover photo must be an image' });
        }

        if (hasCloudinary) {
          try {
            const uploaded = await uploadBufferToCloudinary(coverFile.buffer, coverFile.originalname, 'ttls_lessons');
            coverPhotoUrl = uploaded.secure_url;
          } catch (uploadErr) {
            console.error('Cloudinary upload error for cover photo:', uploadErr);
            return res.status(500).json({ success: false, message: 'Failed to upload cover photo to Cloudinary' });
          }
        } else {
          // Local storage fallback
          coverPhotoUrl = `${req.protocol}://${req.get('host')}/uploads/${coverFile.filename}`;
        }
      }

      const lesson = new Lesson({ 
        title, 
        description, 
        files, 
        links, 
        youtubeLink: youtubeLink || '', 
        iframeUrl: iframeUrl || '',
        iframeTitle: iframeTitle || '',
        category: category || 'e-module',
        module: module || null,
        coverPhoto: coverPhotoUrl,
        createdBy: req.user.id 
      });
      await lesson.save();

      res.status(201).json({ success: true, data: lesson });
    } catch (error) {
      console.error('Create lesson error:', error);
      const message = process.env.NODE_ENV === 'production' ? 'Failed to create lesson' : (error.message || String(error));
      res.status(500).json({ success: false, message });
    }
  });
});

// List lessons (public)
router.get('/', protect, async (req, res) => {
  try {
    const { category, module } = req.query;
    const query = {};
    if (category) query.category = category;
    if (module) query.module = module;
    
    const lessons = await Lesson.find(query)
      .populate('createdBy', '_id firstName lastName idNumber role profilePicture coverPhoto bio')
      .populate('module', 'title moduleNumber');
    res.json({ success: true, data: lessons });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Failed to fetch lessons' });
  }
});

// Get lesson count (public endpoint for home page stats)
router.get('/count', async (req, res) => {
  try {
    const count = await Lesson.countDocuments();
    res.json({ success: true, data: { count } });
  } catch (error) {
    console.error('Error fetching lesson count:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch lesson count' });
  }
});

// Get single lesson
router.get('/:id', protect, async (req, res) => {
  try {
    const lesson = await Lesson.findById(req.params.id)
      .populate('createdBy', '_id firstName lastName idNumber role profilePicture coverPhoto bio')
      .populate('module', 'title moduleNumber category');
    if (!lesson) return res.status(404).json({ success: false, message: 'Lesson not found' });
    res.json({ success: true, data: lesson });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Failed to fetch lesson' });
  }
});

// Delete lesson (only admin or the teacher who created it)
router.delete('/:id', protect, async (req, res) => {
  try {
    const lesson = await Lesson.findById(req.params.id);
    if (!lesson) return res.status(404).json({ success: false, message: 'Lesson not found' });

    // Authorization: admin or owner
    if (req.user.role !== 'admin' && lesson.createdBy?.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this lesson' });
    }

    // Delete files from Cloudinary if present
    if (lesson.files && lesson.files.length) {
      for (const f of lesson.files) {
        try {
          if (f.public_id && cloudinary) {
            await cloudinary.uploader.destroy(f.public_id);
          }
        } catch (err) {
          console.warn('Failed to delete file from Cloudinary', err.message || err);
        }
      }
    }

    await lesson.deleteOne();
    res.json({ success: true, message: 'Lesson deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Failed to delete lesson' });
  }
});

// Delete a specific file from a lesson
// DELETE /api/lessons/:lessonId/files/:fileId
router.delete('/:lessonId/files/:fileId', protect, authorize('teacher','admin'), async (req, res) => {
  try {
    const { lessonId, fileId } = req.params;
    const lesson = await Lesson.findById(lessonId);
    if (!lesson) return res.status(404).json({ success: false, message: 'Lesson not found' });

    // only admin or owner
    if (req.user.role !== 'admin' && lesson.createdBy?.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized to modify this lesson' });
    }

    // Try to find file using .id() method first, then fallback to array find
    let file = null;
    try {
      file = lesson.files.id(fileId);
    } catch (e) {
      // If .id() fails, try finding by _id in the array
      file = lesson.files.find(f => f._id && f._id.toString() === fileId);
    }
    
    if (!file) {
      return res.status(404).json({ success: false, message: 'File not found in lesson' });
    }

    // attempt to delete from Cloudinary if public_id present
    if (file.public_id && cloudinary) {
      try {
        await cloudinary.uploader.destroy(file.public_id);
      } catch (err) {
        console.warn('Failed to delete file from Cloudinary', err.message || err);
      }
    }

    // Remove file from array
    try {
      if (file.remove && typeof file.remove === 'function') {
        file.remove();
      } else {
        // Fallback: remove from array directly
        lesson.files = lesson.files.filter(f => {
          const fId = f._id ? f._id.toString() : (f.id ? f.id.toString() : null);
          return fId && fId !== fileId;
        });
      }
    } catch (removeErr) {
      console.warn('Error removing file from array, using filter method:', removeErr);
      // Force removal using filter
      lesson.files = lesson.files.filter(f => {
        const fId = f._id ? f._id.toString() : (f.id ? f.id.toString() : null);
        return fId && fId !== fileId;
      });
    }
    
    await lesson.save();

    res.json({ success: true, message: 'File removed', data: lesson });
  } catch (err) {
    console.error('Delete file error:', err);
    console.error('Error details:', {
      message: err.message,
      stack: err.stack,
      name: err.name
    });
    res.status(500).json({ 
      success: false, 
      message: 'Failed to remove file',
      error: process.env.NODE_ENV !== 'production' ? err.message : undefined
    });
  }
});

// Update lesson (only admin or owner). Accepts multipart with new files to append.
router.put('/:id', protect, authorize('teacher','admin'), async (req, res) => {
  // Use same parser logic as POST route
  const memOpts = { storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 20 } };
  const diskOpts = { storage, limits: { fileSize: 50 * 1024 * 1024, files: 20 } };
  const fields = [
    { name: 'files', maxCount: 20 },
    { name: 'coverPhoto', maxCount: 1 }
  ];
  const parser = hasCloudinary ? multer(memOpts).fields(fields) : multer(diskOpts).fields(fields);

  parser(req, res, async function (err) {
    if (err) {
      console.error('multer parse error', err);
      return res.status(500).json({ success: false, message: 'Failed to parse multipart form data' });
    }

    try {
      const lesson = await Lesson.findById(req.params.id);
      if (!lesson) return res.status(404).json({ success: false, message: 'Lesson not found' });

      if (req.user.role !== 'admin' && lesson.createdBy?.toString() !== req.user.id) {
        return res.status(403).json({ success: false, message: 'Not authorized to edit this lesson' });
      }

      const { title, description, youtubeLink, iframeUrl, iframeTitle, category, module } = req.body;
      
      // parse links if provided
      let links = null;
      if (req.body.links) {
        try {
          const raw = typeof req.body.links === 'string' ? JSON.parse(req.body.links) : req.body.links;
          if (Array.isArray(raw)) {
            links = raw.map(item => {
              const url = item && item.url ? String(item.url).trim() : '';
              const label = item && item.label ? String(item.label).trim() : '';
              if (!url) return null;
              try {
                const parsed = new URL(url);
                if (!['http:', 'https:'].includes(parsed.protocol)) return null;
                return { url: parsed.toString(), label };
              } catch (err) {
                if (validator.isURL(url, { protocols: ['http','https'], require_protocol: true })) return { url, label };
                return null;
              }
            }).filter(Boolean);
          }
        } catch (e) {
          console.warn('Failed to parse links on update:', e.message);
        }
      }
      
      if (title !== undefined && title !== null) lesson.title = title;
      if (description !== undefined) lesson.description = description;
      if (youtubeLink !== undefined) lesson.youtubeLink = youtubeLink || '';
      if (iframeUrl !== undefined) lesson.iframeUrl = iframeUrl || '';
      if (iframeTitle !== undefined) lesson.iframeTitle = iframeTitle || '';
      if (category !== undefined && category !== null) lesson.category = category;
      if (module !== undefined) {
        // Handle empty string as null
        const moduleId = module && module.trim() !== '' ? module : null;
        lesson.module = moduleId;
        // Also update folder field for backward compatibility
        lesson.folder = moduleId;
      }

      // Handle file uploads (same logic as POST route)
      if (req.files && req.files.files && req.files.files.length) {
        const newFiles = [];
        if (hasCloudinary) {
          for (const f of req.files.files) {
            if (!f.buffer) {
              console.warn('Expected buffer for file but none present, skipping', f.originalname);
              continue;
            }
            try {
              const uploaded = await uploadBufferToCloudinary(f.buffer, f.originalname);
              newFiles.push({ url: uploaded.secure_url, public_id: uploaded.public_id, filename: f.originalname, fileType: f.mimetype });
            } catch (uploadErr) {
              console.error('Failed to upload file to Cloudinary', f.originalname, uploadErr);
              const errorMsg = uploadErr.message || String(uploadErr);
              const isPasswordProtectedPDF = errorMsg.toLowerCase().includes('password-protected');
              const isUnsupportedFile = errorMsg.toLowerCase().includes('not supported') || 
                                       errorMsg.toLowerCase().includes('unsupported');
              
              if (isPasswordProtectedPDF || isUnsupportedFile) {
                console.warn(`File "${f.originalname}" is not supported by Cloudinary (${errorMsg}), saving to local storage instead`);
                try {
                  const fs = require('fs');
                  const path = require('path');
                  const uploadDir = path.join(__dirname, '..', 'uploads');
                  if (!fs.existsSync(uploadDir)) {
                    fs.mkdirSync(uploadDir, { recursive: true });
                  }
                  const localFilename = `${Date.now()}_${f.originalname.replace(/\s+/g, '_')}`;
                  const localPath = path.join(uploadDir, localFilename);
                  fs.writeFileSync(localPath, f.buffer);
                  newFiles.push({ url: localPath, public_id: null, filename: f.originalname, fileType: f.mimetype });
                  console.log(`File "${f.originalname}" saved to local storage: ${localPath}`);
                } catch (localErr) {
                  console.error('Failed to save file to local storage', localErr);
                  return res.status(500).json({ 
                    success: false, 
                    message: `Failed to upload file "${f.originalname}": Cloudinary doesn't support this file type (${errorMsg}), and local storage also failed.`,
                    error: process.env.NODE_ENV !== 'production' ? localErr.message : undefined
                  });
                }
              } else {
                return res.status(500).json({ 
                  success: false, 
                  message: `Failed to upload file "${f.originalname}" to cloud storage: ${errorMsg}.`,
                  error: process.env.NODE_ENV !== 'production' ? errorMsg : undefined
                });
              }
            }
          }
        } else {
          for (const f of req.files.files) {
            const filePath = f.path || f.filename;
            if (!filePath) {
              console.error('File has no path or filename:', f);
              continue;
            }
            newFiles.push({ url: filePath, public_id: null, filename: f.originalname, fileType: f.mimetype });
          }
        }
        lesson.files.push(...newFiles);
      }

      if (links !== null) {
        // replace links array if provided
        lesson.links = Array.isArray(links) ? links : [];
      }

      // Handle cover photo upload
      if (req.files && req.files.coverPhoto && req.files.coverPhoto.length > 0) {
        const coverFile = req.files.coverPhoto[0];
        
        // Validate file type
        if (!coverFile.mimetype.startsWith('image/')) {
          return res.status(400).json({ success: false, message: 'Cover photo must be an image' });
        }

        let coverPhotoUrl = '';
        if (hasCloudinary) {
          try {
            // Delete old cover photo if exists
            if (lesson.coverPhoto) {
              const oldPublicId = lesson.coverPhoto.split('/').slice(-2).join('/').split('.')[0];
              try {
                await cloudinary.uploader.destroy(oldPublicId);
              } catch (err) {
                console.warn('Failed to delete old cover photo:', err);
              }
            }

            const uploaded = await uploadBufferToCloudinary(coverFile.buffer, coverFile.originalname, 'ttls_lessons');
            coverPhotoUrl = uploaded.secure_url;
          } catch (uploadErr) {
            console.error('Cloudinary upload error for cover photo:', uploadErr);
            return res.status(500).json({ success: false, message: 'Failed to upload cover photo to Cloudinary' });
          }
        } else {
          // Local storage fallback
          coverPhotoUrl = `${req.protocol}://${req.get('host')}/uploads/${coverFile.filename}`;
        }
        
        lesson.coverPhoto = coverPhotoUrl;
      }

      await lesson.save();
      const updatedLesson = await Lesson.findById(lesson._id)
        .populate('createdBy', '_id firstName lastName idNumber role profilePicture coverPhoto bio')
        .populate('module', 'title moduleNumber category');
      res.json({ success: true, data: updatedLesson });
    } catch (err) {
      console.error('Update lesson error:', err);
      console.error('Error details:', {
        message: err.message,
        stack: err.stack,
        name: err.name
      });
      res.status(500).json({ 
        success: false, 
        message: 'Failed to update lesson', 
        error: process.env.NODE_ENV !== 'production' ? (err.message || String(err)) : undefined,
        details: process.env.NODE_ENV !== 'production' ? {
          name: err.name,
          stack: err.stack
        } : undefined
      });
    }
  });
});

// Track lesson view (when student views lesson)
router.post('/:id/view', protect, async (req, res) => {
  try {
    const lesson = await Lesson.findById(req.params.id);
    if (!lesson) return res.status(404).json({ success: false, message: 'Lesson not found' });
    
    if (req.user.role !== 'student') {
      return res.status(403).json({ success: false, message: 'Only students can track lesson views' });
    }
    
    let lessonView = await LessonView.findOne({ lesson: req.params.id, student: req.user.id });
    if (lessonView) {
      lessonView.viewCount += 1;
      lessonView.lastViewedAt = new Date();
      if (!lessonView.openedAt) {
        lessonView.openedAt = new Date();
      }
    } else {
      lessonView = new LessonView({
        lesson: req.params.id,
        student: req.user.id,
        openedAt: new Date(),
      });
    }
    await lessonView.save();
    
    res.json({ success: true, data: lessonView });
  } catch (err) {
    console.error('Track lesson view error:', err);
    res.status(500).json({ success: false, message: 'Failed to track lesson view' });
  }
});

// Mark lesson as complete (student only)
router.post('/:id/complete', protect, async (req, res) => {
  try {
    const lesson = await Lesson.findById(req.params.id);
    if (!lesson) return res.status(404).json({ success: false, message: 'Lesson not found' });
    
    if (req.user.role !== 'student') {
      return res.status(403).json({ success: false, message: 'Only students can mark lessons complete' });
    }
    
    // Find or create LessonView for this student-lesson pair
    let lessonView = await LessonView.findOne({ lesson: req.params.id, student: req.user.id });
    if (!lessonView) {
      lessonView = new LessonView({
        lesson: req.params.id,
        student: req.user.id,
        openedAt: new Date(),
      });
    }
    
    // Mark as complete
    lessonView.completed = true;
    lessonView.completedAt = new Date();
    await lessonView.save();
    
    res.json({ success: true, message: 'Lesson marked as complete', data: lessonView });
  } catch (err) {
    console.error('Mark lesson complete error:', err);
    res.status(500).json({ success: false, message: 'Failed to mark lesson as complete' });
  }
});

// Get lesson analytics (teacher/admin only)
router.get('/:id/analytics', protect, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const lesson = await Lesson.findById(req.params.id);
    if (!lesson) return res.status(404).json({ success: false, message: 'Lesson not found' });
    
    // Check if user is the creator or admin
    if (req.user.role !== 'admin' && lesson.createdBy?.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized to view analytics' });
    }
    
    // Get all students (enrolled students - all students in the system for now)
    const allStudents = await User.find({ role: 'student', status: 'approved' }).select('_id firstName lastName idNumber');
    
    // Get lesson views
    const lessonViews = await LessonView.find({ lesson: req.params.id })
      .populate('student', 'firstName lastName idNumber')
      .sort({ lastViewedAt: -1 });
    
    // Get students who opened the lesson
    const openedStudents = await LessonView.find({ 
      lesson: req.params.id, 
      openedAt: { $exists: true, $ne: null } 
    }).populate('student', 'firstName lastName idNumber');
    
    // Get submissions for assignments related to this lesson
    const assignments = await Assignment.find({ lesson: req.params.id });
    const assignmentIds = assignments.map(a => a._id);
    const submissions = await Submission.find({ assignment: { $in: assignmentIds } })
      .populate('student', 'firstName lastName idNumber')
      .populate('assignment', 'title type');
    
    // Get progress records
    const progressRecords = await Progress.find({ lesson: req.params.id })
      .populate('student', 'firstName lastName idNumber');
    
    // Build student analytics
    const studentAnalytics = allStudents.map(student => {
      const view = lessonViews.find(v => v.student._id.toString() === student._id.toString());
      const opened = openedStudents.find(o => o.student._id.toString() === student._id.toString());
      const studentSubmissions = submissions.filter(s => s.student._id.toString() === student._id.toString());
      const progress = progressRecords.find(p => p.student._id.toString() === student._id.toString());
      
      // Calculate scores from submissions
      const scores = studentSubmissions
        .filter(s => s.grade !== undefined && s.grade !== null)
        .map(s => ({ assignment: s.assignment.title, score: s.grade, totalPoints: s.totalPoints || 100 }));
      
      return {
        student: {
          _id: student._id,
          firstName: student.firstName,
          lastName: student.lastName,
          idNumber: student.idNumber,
        },
        hasViewed: !!view,
        hasOpened: !!opened,
        viewCount: view?.viewCount || 0,
        lastViewedAt: view?.lastViewedAt || null,
        openedAt: opened?.openedAt || null,
        hasSubmitted: studentSubmissions.length > 0,
        submissionCount: studentSubmissions.length,
        progress: progress ? {
          status: progress.status,
          score: progress.score,
        } : null,
        scores: scores,
        averageScore: scores.length > 0 
          ? scores.reduce((sum, s) => sum + (s.score / (s.totalPoints || 100) * 100), 0) / scores.length 
          : null,
      };
    });
    
    res.json({
      success: true,
      data: {
        lesson: {
          _id: lesson._id,
          title: lesson.title,
        },
        totalStudents: allStudents.length,
        studentsViewed: lessonViews.length,
        studentsOpened: openedStudents.length,
        studentsSubmitted: new Set(submissions.map(s => s.student._id.toString())).size,
        studentAnalytics: studentAnalytics,
        assignments: assignments.map(a => ({
          _id: a._id,
          title: a.title,
          type: a.type,
          submissionCount: submissions.filter(s => s.assignment._id.toString() === a._id.toString()).length,
        })),
      },
    });
  } catch (err) {
    console.error('Get lesson analytics error:', err);
    res.status(500).json({ success: false, message: 'Failed to get lesson analytics' });
  }
});

// Download a specific file - Simple approach for prototype (returns URL or redirects)
// GET /api/lessons/:lessonId/files/:fileId/download
router.get('/:lessonId/files/:fileId/download', protect, async (req, res) => {
  try {
    const { lessonId, fileId } = req.params;
    
    const lesson = await Lesson.findById(lessonId);
    if (!lesson) {
      return res.status(404).json({ success: false, message: 'Lesson not found' });
    }

    // Try to find file
    let file = null;
    try {
      file = lesson.files.id(fileId);
    } catch (e) {
      file = lesson.files.find(f => {
        const fId = f._id ? f._id.toString() : (f.id ? f.id.toString() : null);
        return fId === fileId;
      });
    }
    
    if (!file || !file.url) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }

    let downloadUrl = file.url;
    
    // For Cloudinary PDFs, fix the resource type
    if (downloadUrl.includes('cloudinary.com')) {
      const isPDF = file.fileType === 'application/pdf' || 
                   (file.filename && file.filename.toLowerCase().endsWith('.pdf'));
      
      if (isPDF && downloadUrl.includes('/image/upload/')) {
        // Convert to raw resource type for PDFs
        downloadUrl = downloadUrl.replace('/image/upload/', '/raw/upload/');
      }
      
      // If we have public_id and Cloudinary SDK, generate correct URL
      if (file.public_id && cloudinary && isPDF) {
        try {
          downloadUrl = cloudinary.url(file.public_id, {
            resource_type: 'raw',
            secure: true
          });
        } catch (e) {
          // Fall back to modified URL
        }
      }
    }

    // For remote URLs (Cloudinary), stream the file and set headers so filename and extension are preserved
    if (downloadUrl && /^https?:\/\//i.test(downloadUrl)) {
      try {
        const responseStream = await axios.get(downloadUrl, { responseType: 'stream' });
        const headers = responseStream.headers || responseStream.data?.headers || {};
        const sourceContentType = headers['content-type'] || headers['Content-Type'];
        const sourceDisposition = headers['content-disposition'] || headers['Content-Disposition'];
        let mime = file.fileType || sourceContentType || 'application/octet-stream';
        let filename = file.filename || 'file';
        const extracted = extractFilenameFromContentDisposition(sourceDisposition);
        if (extracted) filename = extracted;
        filename = chooseDownloadFilename(filename, lesson.title || 'file', mime);
        res.setHeader('Content-Type', mime);
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
        responseStream.data.pipe(res);
      } catch (err) {
        console.warn('Failed to stream remote file, falling back to redirect:', err && err.message ? err.message : err);
        // Fallback to redirect (previous behavior) if streaming fails
        res.redirect(302, downloadUrl);
      }
    } else {
      // For local files, serve them directly
      const localPath = path.isAbsolute(downloadUrl) ? downloadUrl : path.join(__dirname, '..', downloadUrl);
      if (!fs.existsSync(localPath)) {
        return res.status(404).json({ success: false, message: 'File not found on server' });
      }
      const filename = file.filename || 'file';
      res.setHeader('Content-Type', file.fileType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      const readStream = fs.createReadStream(localPath);
      readStream.pipe(res);
    }
    
  } catch (err) {
    console.error('Download file error:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to download file',
      error: process.env.NODE_ENV !== 'production' ? err.message : undefined
    });
  }
});


// Preview (inline) a specific file for browser display (images/videos)
router.get('/:lessonId/files/:fileId/preview', protect, async (req, res) => {
  try {
    const { lessonId, fileId } = req.params;
    const lesson = await Lesson.findById(lessonId);
    if (!lesson) return res.status(404).json({ success: false, message: 'Lesson not found' });
    const file = lesson.files.id(fileId);
    if (!file) return res.status(404).json({ success: false, message: 'File not found' });

    const fileUrl = file.url;
    const mime = file.fileType || 'application/octet-stream';

    if (fileUrl && /^https?:\/\//i.test(fileUrl)) {
      const responseStream = await axios.get(fileUrl, { responseType: 'stream' });
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.filename || 'preview')}"`);
      responseStream.data.pipe(res);
    } else {
      const fs = require('fs');
      const path = require('path');
      const localPath = path.isAbsolute(fileUrl) ? fileUrl : path.join(__dirname, '..', fileUrl);
      if (!fs.existsSync(localPath)) return res.status(404).json({ success: false, message: 'File not found on server' });
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.filename || 'preview')}"`);
      fs.createReadStream(localPath).pipe(res);
    }
  } catch (err) {
    console.error('Preview file error:', err);
    res.status(500).json({ success: false, message: 'Failed to preview file' });
  }
});


// Download a zip of all files in a lesson
router.get('/:lessonId/download-zip', protect, async (req, res) => {
  try {
    const { lessonId } = req.params;
    const lesson = await Lesson.findById(lessonId);
    if (!lesson) return res.status(404).json({ success: false, message: 'Lesson not found' });

    res.setHeader('Content-Type', 'application/zip');
    const zipName = `${(lesson.title || 'lesson').replace(/[^a-z0-9_-]+/gi, '_')}.zip`;
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', err => { throw err; });
    archive.pipe(res);

    for (const f of lesson.files || []) {
      const filename = chooseDownloadFilename(f.filename || f.public_id || 'file', lesson.title, f.fileType || 'application/octet-stream');
      if (f.url && /^https?:\/\//i.test(f.url)) {
        const resp = await axios.get(f.url, { responseType: 'stream' });
        archive.append(resp.data, { name: filename });
      } else {
        const fs = require('fs');
        const path = require('path');
        const localPath = path.isAbsolute(f.url) ? f.url : path.join(__dirname, '..', f.url);
        if (fs.existsSync(localPath)) {
          archive.file(localPath, { name: filename });
        }
      }
    }

    await archive.finalize();
  } catch (err) {
    console.error('Download zip error:', err);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Failed to create ZIP' });
  }
});



// Debug upload endpoint (memory storage) - for diagnosing client-side upload issues
const debugRouter = require('express').Router();
const memUpload = multer({ storage: multer.memoryStorage() });
debugRouter.post('/debug/upload', memUpload.array('files', 12), (req, res) => {
  try {
    console.log('DEBUG /debug/upload - headers:', req.headers['content-type']);
    console.log('DEBUG req.is multipart?:', req.is('multipart/*'));
    console.log('DEBUG req.body:', req.body);
    console.log('DEBUG req.files:', req.files ? req.files.map(f => ({ originalname: f.originalname, size: f.size })) : req.files);
    res.json({ success: true, body: req.body, files: (req.files || []).map(f => ({ originalname: f.originalname, size: f.size })) });
  } catch (err) {
    console.error('Debug upload error', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.use(debugRouter);

module.exports = router;
