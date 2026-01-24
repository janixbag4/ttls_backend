const express = require('express');
const router = express.Router();
const Comment = require('../models/Comment');
const Lesson = require('../models/Lesson');
const { protect } = require('../middleware/auth');

// Get comments for a lesson
router.get('/lesson/:lessonId', protect, async (req, res) => {
  try {
    const comments = await Comment.find({
      lesson: req.params.lessonId,
      parentComment: null
    })
      .populate('user', 'firstName lastName profilePicture')
      .populate({
        path: 'replies',
        populate: {
          path: 'user',
          select: 'firstName lastName profilePicture'
        }
      })
      .sort({ createdAt: 1 });

    res.json({ comments });
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create a comment
router.post('/', protect, async (req, res) => {
  try {
    const { lessonId, content, parentCommentId } = req.body;

    if (!lessonId || !content) {
      return res.status(400).json({ message: 'Lesson ID and content are required' });
    }

    // Verify lesson exists
    const lesson = await Lesson.findById(lessonId);
    if (!lesson) {
      return res.status(404).json({ message: 'Lesson not found' });
    }

    const comment = new Comment({
      lesson: lessonId,
      user: req.user.id,
      content,
      parentComment: parentCommentId || null,
    });

    await comment.save();

    // If it's a reply, add to parent's replies
    if (parentCommentId) {
      await Comment.findByIdAndUpdate(parentCommentId, {
        $push: { replies: comment._id }
      });
    }

    const populatedComment = await Comment.findById(comment._id)
      .populate('user', 'firstName lastName profilePicture');

    res.status(201).json({ message: 'Comment added successfully', comment: populatedComment });
  } catch (error) {
    console.error('Error creating comment:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update a comment (only by author)
router.put('/:id', protect, async (req, res) => {
  try {
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ message: 'Content is required' });
    }

    const comment = await Comment.findById(req.params.id);

    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    if (comment.user.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to edit this comment' });
    }

    comment.content = content;
    comment.updatedAt = new Date();
    await comment.save();

    const populatedComment = await Comment.findById(comment._id)
      .populate('user', 'firstName lastName profilePicture');

    res.json({ message: 'Comment updated successfully', comment: populatedComment });
  } catch (error) {
    console.error('Error updating comment:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete a comment (only by author or admin)
router.delete('/:id', protect, async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.id);

    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    if (comment.user.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to delete this comment' });
    }

    // Remove from parent's replies if it's a reply
    if (comment.parentComment) {
      await Comment.findByIdAndUpdate(comment.parentComment, {
        $pull: { replies: comment._id }
      });
    }

    // Delete replies if it's a parent comment
    if (comment.replies && comment.replies.length > 0) {
      await Comment.deleteMany({ _id: { $in: comment.replies } });
    }

    await Comment.findByIdAndDelete(req.params.id);

    res.json({ message: 'Comment deleted successfully' });
  } catch (error) {
    console.error('Error deleting comment:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;