const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const Progress = require('../models/Progress');
const Submission = require('../models/Submission');
const Assignment = require('../models/Assignment');
const Lesson = require('../models/Lesson');
const LessonView = require('../models/LessonView');

// Get dashboard stats for teachers
router.get('/stats', protect, authorize('teacher', 'admin'), async (req, res) => {
  try {
    // Get all lessons created by this teacher
    const lessons = await Lesson.find({ createdBy: req.user.id });
    const lessonIds = lessons.map(l => l._id);

    // Get all assignments created by this teacher
    const assignments = await Assignment.find({ createdBy: req.user.id });
    const assignmentIds = assignments.map(a => a._id);

    // 1. Students viewing modules (students with progress on lessons)
    const studentsViewingModules = await Progress.distinct('student', {
      lesson: { $in: lessonIds },
      status: { $in: ['in-progress', 'completed'] }
    });

    // 2. Students submission of assignments
    const assignmentSubmissions = await Submission.countDocuments({
      assignment: { $in: assignmentIds }
    });

    // 3. Students submission of quizzes (assignments with type 'quiz')
    const quizAssignments = await Assignment.find({
      createdBy: req.user.id,
      type: 'quiz'
    });
    const quizAssignmentIds = quizAssignments.map(a => a._id);
    const quizSubmissions = await Submission.countDocuments({
      assignment: { $in: quizAssignmentIds }
    });

    // 4. Students submission of projects (assignments with type 'mini-project' or 'major-project')
    const projectAssignments = await Assignment.find({
      createdBy: req.user.id,
      type: { $in: ['mini-project', 'major-project'] }
    });
    const projectAssignmentIds = projectAssignments.map(a => a._id);
    const projectSubmissions = await Submission.countDocuments({
      assignment: { $in: projectAssignmentIds }
    });

    // 5. Students submission of essays (assignments with type 'essay')
    const essayAssignments = await Assignment.find({
      createdBy: req.user.id,
      type: 'essay'
    });
    const essayAssignmentIds = essayAssignments.map(a => a._id);
    const essaySubmissions = await Submission.countDocuments({
      assignment: { $in: essayAssignmentIds }
    });

    // Get time-series data for last 7 days
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);
      
      last7Days.push({
        date: date.toISOString().split('T')[0],
        start: date,
        end: nextDate
      });
    }

    // Get submissions by day
    const assignmentSubmissionsByDay = await Promise.all(
      last7Days.map(async (day) => {
        const count = await Submission.countDocuments({
          assignment: { $in: assignmentIds },
          submittedAt: { $gte: day.start, $lt: day.end }
        });
        return { date: day.date, value: count };
      })
    );

    const quizSubmissionsByDay = await Promise.all(
      last7Days.map(async (day) => {
        const count = await Submission.countDocuments({
          assignment: { $in: quizAssignmentIds },
          submittedAt: { $gte: day.start, $lt: day.end }
        });
        return { date: day.date, value: count };
      })
    );

    const projectSubmissionsByDay = await Promise.all(
      last7Days.map(async (day) => {
        const count = await Submission.countDocuments({
          assignment: { $in: projectAssignmentIds },
          submittedAt: { $gte: day.start, $lt: day.end }
        });
        return { date: day.date, value: count };
      })
    );

    const essaySubmissionsByDay = await Promise.all(
      last7Days.map(async (day) => {
        const count = await Submission.countDocuments({
          assignment: { $in: essayAssignmentIds },
          submittedAt: { $gte: day.start, $lt: day.end }
        });
        return { date: day.date, value: count };
      })
    );

    // Get students viewing modules by day (based on progress updates)
    const studentsViewingModulesByDay = await Promise.all(
      last7Days.map(async (day) => {
        const distinct = await Progress.distinct('student', {
          lesson: { $in: lessonIds },
          status: { $in: ['in-progress', 'completed'] },
          updatedAt: { $gte: day.start, $lt: day.end }
        });
        return { date: day.date, value: distinct.length };
      })
    );

    res.json({
      success: true,
      data: {
        studentsViewingModules: studentsViewingModules.length,
        assignmentSubmissions,
        quizSubmissions,
        projectSubmissions,
        essaySubmissions,
        totalLessons: lessons.length,
        totalAssignments: assignments.length,
        charts: {
          studentsViewingModules: studentsViewingModulesByDay,
          assignmentSubmissions: assignmentSubmissionsByDay,
          quizSubmissions: quizSubmissionsByDay,
          projectSubmissions: projectSubmissionsByDay,
          essaySubmissions: essaySubmissionsByDay
        }
      }
    });
  } catch (err) {
    console.error('Error fetching dashboard stats:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch dashboard stats' });
  }
});

