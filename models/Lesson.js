// models/Lesson.js
const mongoose = require('mongoose');

const FileSchema = new mongoose.Schema(
  {
    url: {
      type: String,
      required: true,
    },
    public_id: {
      type: String,
    },
    filename: {
      type: String,
      required: true,
    },
    fileType: {
      type: String,
      required: true,
    },
  },
  { _id: true }
);

const LessonSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
    },
    files: {
      type: [FileSchema],
      default: [],
    },
    links: {
      type: [
        {
          url: { type: String, required: true },
          label: { type: String },
        },
      ],
      default: [],
    },
    youtubeLink: {
      type: String,
      default: '',
    },
    iframeUrl: {
      type: String,
      default: '',
    },
    iframeTitle: {
      type: String,
      default: '',
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // models/Lesson.js – add:
    folder: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Folder', 
      default: null 
    },
    category: {
      type: String,
      enum: ['e-module', 'advanced-ttl'],
      default: 'e-module',
      required: true,
    },
    module: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Module',
      default: null,
    },
    coverPhoto: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

// IMPORTANT: export the Mongoose model, not a router
module.exports = mongoose.model('Lesson', LessonSchema);
