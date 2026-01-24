const express = require('express');
const router = express.Router();
const multer = require('multer');
const streamifier = require('streamifier');
const { cloudinary, hasCloudinary } = require('../config/cloudinary');
const { protect, authorize } = require('../middleware/auth');
const Assignment = require('../models/Assignment');
const Submission = require('../models/Submission');
// memory storage for attachments (we upload buffers to Cloudinary when available)
const upload = multer({ storage: multer.memoryStorage() });

// helper: upload buffer to Cloudinary using upload_stream
function uploadBufferToCloudinary(buffer, originalname, folder = 'ttls_assignments') {
  return new Promise((resolve, reject) => {
    if (!cloudinary) return reject(new Error('Cloudinary is not configured'));
    const publicId = `${Date.now()}_${originalname.replace(/\.[^/.]+$/, '')}`;
    const stream = cloudinary.uploader.upload_stream({ folder, public_id: publicId, resource_type: 'auto' }, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

// Create assignment (teacher only)
router.post('/', protect, authorize('teacher','admin'), upload.array('attachments', 10), async (req, res) => {
  try {
    console.log('Create assignment - hasCloudinary:', !!hasCloudinary);
    console.log('Create assignment - headers content-type:', req.headers['content-type']);
    console.log('Create assignment - req.body (post-multer):', req.body);
    console.log('Create assignment - req.files:', Array.isArray(req.files) ? req.files.map(f => ({ originalname: f.originalname, mimetype: f.mimetype, size: f.size, hasBuffer: !!f.buffer })) : req.files);

    const { title, description, instructions, type, dueDate, lessonId, questions, allowAutomaticGrading, allowResubmission } = req.body;
    
    // Parse questions if provided (for quizzes)
    let parsedQuestions = [];
    let totalPoints = 0;
    if (type === 'quiz' && questions) {
      try {
        parsedQuestions = typeof questions === 'string' ? JSON.parse(questions) : questions;
        if (Array.isArray(parsedQuestions)) {
          parsedQuestions = parsedQuestions.map((q, index) => ({
            question: q.question || '',
            type: q.type || 'multiple-choice',
            options: q.options || [],
            correctAnswer: q.correctAnswer || '',
            correctAnswers: q.correctAnswers || [],
            points: q.points || 1,
            order: q.order !== undefined ? q.order : index,
          }));
          totalPoints = parsedQuestions.reduce((sum, q) => sum + (q.points || 1), 0);
        }
      } catch (e) {
        console.warn('Failed to parse questions:', e.message);
      }
    }
    
    const assignment = await Assignment.create({
      title,
      description,
      instructions,
      type,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      lesson: lessonId || undefined,
      createdBy: req.user.id,
      questions: parsedQuestions,
      totalPoints: totalPoints,
      allowAutomaticGrading: allowAutomaticGrading !== undefined ? allowAutomaticGrading : (type === 'quiz'),
      allowResubmission: allowResubmission !== undefined ? allowResubmission : false,
    });
    // attachments handling: upload buffers to Cloudinary when configured, otherwise save basic metadata
    if (req.files && req.files.length) {
      const saved = [];
      if (hasCloudinary) {
        for (const f of req.files) {
          try {
            if (!f.buffer) continue;
            const uploaded = await uploadBufferToCloudinary(f.buffer, f.originalname);
            saved.push({ url: uploaded.secure_url, public_id: uploaded.public_id, filename: f.originalname, fileType: f.mimetype });
          } catch (err) {
            console.error('Failed to upload attachment to Cloudinary', f.originalname, err);
            return res.status(500).json({ success: false, message: 'Failed to upload attachments' });
          }
        }
      } else {
        // store minimal metadata (file path handling not supported here)
        for (const f of req.files) saved.push({ filename: f.originalname, fileType: f.mimetype, url: f.path || null, public_id: null });
      }
      assignment.attachments = saved;
      await assignment.save();
    }
    res.status(201).json({ success: true, data: assignment });
  } catch (err) {
    console.error('Create assignment error', err && err.stack ? err.stack : err);
    const message = process.env.NODE_ENV === 'production' ? 'Failed to create assignment' : (err && err.message ? err.message : String(err));
    res.status(500).json({ success: false, message });
  }
});

// List assignments (students and teachers) - teacher can see all, students see all too but can be filtered later
router.get('/', protect, async (req, res) => {
  try {
    const filter = {};
    if (req.query.lessonId) filter.lesson = req.query.lessonId;
    const items = await Assignment.find(filter).populate('createdBy', 'firstName lastName email profilePicture').sort({ createdAt: -1 });
    res.json({ success: true, data: items });
  } catch (err) {
    console.error('List assignments', err);
    res.status(500).json({ success: false, message: 'Failed to list assignments' });
  }
});

// Get single assignment
router.get('/:id', protect, async (req, res) => {
  try {
    const a = await Assignment.findById(req.params.id).populate('createdBy', 'firstName lastName profilePicture');
    if (!a) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: a });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to get assignment' });
  }
});

// Update assignment (teacher only)
router.put('/:id', protect, authorize('teacher','admin'), upload.array('attachments', 10), async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.id);
    if (!assignment) return res.status(404).json({ success: false, message: 'Assignment not found' });

    if (assignment.createdBy.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized to edit this assignment' });
    }

    const { title, description, instructions, type, dueDate, lessonId, questions, allowAutomaticGrading, allowResubmission } = req.body;

    if (title) assignment.title = title;
    if (description !== undefined) assignment.description = description;
    if (instructions !== undefined) assignment.instructions = instructions;
    if (type) assignment.type = type;
    if (dueDate) assignment.dueDate = new Date(dueDate);
    if (lessonId) assignment.lesson = lessonId;
    if (allowAutomaticGrading !== undefined) assignment.allowAutomaticGrading = allowAutomaticGrading;
    if (allowResubmission !== undefined) assignment.allowResubmission = allowResubmission;

    // Update questions if provided
    if (questions) {
      let parsedQuestions = [];
      let totalPoints = 0;
      try {
        parsedQuestions = typeof questions === 'string' ? JSON.parse(questions) : questions;
        if (Array.isArray(parsedQuestions)) {
          parsedQuestions = parsedQuestions.map((q, index) => ({
            question: q.question || '',
            type: q.type || 'multiple-choice',
            options: q.options || [],
            correctAnswer: q.correctAnswer || '',
            correctAnswers: q.correctAnswers || [],
            points: q.points || 1,
            order: q.order !== undefined ? q.order : index,
          }));
          totalPoints = parsedQuestions.reduce((sum, q) => sum + (q.points || 1), 0);
        }
      } catch (e) {
        console.warn('Failed to parse questions:', e.message);
      }
      assignment.questions = parsedQuestions;
      assignment.totalPoints = totalPoints;
    }

    // Handle new attachments
    if (req.files && req.files.length) {
      const saved = assignment.attachments || [];
      if (hasCloudinary) {
        for (const f of req.files) {
          try {
            if (!f.buffer) continue;
            const uploaded = await uploadBufferToCloudinary(f.buffer, f.originalname);
            saved.push({ url: uploaded.secure_url, public_id: uploaded.public_id, filename: f.originalname, fileType: f.mimetype });
          } catch (err) {
            console.error('Failed to upload attachment to Cloudinary', f.originalname, err);
            return res.status(500).json({ success: false, message: 'Failed to upload attachments' });
          }
        }
      } else {
        for (const f of req.files) saved.push({ filename: f.originalname, fileType: f.mimetype, url: f.path || null, public_id: null });
      }
      assignment.attachments = saved;
    }

    await assignment.save();
    res.json({ success: true, data: assignment });
  } catch (err) {
    console.error('Update assignment error', err);
    res.status(500).json({ success: false, message: 'Failed to update assignment' });
  }
});

