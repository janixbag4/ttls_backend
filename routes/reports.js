

const express = require('express');
const router = express.Router();
const Report = require('../models/Report');
const Submission = require('../models/Submission');
const User = require('../models/User');
const { protect, authorize } = require('../middleware/auth');

// Get reports for the logged-in user
router.get('/my', protect, async (req, res) => {
  try {
    const reports = await Report.find({ reporter: req.user.id }).sort({ createdAt: -1 });
    res.json({ reports });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});
// Create a report
router.post('/', protect, async (req, res) => {
  try {
    const { subject, message, type } = req.body;

    if (!subject || !message || !type) {
      return res.status(400).json({ message: 'Subject, message, and type are required' });
    }

    // Generate a unique ticket number (e.g., RPT-YYYYMMDD-HHMMSS-XXXX)
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    const dateStr = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const randomStr = Math.floor(1000 + Math.random() * 9000);
    const ticketNumber = `RPT-${dateStr}-${randomStr}`;

    const report = new Report({
      reporter: req.user.id,
      subject,
      message,
      type,
      ticketNumber,
    });

    await report.save();

    res.status(201).json({ message: 'Report submitted successfully', report, ticketNumber });
  } catch (error) {
    console.error('Error creating report:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all reports (admin only)
router.get('/', protect, authorize('admin'), async (req, res) => {
  try {
    const reports = await Report.find()
      .populate('reporter', 'firstName lastName email idNumber')
      .sort({ createdAt: -1 });

    res.json({ reports });
  } catch (error) {
    console.error('Error fetching reports:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update report status (admin only)
router.put('/:id/status', protect, authorize('admin'), async (req, res) => {
  try {
    const { status } = req.body;

    if (!['pending', 'reviewed', 'resolved'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const report = await Report.findByIdAndUpdate(
      req.params.id,
      { status, updatedAt: new Date() },
      { new: true }
    ).populate('reporter', 'firstName lastName email idNumber');

    if (!report) {
      return res.status(404).json({ message: 'Report not found' });
    }

    res.json({ message: 'Report status updated', report });
  } catch (error) {
    console.error('Error updating report status:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete report (admin only)
router.delete('/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const report = await Report.findByIdAndDelete(req.params.id);

    if (!report) {
      return res.status(404).json({ message: 'Report not found' });
    }

    res.json({ message: 'Report deleted successfully' });
  } catch (error) {
    console.error('Error deleting report:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Save manual grade overrides (teacher only)
router.post('/save-grade-overrides', protect, async (req, res) => {
  try {
    // Check if user is teacher or admin
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only teachers and admins can save grade overrides' });
    }

    const { studentGrades } = req.body;

    if (!studentGrades || typeof studentGrades !== 'object') {
      return res.status(400).json({ message: 'studentGrades object is required' });
    }

    let updatedCount = 0;
    const results = [];

    for (const [studentId, gradePercentage] of Object.entries(studentGrades)) {
      try {
        // Find all submissions for this student
        const submissions = await Submission.find({ student: studentId });
        
        // Update all submissions with the manual grade override
        for (const submission of submissions) {
          submission.gradePercentage = gradePercentage;
          await submission.save();
          updatedCount++;
          results.push({
            studentId,
            submissionId: submission._id,
            gradePercentage,
            success: true
          });
        }
      } catch (error) {
        console.error(`Error updating grades for student ${studentId}:`, error);
        results.push({
          studentId,
          success: false,
          error: error.message
        });
      }
    }

    res.json({ 
      message: `Updated ${updatedCount} submission grades`,
      updatedCount,
      results
    });
  } catch (error) {
    console.error('Error saving grade overrides:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;