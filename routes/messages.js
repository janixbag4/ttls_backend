const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const User = require('../models/User');
const { protect } = require('../middleware/auth');

// Search for users to message (exclude self)
router.get('/search', protect, async (req, res) => {
  try {
    const { query } = req.query;
    
    if (!query || query.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Search query required' });
    }

    const users = await User.find({
      _id: { $ne: req.user.id }, // Exclude current user
      $or: [
        { firstName: { $regex: query, $options: 'i' } },
        { lastName: { $regex: query, $options: 'i' } },
        { email: { $regex: query, $options: 'i' } },
        { idNumber: { $regex: query, $options: 'i' } }
      ]
    }).select('_id firstName lastName idNumber email role profilePicture').limit(20);

    res.json({ success: true, users });
  } catch (err) {
    console.error('Error searching users:', err);
    res.status(500).json({ success: false, message: 'Failed to search users' });
  }
});

// Get conversation with a specific user (message history)
router.get('/conversation/:userId', protect, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.id;

    // Verify the other user exists
    const otherUser = await User.findById(userId).select('_id firstName lastName profilePicture');
    if (!otherUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Fetch messages between these two users
    const messages = await Message.find({
      $or: [
        { senderId: currentUserId, receiverId: userId },
        { senderId: userId, receiverId: currentUserId }
      ]
    })
      .populate('senderId', 'firstName lastName profilePicture')
      .populate('receiverId', 'firstName lastName profilePicture')
      .sort({ createdAt: 1 })
      .limit(100); // Load last 100 messages

    // Mark messages as read if receiver
    await Message.updateMany(
      { receiverId: currentUserId, senderId: userId, isRead: false },
      { isRead: true }
    );

    res.json({ success: true, otherUser, messages });
  } catch (err) {
    console.error('Error fetching conversation:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch conversation' });
  }
});

// Send a message
router.post('/send', protect, async (req, res) => {
  try {
    const { receiverId, content } = req.body;
    const senderId = req.user.id;

    // Validate inputs
    if (!receiverId || !content || content.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Receiver ID and message content required' });
    }

    if (senderId === receiverId) {
      return res.status(400).json({ success: false, message: 'Cannot message yourself' });
    }

    // Verify receiver exists
    const receiver = await User.findById(receiverId);
    if (!receiver) {
      return res.status(404).json({ success: false, message: 'Receiver not found' });
    }

    // Create and save message
    const message = new Message({
      senderId,
      receiverId,
      content: content.trim()
    });

    await message.save();
    await message.populate('senderId', 'firstName lastName profilePicture');
    await message.populate('receiverId', 'firstName lastName profilePicture');

    res.status(201).json({ success: true, message });
  } catch (err) {
    console.error('Error sending message:', err);
    res.status(500).json({ success: false, message: 'Failed to send message' });
  }
});

// Get list of conversations (users you've messaged)
router.get('/conversations', protect, async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const currentUserId = new mongoose.Types.ObjectId(req.user.id);

    // Get all unique users this person has communicated with
    const conversations = await Message.aggregate([
      {
        $match: {
          $or: [
            { senderId: currentUserId },
            { receiverId: currentUserId }
          ]
        }
      },
      {
        $group: {
          _id: {
            $cond: [
              { $eq: ['$senderId', currentUserId] },
              '$receiverId',
              '$senderId'
            ]
          },
          lastMessage: { $last: '$content' },
          lastMessageTime: { $last: '$createdAt' },
          unreadCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$receiverId', currentUserId] },
                    { $eq: ['$isRead', false] }
                  ]
                },
                1,
                0
              ]
            }
          }
        }
      },
      { $sort: { lastMessageTime: -1 } }
    ]);

    // Populate user details
    const conversationsWithUsers = await Promise.all(
      conversations.map(async (conv) => {
        const user = await User.findById(conv._id).select('_id firstName lastName profilePicture');
        return {
          _id: conv._id,
          userId: conv._id,
          lastMessage: conv.lastMessage,
          lastMessageTime: conv.lastMessageTime,
          unreadCount: conv.unreadCount,
          firstName: user?.firstName || 'Unknown',
          lastName: user?.lastName || 'User',
          profilePicture: user?.profilePicture
        };
      })
    );

    res.json({ success: true, conversations: conversationsWithUsers });
  } catch (err) {
    console.error('Error fetching conversations:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch conversations' });
  }
});

// Mark messages as read
router.put('/mark-read/:userId', protect, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.id;

    await Message.updateMany(
      { senderId: userId, receiverId: currentUserId, isRead: false },
      { isRead: true }
    );

    res.json({ success: true, message: 'Messages marked as read' });
  } catch (err) {
    console.error('Error marking messages as read:', err);
    res.status(500).json({ success: false, message: 'Failed to mark messages as read' });
  }
});

module.exports = router;
