const express = require('express');
const router = express.Router();
const Progress = require('../models/Progress');
const LessonView = require('../models/LessonView');
const Lesson = require('../models/Lesson');
const { protect, authorize } = require('../middleware/auth');

// Sync Progress records with LessonView completion status
// POST /api/progress/sync/completion-status
router.post('/sync/completion-status', protect, async (req, res) => {
  try {
    let targetStudentId = req.user.id;
    
    // Teachers/admins can sync for a specific student
    if (req.user.role === 'teacher' || req.user.role === 'admin') {
      const { studentId } = req.body;
      if (studentId) targetStudentId = studentId;
    }

    // Get all LessonView records where completed = true
    const completedLessons = await LessonView.find({ 
      student: targetStudentId, 
      completed: true 
    }).select('lesson completedAt');

    let syncedCount = 0;

    // Update corresponding Progress records to status = 'completed'
    for (const lessonView of completedLessons) {
      const updated = await Progress.findOneAndUpdate(
        { student: targetStudentId, lesson: lessonView.lesson },
        { status: 'completed', updatedAt: lessonView.completedAt || new Date() },
        { new: true }
      );
      if (updated) syncedCount++;
    }

    console.log(`✓ Synced ${syncedCount} Progress records to completed status for student ${targetStudentId}`);
    res.json({ 
      success: true, 
      message: `Synced ${syncedCount} lessons to completed status`,
      syncedCount 
    });
  } catch (err) {
    console.error('Sync Error:', err);
    res.status(500).json({ success: false, message: 'Failed to sync progress' });
  }
});

// Get all lessons with their completion status from LessonView (same source as dashboard)
// GET /api/progress/lessons-with-status
router.get('/lessons-with-status', protect, async (req, res) => {
  try {
    let targetStudentId = req.user.id;

    // Teachers/admins can view a specific student's progress
    if (req.user.role === 'teacher' || req.user.role === 'admin') {
      const { studentId } = req.query;
      if (studentId) targetStudentId = studentId;
    }

    // Get all lessons
    const allLessons = await Lesson.find({}).select('_id title');

    // Get completed lessons from LessonView (source of truth)
    const completedLessonViews = await LessonView.find({
      student: targetStudentId,
      completed: true
    }).select('lesson completedAt');

    // Get in-progress lessons from Progress
    const inProgressProgress = await Progress.find({
      student: targetStudentId,
      status: 'in-progress'
    }).select('lesson');

    // Create maps for quick lookup
    const completedMap = {};
    const completedAtMap = {};
    completedLessonViews.forEach(lv => {
      const lessonId = lv.lesson.toString();
      completedMap[lessonId] = true;
      completedAtMap[lessonId] = lv.completedAt;
    });

    const inProgressMap = {};
    inProgressProgress.forEach(p => {
      inProgressMap[p.lesson.toString()] = true;
    });

    // Build lesson data with status
    const lessonData = allLessons.map(lesson => {
      const lessonId = lesson._id.toString();
      let status = 'not-started';
      
      if (completedMap[lessonId]) {
        status = 'completed';
      } else if (inProgressMap[lessonId]) {
        status = 'in-progress';
      }

      return {
        lessonId: lesson._id,
        lessonTitle: lesson.title,
        status,
        isCompleted: status === 'completed',
        completedAt: completedAtMap[lessonId]
      };
    });

    res.json({ success: true, data: lessonData });
  } catch (err) {
    console.error('Error fetching lessons with status:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch lessons with status' });
  }
});


// POST /api/progress
// body: { studentId, lessonId, activityId, status, score }
router.post('/', protect, async (req, res) => {
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
router.get('/', protect, async (req, res) => {
  try {
    const { studentId } = req.query;

    if (req.user.role === 'student') {
      // students can only fetch their own
      const progs = await Progress.find({ student: req.user.id }).populate('lesson activity');
      console.log(`Fetched ${progs.length} progress records for student ${req.user.id}:`, 
        progs.map(p => ({ student: p.student, lesson: p.lesson?._id || p.lesson, status: p.status }))
      );
      return res.json({ success: true, data: progs });
    }

    // teacher/admin can fetch by studentId
    if (!studentId) return res.status(400).json({ success: false, message: 'studentId required' });
    const progs = await Progress.find({ student: studentId }).populate('lesson activity');
    console.log(`Fetched ${progs.length} progress records for student ${studentId}:`, 
      progs.map(p => ({ student: p.student, lesson: p.lesson?._id || p.lesson, status: p.status }))
    );
    res.json({ success: true, data: progs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch progress' });
  }
});

module.exports = router;