// Helper function to auto-grade quiz answers
function autoGradeQuiz(assignment, answers) {
  if (!assignment.questions || assignment.questions.length === 0) {
    return { totalScore: 0, totalPoints: 0, gradedAnswers: [] };
  }
  
  let totalScore = 0;
  let totalPoints = 0;
  const gradedAnswers = [];
  
  assignment.questions.forEach((question, index) => {
    const answer = answers.find(a => a.questionId && a.questionId.toString() === question._id.toString());
    totalPoints += question.points || 1;
    
    let isCorrect = false;
    let points = 0;
    
    if (question.type === 'essay' || question.type === 'file-upload') {
      // Essays and file uploads are not auto-graded
      isCorrect = null;
      points = 0;
    } else if (question.type === 'multiple-choice') {
      // Compare answer (can be index or answer text)
      const correctAnswer = question.correctAnswer;
      const studentAnswer = answer?.answer || '';
      isCorrect = String(studentAnswer).toLowerCase().trim() === String(correctAnswer).toLowerCase().trim();
      points = isCorrect ? (question.points || 1) : 0;
    } else if (question.type === 'identification') {
      const correctAnswer = (question.correctAnswer || '').toLowerCase().trim();
      const studentAnswer = (answer?.answer || '').toLowerCase().trim();
      isCorrect = studentAnswer === correctAnswer;
      points = isCorrect ? (question.points || 1) : 0;
    } else if (question.type === 'enumeration') {
      const correctAnswers = (question.correctAnswers || []).map(a => a.toLowerCase().trim());
      const studentAnswers = (answer?.answers || []).map(a => a.toLowerCase().trim());
      // Check how many correct answers the student provided
      const correctCount = studentAnswers.filter(sa => correctAnswers.includes(sa)).length;
      const totalCorrect = correctAnswers.length;
      // Partial credit: points based on percentage of correct answers
      if (totalCorrect > 0) {
        points = ((correctCount / totalCorrect) * (question.points || 1));
        isCorrect = correctCount === totalCorrect && studentAnswers.length === totalCorrect;
      } else {
        points = 0;
        isCorrect = false;
      }
    }
    
    totalScore += points;
    gradedAnswers.push({
      questionId: question._id,
      question: question.question,
      type: question.type,
      answer: answer?.answer || '',
      answers: answer?.answers || [],
      isCorrect,
      points,
      maxPoints: question.points || 1,
    });
  });
  
  return { totalScore, totalPoints, gradedAnswers };
}

