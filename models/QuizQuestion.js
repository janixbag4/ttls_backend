const mongoose = require('mongoose');

const QuizQuestionSchema = new mongoose.Schema({
  question: { type: String, required: true },
  type: { 
    type: String, 
    enum: ['multiple-choice', 'identification', 'enumeration', 'essay', 'file-upload'], 
    required: true 
  },
  // For multiple choice
  options: [String], // Array of choices
  correctAnswer: { type: String }, // For multiple choice: index or answer text, for identification: the answer
  correctAnswers: [String], // For enumeration: array of correct answers
  points: { type: Number, default: 1 },
  order: { type: Number, default: 0 }, // Order of question in quiz
}, {
  _id: true,
});

module.exports = QuizQuestionSchema;

