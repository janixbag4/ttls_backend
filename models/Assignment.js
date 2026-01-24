const mongoose = require('mongoose');
const QuizQuestionSchema = require('./QuizQuestion');

const AssignmentSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String }, // HTML allowed
  instructions: { type: String }, // Specific instructions for the output
  lesson: { type: mongoose.Schema.Types.ObjectId, ref: 'Lesson' },
  type: { type: String, enum: ['mini-project','major-project','quiz','assignment','essay'], default: 'assignment' },
  dueDate: { type: Date },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  attachments: [
    {
      filename: String,
      url: String,
      fileType: String,
      public_id: String,
    }
  ],
  // Quiz-specific fields
  questions: [QuizQuestionSchema], // Array of quiz questions
  totalPoints: { type: Number, default: 0 }, // Total points for the quiz
  allowAutomaticGrading: { type: Boolean, default: true }, // Whether to auto-grade (except essays)
  allowResubmission: { type: Boolean, default: false }, // Whether students can resubmit after submission
});

module.exports = mongoose.model('Assignment', AssignmentSchema);