// Student submits for assignment
router.post('/:id/submit', protect, upload.array('files', 10), async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.id);
    if (!assignment) return res.status(404).json({ success: false, message: 'Assignment not found' });
    
    // Check if student already submitted
    let existingSubmission = await Submission.findOne({ assignment: req.params.id, student: req.user.id });
    let isResubmission = !!existingSubmission;
    
    if (isResubmission && !assignment.allowResubmission) {
      return res.status(400).json({ success: false, message: 'Resubmission is not allowed for this assignment' });
    }
    
    const { content, answers: answersJson } = req.body;
    
    // Parse quiz answers if provided
    let parsedAnswers = [];
    if (answersJson) {
      try {
        parsedAnswers = typeof answersJson === 'string' ? JSON.parse(answersJson) : answersJson;
      } catch (e) {
        console.warn('Failed to parse answers:', e.message);
      }
    }
    
    const filesSaved = [];
    if (req.files && req.files.length) {
      if (hasCloudinary) {
        for (const f of req.files) {
          try {
            if (!f.buffer) continue;
            const uploaded = await uploadBufferToCloudinary(f.buffer, f.originalname, 'ttls_submissions');
            filesSaved.push({ url: uploaded.secure_url, public_id: uploaded.public_id, filename: f.originalname, fileType: f.mimetype });
          } catch (err) {
            console.error('Failed to upload submission file to Cloudinary', f.originalname, err);
            return res.status(500).json({ success: false, message: 'Failed to upload submission files' });
          }
        }
      } else {
        for (const f of req.files) filesSaved.push({ filename: f.originalname, fileType: f.mimetype, url: f.path || null, public_id: null });
      }
    }
    
    // Handle file uploads in quiz answers
    if (parsedAnswers && Array.isArray(parsedAnswers)) {
      for (let i = 0; i < parsedAnswers.length; i++) {
        const answer = parsedAnswers[i];
        if (answer.type === 'file-upload' && answer.fileIndex !== undefined && req.files && req.files[answer.fileIndex]) {
          const f = req.files[answer.fileIndex];
          if (hasCloudinary) {
            try {
              if (f.buffer) {
                const uploaded = await uploadBufferToCloudinary(f.buffer, f.originalname, 'ttls_submissions');
                if (!answer.files) answer.files = [];
                answer.files.push({ url: uploaded.secure_url, public_id: uploaded.public_id, filename: f.originalname, fileType: f.mimetype });
              }
            } catch (err) {
              console.error('Failed to upload answer file:', err);
            }
          } else {
            if (!answer.files) answer.files = [];
            answer.files.push({ filename: f.originalname, fileType: f.mimetype, url: f.path || null, public_id: null });
          }
        }
      }
    }

    // Auto-grade if it's a quiz and automatic grading is enabled
    let grade = null;
    let totalPoints = assignment.totalPoints || 100;
    let autoGraded = false;
    let gradedAnswers = [];
    
    if (assignment.type === 'quiz' && assignment.allowAutomaticGrading && parsedAnswers.length > 0) {
      const gradingResult = autoGradeQuiz(assignment, parsedAnswers);
      grade = gradingResult.totalScore;
      totalPoints = gradingResult.totalPoints;
      autoGraded = true;
      gradedAnswers = gradingResult.gradedAnswers;
      
      // Merge graded answers with submitted answers
      parsedAnswers = parsedAnswers.map(answer => {
        const graded = gradedAnswers.find(g => g.questionId.toString() === answer.questionId?.toString());
        return {
          ...answer,
          isCorrect: graded?.isCorrect,
          points: graded?.points || 0,
        };
      });
    }

    let submission;
    if (isResubmission) {
      // Update existing submission
      existingSubmission.previousContent = existingSubmission.content;
      existingSubmission.previousAnswers = existingSubmission.answers;
      existingSubmission.previousFiles = existingSubmission.files;
      existingSubmission.content = content;
      existingSubmission.answers = parsedAnswers;
      existingSubmission.files = filesSaved;
      existingSubmission.submittedAt = new Date();
      existingSubmission.resubmitted = true;
      existingSubmission.resubmittedAt = new Date();
      if (autoGraded) {
        existingSubmission.grade = grade;
        existingSubmission.totalPoints = totalPoints;
        existingSubmission.isGraded = true;
        existingSubmission.gradedAt = new Date();
      }
      await existingSubmission.save();
      submission = existingSubmission;
    } else {
      // Create new submission
      submission = await Submission.create({
        assignment: assignment._id,
        student: req.user.id,
        content,
        answers: parsedAnswers,
        files: filesSaved,
        grade,
        totalPoints,
        autoGraded,
        isGraded: autoGraded,
      });
    }
    
    res.status(201).json({ success: true, data: submission });
  } catch (err) {
    console.error('Submit assignment', err);
    res.status(500).json({ success: false, message: 'Failed to submit' });
  }
});

