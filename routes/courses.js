const express = require('express');
const supabase = require('../database');
const { requireAuth, requireRole, requireApproved } = require('../middleware/auth');

const router = express.Router();

// All routes require auth
router.use(requireAuth);

// GET /api/courses — List courses (role-aware)
router.get('/', async (req, res) => {
  try {
    const { role, id } = req.session.user;

    if (role === 'student') {
      // Students see their enrolled courses
      const { data: enrollments, error } = await supabase
        .from('enrollments')
        .select('course_id, enrolled_at')
        .eq('student_id', id);

      if (error) throw error;
      if (!enrollments || enrollments.length === 0) return res.json([]);

      const courseIds = enrollments.map(e => e.course_id);
      const { data: courses, error: err2 } = await supabase
        .from('courses')
        .select('*')
        .in('id', courseIds)
        .eq('is_active', true);

      if (err2) throw err2;

      // Add teacher info
      for (let course of courses) {
        const { data: teacher } = await supabase
          .from('users')
          .select('first_name, last_name')
          .eq('id', course.teacher_id)
          .single();
        course.teacher = teacher;

        // Get assignment count
        const { data: assignments } = await supabase
          .from('assignments')
          .select('id')
          .eq('course_id', course.id);
        course.assignment_count = assignments ? assignments.length : 0;
      }

      return res.json(courses);

    } else if (role === 'teacher') {
      // Teachers see their own courses
      const { data: courses, error } = await supabase
        .from('courses')
        .select('*')
        .eq('teacher_id', id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Add enrollment & assignment counts
      for (let course of courses) {
        const { data: enrollments } = await supabase
          .from('enrollments')
          .select('id')
          .eq('course_id', course.id);
        course.enrollment_count = enrollments ? enrollments.length : 0;

        const { data: assignments } = await supabase
          .from('assignments')
          .select('id')
          .eq('course_id', course.id);
        course.assignment_count = assignments ? assignments.length : 0;
      }

      return res.json(courses);

    } else {
      // Admin sees all courses
      const { data: courses, error } = await supabase
        .from('courses')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      for (let course of courses) {
        const { data: teacher } = await supabase
          .from('users')
          .select('first_name, last_name')
          .eq('id', course.teacher_id)
          .single();
        course.teacher = teacher;

        const { data: enrollments } = await supabase
          .from('enrollments')
          .select('id')
          .eq('course_id', course.id);
        course.enrollment_count = enrollments ? enrollments.length : 0;
      }

      return res.json(courses);
    }
  } catch (err) {
    console.error('List courses error:', err);
    res.status(500).json({ error: 'Failed to load courses' });
  }
});

// GET /api/courses/available — All active courses for student enrollment
router.get('/available', requireRole('student'), async (req, res) => {
  try {
    const { data: courses, error } = await supabase
      .from('courses')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Check which courses student is already enrolled in
    const { data: enrollments } = await supabase
      .from('enrollments')
      .select('course_id')
      .eq('student_id', req.session.user.id);

    const enrolledIds = new Set((enrollments || []).map(e => e.course_id));

    for (let course of courses) {
      const { data: teacher } = await supabase
        .from('users')
        .select('first_name, last_name')
        .eq('id', course.teacher_id)
        .single();
      course.teacher = teacher;
      course.is_enrolled = enrolledIds.has(course.id);

      const { data: enroll } = await supabase
        .from('enrollments')
        .select('id')
        .eq('course_id', course.id);
      course.enrollment_count = enroll ? enroll.length : 0;
    }

    res.json(courses);
  } catch (err) {
    console.error('Available courses error:', err);
    res.status(500).json({ error: 'Failed to load courses' });
  }
});

// GET /api/courses/:id — Single course with details
router.get('/:id', async (req, res) => {
  try {
    const { data: course, error } = await supabase
      .from('courses')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !course) return res.status(404).json({ error: 'Course not found' });

    // Get teacher info
    const { data: teacher } = await supabase
      .from('users')
      .select('first_name, last_name, email')
      .eq('id', course.teacher_id)
      .single();
    course.teacher = teacher;

    // Get assignments
    const { data: assignments } = await supabase
      .from('assignments')
      .select('*')
      .eq('course_id', course.id)
      .order('due_date', { ascending: true });
    course.assignments = assignments || [];

    // Get enrollment count
    const { data: enrollments } = await supabase
      .from('enrollments')
      .select('id')
      .eq('course_id', course.id);
    course.enrollment_count = enrollments ? enrollments.length : 0;

    // If student, check enrollment and get their submissions
    if (req.session.user.role === 'student') {
      const { data: enrollment } = await supabase
        .from('enrollments')
        .select('id')
        .eq('student_id', req.session.user.id)
        .eq('course_id', course.id)
        .single();
      course.is_enrolled = !!enrollment;

      // Get student's submissions for this course's assignments
      if (course.assignments.length > 0) {
        const assignmentIds = course.assignments.map(a => a.id);
        const { data: submissions } = await supabase
          .from('submissions')
          .select('*')
          .eq('student_id', req.session.user.id)
          .in('assignment_id', assignmentIds);

        const subMap = {};
        (submissions || []).forEach(s => { subMap[s.assignment_id] = s; });
        course.assignments.forEach(a => { a.my_submission = subMap[a.id] || null; });
      }
    }

    res.json(course);
  } catch (err) {
    console.error('Get course error:', err);
    res.status(500).json({ error: 'Failed to load course' });
  }
});

