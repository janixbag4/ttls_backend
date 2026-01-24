const express = require('express');
const router = express.Router();
const Progress = require('../models/Progress');
const { protect, authorize } = require('../middleware/auth');

// Update or create progress for a student
// POST /api/progress
// body: { studentId, lessonId, activityId, status, score }
router.post('/', async (req, res) => {
  try {
    const { studentId, lessonId, activityId, status, score } = req.body;

    // If the caller is a student, they may only update their own progress
    let targetStudentId = studentId;
    if (req.user.role === 'student') {
      targetStudentId = req.user.id;
    } else {
      // teacher/admin must provide a studentId
      if (!studentId) return res.status(400).json({ success: false, message: 'Missing studentId' });
    }

    let prog = await Progress.findOne({ student: targetStudentId, lesson: lessonId || null, activity: activityId || null });
    if (!prog) {
      prog = new Progress({ student: targetStudentId, lesson: lessonId || null, activity: activityId || null, status: status || (req.user.role === 'student' ? 'in-progress' : 'in-progress'), score });
    } else {
      if (status) prog.status = status;
      if (score !== undefined) prog.score = score;
      prog.updatedAt = new Date();
    }

    await prog.save();
    res.json({ success: true, data: prog });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to update progress' });
  }
});

// Get progress for a student (self) or by teacher/admin
// GET /api/progress?studentId=...
router.get('/', async (req, res) => {
  try {
    const { studentId } = req.query;

    if (req.user.role === 'student') {
      // students can only fetch their own
      const progs = await Progress.find({ student: req.user.id }).populate('lesson activity');
      return res.json({ success: true, data: progs });
    }

    // teacher/admin can fetch by studentId
    if (!studentId) return res.status(400).json({ success: false, message: 'studentId required' });
    const progs = await Progress.find({ student: studentId }).populate('lesson activity');
    res.json({ success: true, data: progs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch progress' });
  }
});

module.exports = router;