// Get dashboard stats for students
router.get('/stats/student', protect, authorize('student'), async (req, res) => {
  try {
    const studentId = req.user.id;

    // Get all lessons available to student
    const allLessons = await Lesson.find({});
    const lessonIds = allLessons.map(l => l._id);

    // Get student's completed lessons from LessonView
    const completedLessonViews = await LessonView.find({ 
      student: studentId, 
      completed: true 
    });
    const completedLessons = completedLessonViews.length;
    
    // Get student's progress on lessons (for backward compatibility)
    const studentProgress = await Progress.find({ student: studentId, lesson: { $in: lessonIds } });
    const inProgressLessons = studentProgress.filter(p => p.status === 'in-progress').length;
    const totalLessons = allLessons.length;

    // Get all assignments
    const allAssignments = await Assignment.find({});
    const assignmentIds = allAssignments.map(a => a._id);

    // Get student's submissions
    const studentSubmissions = await Submission.find({ student: studentId });
    const totalSubmissions = studentSubmissions.length;
    const gradedSubmissions = studentSubmissions.filter(s => s.isGraded && s.grade !== null && s.grade !== undefined);
    
    // Calculate average grade (DEPRECATED - will be removed from frontend)
    let averageGrade = 0;
    if (gradedSubmissions.length > 0) {
      const totalScore = gradedSubmissions.reduce((sum, s) => {
        const score = s.grade || 0;
        const maxPoints = s.totalPoints || 100;
        return sum + (score / maxPoints * 100);
      }, 0);
      averageGrade = totalScore / gradedSubmissions.length;
    }

    // Get upcoming assignments (not yet submitted)
    const upcomingAssignments = allAssignments.filter(a => {
      const hasSubmission = studentSubmissions.some(s => {
        const assignmentId = s.assignment?._id || s.assignment;
        return assignmentId.toString() === a._id.toString();
      });
      return !hasSubmission;
    }).length;

    // Get time-series data for last 7 days
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);
      
      last7Days.push({
        date: date.toISOString().split('T')[0],
        start: date,
        end: nextDate
      });
    }

    // Get submissions by day
    const submissionsByDay = await Promise.all(
      last7Days.map(async (day) => {
        const count = await Submission.countDocuments({
          student: studentId,
          submittedAt: { $gte: day.start, $lt: day.end }
        });
        return { date: day.date, value: count };
      })
    );

    // Get progress updates by day
    const progressByDay = await Promise.all(
      last7Days.map(async (day) => {
        const count = await Progress.countDocuments({
          student: studentId,
          updatedAt: { $gte: day.start, $lt: day.end }
        });
        return { date: day.date, value: count };
      })
    );

    res.json({
      success: true,
      data: {
        completedLessons,
        inProgressLessons,
        totalLessons,
        totalSubmissions,
        gradedSubmissions: gradedSubmissions.length,
        averageGrade: Math.round(averageGrade * 10) / 10,
        upcomingAssignments,
        charts: {
          submissions: submissionsByDay,
          progress: progressByDay
        }
      }
    });
  } catch (err) {
    console.error('Error fetching student dashboard stats:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch dashboard stats' });
  }
});

module.exports = router;
