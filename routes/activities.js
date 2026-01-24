const express = require('express');
const router = express.Router();
const Activity = require('../models/Activity');
const Lesson = require('../models/Lesson');
const { protect, authorize } = require('../middleware/auth');
const multer = require('multer');
const { storage, cloudinary } = require('../config/cloudinary');

const upload = multer({ storage });

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// common mime -> extension mapping (keep lightweight)
const mimeExt = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'application/zip': '.zip',
  'text/plain': '.txt',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx'
};

function extractFilenameFromContentDisposition(header) {
  if (!header) return null;
  const rfcMatch = header.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  if (rfcMatch && rfcMatch[1]) return decodeURIComponent(rfcMatch[1].replace(/"/g, ''));
  const match = header.match(/filename=(?:"?)([^";]+)(?:"?)/i);
  if (match && match[1]) return match[1];
  return null;
}

function ensureFilenameHasExtension(filename, mime) {
  if (!filename) return filename;
  if (filename.indexOf('.') !== -1) return filename;
  const ext = mimeExt[mime];
  if (ext) return filename + ext;
  return filename;
}

function sanitizeName(name) {
  if (!name) return name;
  let s = name.replace(/^"|"$/g, '');
  s = s.replace(/[\\/\s]+/g, '_');
  s = s.replace(/[^A-Za-z0-9_\-\.\(\)\[\]]+/g, '');
  if (s.length > 120) s = s.slice(0, 120);
  return s;
}

function looksLikeGeneratedId(name) {
  if (!name) return true;
  const base = name.replace(/\.[^.]+$/, '');
  return /^\d+(_[A-Z0-9]+)?$/.test(base);
}

function chooseDownloadFilename(storedFilename, fallbackTitle, mime) {
  if (storedFilename && storedFilename.indexOf('.') !== -1 && !looksLikeGeneratedId(storedFilename)) {
    return sanitizeName(storedFilename);
  }
  if (storedFilename && !looksLikeGeneratedId(storedFilename)) {
    return sanitizeName(ensureFilenameHasExtension(storedFilename, mime));
  }
  const base = fallbackTitle ? fallbackTitle.replace(/[^A-Za-z0-9\s]/g, '').trim().slice(0, 80).replace(/\s+/g, '_') : 'download';
  const ext = mimeExt[mime] || '';
  return sanitizeName(base) + ext;
}

// Create activity (teacher/admin)
router.post('/', protect, authorize('teacher', 'admin'), upload.array('files', 6), async (req, res) => {
  try {
    const { title, description, lessonId, dueDate } = req.body;

    const files = [];
    if (req.files && req.files.length) {
      req.files.forEach((f) => {
        files.push({ url: f.path || f.secure_url, public_id: f.filename || f.public_id || f.path, filename: f.originalname, fileType: f.mimetype });
      });
    }

    const activity = new Activity({ title, description, files, dueDate: dueDate || null, lesson: lessonId || null, createdBy: req.user.id });
    await activity.save();

    res.status(201).json({ success: true, data: activity });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to create activity' });
  }
});

// List activities
router.get('/', protect, async (req, res) => {
  try {
    const activities = await Activity.find().populate('createdBy', 'firstName lastName idNumber');
    res.json({ success: true, data: activities });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch activities' });
  }
});

// Get activity
router.get('/:id', protect, async (req, res) => {
  try {
    const activity = await Activity.findById(req.params.id).populate('createdBy', 'firstName lastName idNumber');
    if (!activity) return res.status(404).json({ success: false, message: 'Activity not found' });
    res.json({ success: true, data: activity });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch activity' });
  }
});

// Student submit to activity
router.post('/:id/submit', protect, authorize('student'), upload.array('files', 6), async (req, res) => {
  try {
    const activity = await Activity.findById(req.params.id);
    if (!activity) return res.status(404).json({ success: false, message: 'Activity not found' });

    const files = [];
    if (req.files && req.files.length) {
      req.files.forEach((f) => {
        files.push({ url: f.path || f.secure_url, public_id: f.filename || f.public_id || f.path, filename: f.originalname, fileType: f.mimetype });
      });
    }

    const submission = {
      student: req.user.id,
      files,
      text: req.body.text || '',
      submittedAt: new Date(),
    };

    activity.submissions.push(submission);
    await activity.save();

    res.status(201).json({ success: true, message: 'Submission saved', submission });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to submit activity' });
  }
});

// Grade a submission (teacher/admin)
router.put('/:activityId/submissions/:submissionId/grade', protect, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const { grade, feedback } = req.body;
    const activity = await Activity.findById(req.params.activityId);
    if (!activity) return res.status(404).json({ success: false, message: 'Activity not found' });

    const sub = activity.submissions.id(req.params.submissionId);
    if (!sub) return res.status(404).json({ success: false, message: 'Submission not found' });

    sub.grade = grade;
    sub.feedback = feedback;
    await activity.save();

    res.json({ success: true, message: 'Submission graded', submission: sub });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to grade submission' });
  }
});

// Delete activity (admin or owner)
router.delete('/:id', protect, async (req, res) => {
  try {
    const activity = await Activity.findById(req.params.id);
    if (!activity) return res.status(404).json({ success: false, message: 'Activity not found' });

    if (req.user.role !== 'admin' && activity.createdBy?.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this activity' });
    }

    // delete files
    if (activity.files && activity.files.length) {
      for (const f of activity.files) {
        try {
          if (f.public_id) await cloudinary.uploader.destroy(f.public_id);
        } catch (e) {
          console.warn('Failed deleting file', e.message || e);
        }
      }
    }

    await activity.deleteOne();
    res.json({ success: true, message: 'Activity deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to delete activity' });
  }
});

module.exports = router;

// Download a submission file and force download
router.get('/:activityId/submissions/:submissionId/files/:fileId/download', protect, async (req, res) => {
  try {
    const { activityId, submissionId, fileId } = req.params;
    const activity = await Activity.findById(activityId);
    if (!activity) return res.status(404).json({ success: false, message: 'Activity not found' });

    const submission = activity.submissions.id(submissionId);
    if (!submission) return res.status(404).json({ success: false, message: 'Submission not found' });

    const file = submission.files.id ? submission.files.id(fileId) : submission.files.find(f => f._id == fileId || f.id == fileId);
    if (!file) return res.status(404).json({ success: false, message: 'File not found' });

    const fileUrl = file.url;
    let filename = file.filename || 'file';
    let mime = file.fileType || 'application/octet-stream';

    if (fileUrl && /^https?:\/\//i.test(fileUrl)) {
      const response = await axios.get(fileUrl, { responseType: 'stream' });
      const headers = response.headers || response.data?.headers || {};
      const sourceContentType = headers['content-type'] || headers['Content-Type'];
      const sourceDisposition = headers['content-disposition'] || headers['Content-Disposition'];
      if (sourceContentType) mime = sourceContentType;
      const extracted = extractFilenameFromContentDisposition(sourceDisposition);
      if (extracted) filename = extracted;
      filename = chooseDownloadFilename(filename || file.filename, activity.title || 'submission', mime);
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      response.data.pipe(res);
    } else {
      const localPath = path.isAbsolute(fileUrl) ? fileUrl : path.join(__dirname, '..', fileUrl);
      if (!fs.existsSync(localPath)) return res.status(404).json({ success: false, message: 'File not found on server' });
      filename = chooseDownloadFilename(filename || file.filename, activity.title || 'submission', mime);
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      fs.createReadStream(localPath).pipe(res);
    }
  } catch (err) {
    console.error('Download submission file error:', err);
    res.status(500).json({ success: false, message: 'Failed to download file' });
  }
});