// Student: get own submissions (optionally filtered by lessonId)
router.get('/submissions/student', protect, authorize('student'), async (req, res) => {
  try {
    const { lessonId } = req.query;
    const filter = { student: req.user.id };
    
    // If lessonId is provided, filter by assignments in that lesson
    if (lessonId) {
      const assignments = await Assignment.find({ lesson: lessonId }).select('_id');
      const assignmentIds = assignments.map(a => a._id);
      filter.assignment = { $in: assignmentIds };
    }
    
    const subs = await Submission.find(filter)
      .populate('assignment', 'title type')
      .sort({ submittedAt: -1 });
    
    res.json({ success: true, data: subs });
  } catch (err) {
    console.error('Get student submissions error', err);
    res.status(500).json({ success: false, message: 'Failed to fetch submissions' });
  }
});

// Teacher: list submissions for an assignment
router.get('/:id/submissions', protect, authorize('teacher','admin'), async (req, res) => {
  try {
    const subs = await Submission.find({ assignment: req.params.id }).populate('student', 'firstName lastName email idNumber profilePicture').sort({ submittedAt: -1 });
    res.json({ success: true, data: subs });
  } catch (err) {
    console.error('List submissions', err);
    res.status(500).json({ success: false, message: 'Failed to list submissions' });
  }
});