// POST /api/courses — Create course
router.post('/', requireRole('teacher', 'master_teacher'), requireApproved, async (req, res) => {
  try {
    const { name, description, subject } = req.body;

    if (!name) return res.status(400).json({ error: 'Course name is required' });

    const { data: course, error } = await supabase
      .from('courses')
      .insert({
        teacher_id: req.session.user.id,
        name,
        description: description || '',
        subject: subject || ''
      })
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, course });
  } catch (err) {
    console.error('Create course error:', err);
    res.status(500).json({ error: 'Failed to create course' });
  }
});

// PUT /api/courses/:id — Update course
router.put('/:id', requireRole('teacher', 'master_teacher'), async (req, res) => {
  try {
    // Verify ownership (unless admin)
    if (req.session.user.role === 'teacher') {
      const { data: course } = await supabase
        .from('courses')
        .select('teacher_id')
        .eq('id', req.params.id)
        .single();
      if (!course || course.teacher_id !== req.session.user.id) {
        return res.status(403).json({ error: 'Not your course' });
      }
    }

    const { name, description, subject, is_active } = req.body;
    const updates = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (subject !== undefined) updates.subject = subject;
    if (is_active !== undefined) updates.is_active = is_active;

    const { data, error } = await supabase
      .from('courses')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, course: data });
  } catch (err) {
    console.error('Update course error:', err);
    res.status(500).json({ error: 'Failed to update course' });
  }
});

// DELETE /api/courses/:id — Deactivate course
router.delete('/:id', requireRole('teacher', 'master_teacher'), async (req, res) => {
  try {
    if (req.session.user.role === 'teacher') {
      const { data: course } = await supabase
        .from('courses')
        .select('teacher_id')
        .eq('id', req.params.id)
        .single();
      if (!course || course.teacher_id !== req.session.user.id) {
        return res.status(403).json({ error: 'Not your course' });
      }
    }

    const { error } = await supabase
      .from('courses')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('Delete course error:', err);
    res.status(500).json({ error: 'Failed to delete course' });
  }
});

// POST /api/courses/:id/enroll — Student enrolls
router.post('/:id/enroll', requireRole('student'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('enrollments')
      .insert({
        student_id: req.session.user.id,
        course_id: req.params.id
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: 'Already enrolled in this course' });
      }
      throw error;
    }

    res.json({ success: true, enrollment: data });
  } catch (err) {
    console.error('Enroll error:', err);
    res.status(500).json({ error: 'Failed to enroll' });
  }
});

// DELETE /api/courses/:id/unenroll — Student unenrolls
router.delete('/:id/unenroll', requireRole('student'), async (req, res) => {
  try {
    const { error } = await supabase
      .from('enrollments')
      .delete()
      .eq('student_id', req.session.user.id)
      .eq('course_id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('Unenroll error:', err);
    res.status(500).json({ error: 'Failed to unenroll' });
  }
});

// GET /api/courses/:id/students — List enrolled students
router.get('/:id/students', requireRole('teacher', 'master_teacher'), async (req, res) => {
  try {
    // Verify ownership for teachers
    if (req.session.user.role === 'teacher') {
      const { data: course } = await supabase
        .from('courses')
        .select('teacher_id')
        .eq('id', req.params.id)
        .single();
      if (!course || course.teacher_id !== req.session.user.id) {
        return res.status(403).json({ error: 'Not your course' });
      }
    }

    const { data: enrollments, error } = await supabase
      .from('enrollments')
      .select('student_id, enrolled_at')
      .eq('course_id', req.params.id);

    if (error) throw error;
    if (!enrollments || enrollments.length === 0) return res.json([]);

    const studentIds = enrollments.map(e => e.student_id);
    const { data: students } = await supabase
      .from('users')
      .select('id, first_name, last_name, email')
      .in('id', studentIds);

    // Merge enrollment date
    const enrollMap = {};
    enrollments.forEach(e => { enrollMap[e.student_id] = e.enrolled_at; });
    students.forEach(s => { s.enrolled_at = enrollMap[s.id]; });

    res.json(students);
  } catch (err) {
    console.error('List students error:', err);
    res.status(500).json({ error: 'Failed to load students' });
  }
});

module.exports = router;
