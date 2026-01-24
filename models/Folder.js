// models/Folder.js
const mongoose = require('mongoose');

const FolderSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Folder', default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Folder', FolderSchema);