// Teacher: grade a submission (supports quiz answer grading)
router.put('/:assignmentId/submissions/:submissionId/grade', protect, authorize('teacher','admin'), async (req, res) => {
  try {
    const { assignmentId, submissionId } = req.params;
    const { grade, feedback, answers: gradedAnswers } = req.body;
    
    const submission = await Submission.findOne({ _id: submissionId, assignment: assignmentId })
      .populate('assignment');
    if (!submission) {
      return res.status(404).json({ success: false, message: 'Submission not found' });
    }
    
    // Update overall grade and feedback
    if (grade !== undefined) submission.grade = Number(grade);
    if (feedback !== undefined) submission.feedback = feedback;
    submission.isGraded = true;
    submission.gradedAt = new Date();
    
    // Update individual quiz answers if provided
    if (gradedAnswers && Array.isArray(gradedAnswers) && submission.assignment.type === 'quiz') {
      submission.answers = submission.answers.map(answer => {
        const graded = gradedAnswers.find(g => g.questionId && g.questionId.toString() === answer.questionId?.toString());
        if (graded) {
          return {
            ...answer.toObject ? answer.toObject() : answer,
            points: graded.points !== undefined ? Number(graded.points) : answer.points,
            feedback: graded.feedback !== undefined ? graded.feedback : answer.feedback,
            isCorrect: graded.isCorrect !== undefined ? graded.isCorrect : answer.isCorrect,
          };
        }
        return answer;
      });
      
      // Recalculate total grade from individual answers
      const totalScore = submission.answers.reduce((sum, a) => sum + (a.points || 0), 0);
      if (grade === undefined) {
        submission.grade = totalScore;
      }
    }
    
    await submission.save();
    
    res.json({ success: true, data: submission });
  } catch (err) {
    console.error('Grade submission error', err);
    res.status(500).json({ success: false, message: 'Failed to grade submission' });
  }
});

// Get statistics for an assignment
router.get('/:id/statistics', protect, authorize('teacher','admin'), async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.id);
    if (!assignment) {
      return res.status(404).json({ success: false, message: 'Assignment not found' });
    }
    
    const submissions = await Submission.find({ assignment: req.params.id }).populate('student', '_id firstName lastName idNumber profilePicture coverPhoto bio');
    
    const total = submissions.length;
    const graded = submissions.filter(s => s.grade !== undefined && s.grade !== null).length;
    const average = total > 0 
      ? submissions.filter(s => s.grade !== undefined && s.grade !== null)
          .reduce((sum, s) => sum + (s.grade || 0), 0) / graded || 0
      : 0;
    
    const gradeDistribution = {
      excellent: submissions.filter(s => s.grade >= 90).length,
      good: submissions.filter(s => s.grade >= 80 && s.grade < 90).length,
      satisfactory: submissions.filter(s => s.grade >= 70 && s.grade < 80).length,
      needsImprovement: submissions.filter(s => s.grade < 70 && s.grade !== undefined && s.grade !== null).length,
      ungraded: submissions.filter(s => s.grade === undefined || s.grade === null).length,
    };
    
    res.json({ 
      success: true, 
      data: {
        total,
        graded,
        ungraded: total - graded,
        average: Math.round(average * 100) / 100,
        gradeDistribution,
        submissions: submissions.map(s => ({
          _id: s._id,
          student: s.student,
          grade: s.grade,
          submittedAt: s.submittedAt,
        })),
      }
    });
  } catch (err) {
    console.error('Get statistics error', err);
    res.status(500).json({ success: false, message: 'Failed to get statistics' });
  }
});

module.exports = router;
