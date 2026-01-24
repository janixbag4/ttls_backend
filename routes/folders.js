// routes/folders.js
const express = require('express');
const Folder = require('../models/Folder');
const Lesson = require('../models/Lesson');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// Create folder
router.post('/', protect, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const { name, parent } = req.body;
    const folder = await Folder.create({
      name,
      parent: parent || null,
      createdBy: req.user.id,
    });
    res.status(201).json({ success: true, data: folder });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to create folder' });
  }
});

// Get children (sub‑folders + lessons) of a folder (null = root)
