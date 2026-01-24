const mongoose = require('mongoose');

const SubmissionSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  files: [
    {
      url: String,
      public_id: String,
      filename: String,
      fileType: String,
    },
  ],
  text: { type: String },
  submittedAt: { type: Date, default: Date.now },
  grade: { type: Number },
  feedback: { type: String },
});

const ActivitySchema = new mongoose.Schema({
  lesson: { type: mongoose.Schema.Types.ObjectId, ref: 'Lesson' },
  title: { type: String, required: true },
  description: { type: String },
  files: [
    {
      url: String,
      public_id: String,
      filename: String,
      fileType: String,
    },
  ],
  dueDate: { type: Date },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  submissions: [SubmissionSchema],
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Activity', ActivitySchema);
