const mongoose = require('mongoose');

const AnswerSchema = new mongoose.Schema({
  questionId: { type: mongoose.Schema.Types.ObjectId, required: true },
  answer: { type: String }, // For multiple choice, identification, essay
  answers: [String], // For enumeration
  files: [{
    filename: String,
    url: String,
    fileType: String,
    public_id: String,
  }],
  isCorrect: { type: Boolean }, // For auto-graded questions
  points: { type: Number }, // Points earned for this answer
  feedback: { type: String }, // Teacher feedback for this specific answer
}, { _id: false });

const SubmissionSchema = new mongoose.Schema({
  assignment: { type: mongoose.Schema.Types.ObjectId, ref: 'Assignment', required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String }, // text / HTML or answer payload (for non-quiz submissions)
  // Quiz answers
  answers: [AnswerSchema], // Array of answers for quiz questions
  // Legacy file support
  files: [
    {
      filename: String,
      url: String,
      fileType: String,
      public_id: String,
    }
  ],
  grade: { type: Number }, // Total grade/score
  totalPoints: { type: Number }, // Total points possible
  feedback: { type: String }, // General feedback
  isGraded: { type: Boolean, default: false },
  autoGraded: { type: Boolean, default: false }, // Whether automatic grading was applied
  submittedAt: { type: Date, default: Date.now },
  gradedAt: { type: Date }, // When teacher graded it
  // Resubmission tracking
  resubmitted: { type: Boolean, default: false },
  resubmittedAt: { type: Date },
  previousContent: { type: String },
  previousAnswers: [AnswerSchema],
  previousFiles: [
    {
      filename: String,
      url: String,
      fileType: String,
      public_id: String,
    }
  ],
});

module.exports = mongoose.model('Submission', SubmissionSchema);
