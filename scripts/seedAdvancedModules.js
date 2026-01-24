const mongoose = require('mongoose');
require('dotenv').config();
const Lesson = require('../models/Lesson');
const User = require('../models/User');

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

const modules = [
  {
    title: 'Advanced Canva for Teaching: Assessments & Portfolios',
    description:
      'Design sophisticated assessment artifacts and digital portfolios using Canva. Includes rubrics, templates, and strategies to integrate Canva outputs into LMS gradebooks.',
    files: [],
  },
  {
    title: 'Instructional Design with UDL and Accessibility in Mind',
    description:
      'Create inclusive digital lessons applying Universal Design for Learning (UDL) and accessibility best practices (captions, alt text, readable layouts).',
    files: [],
  },
  {
    title: 'Learning Analytics for Teachers: Using Data to Inform Instruction',
    description:
      'Collect and interpret learning data from quizzes, LMS logs, and formative assessments to adjust instruction and provide targeted support.',
    files: [],
  },
  {
    title: 'Designing Blended & Flipped Classrooms with LMS Integration',
    description:
      'Advanced approaches to blended learning design, sequencing activities, and embedding interactive media and assessment inside an LMS.',
    files: [],
  },
  {
    title: 'Emerging Tools: AR/VR and Simulations for Deeper Learning',
    description:
      'Practical lesson examples using AR/VR tools and simulations to support inquiry-based and experiential learning.',
    files: [],
  },
  {
    title: 'AI Tools for Teachers: Practical Classroom Applications',
    description:
      'Responsible and effective use of AI tools to generate content, provide feedback, differentiate instruction, and support student creativity.',
    files: [],
  },
];

const run = async () => {
  try {
    if (!MONGODB_URI) throw new Error('MONGO_URI not set in .env');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB for seeding advanced modules');

    // choose an existing admin or teacher as creator
    let creator = await User.findOne({ role: 'teacher' });
    if (!creator) {
      creator = await User.findOne({ role: 'admin' });
    }
    if (!creator) {
      console.error('No teacher or admin user found. Create one before running this seed.');
      process.exit(1);
    }

    for (const mod of modules) {
      const exists = await Lesson.findOne({ title: mod.title });
      if (exists) {
        console.log('Skipping existing module:', mod.title);
        continue;
      }

      const lesson = new Lesson({
        title: mod.title,
        description: mod.description,
        files: mod.files,
        createdBy: creator._id,
      });
      await lesson.save();
      console.log('Inserted module:', mod.title);
    }

    console.log('Seeding completed.');
    process.exit(0);
  } catch (err) {
    console.error('Seeding error:', err.message || err);
    process.exit(1);
  }
};

run();
