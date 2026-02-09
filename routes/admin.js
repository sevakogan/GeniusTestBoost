const express = require('express');
const supabase = require('../database');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// All admin routes require master_teacher role
router.use(requireAuth, requireRole('master_teacher'));

// GET /api/admin/stats — Platform statistics
router.get('/stats', async (req, res) => {
  try {
    const { data: users } = await supabase.from('users').select('role, is_approved');
    const { data: courses } = await supabase.from('courses').select('id');

    const stats = {
      totalStudents: users.filter(u => u.role === 'student').length,
      totalTeachers: users.filter(u => u.role === 'teacher').length,
      totalAdmins: users.filter(u => u.role === 'master_teacher').length,
      pendingApprovals: users.filter(u => u.role === 'teacher' && !u.is_approved).length,
      totalCourses: courses ? courses.length : 0,
      totalUsers: users.length
    };

    res.json(stats);
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

// GET /api/admin/users — List all users
router.get('/users', async (req, res) => {
  try {
    const { role, approved } = req.query;

    let query = supabase
      .from('users')
      .select('id, first_name, last_name, email, role, is_approved, created_at')
      .order('created_at', { ascending: false });

    if (role) query = query.eq('role', role);
    if (approved !== undefined) query = query.eq('is_approved', approved === 'true');

    const { data: users, error } = await query;

    if (error) throw error;
    res.json(users);
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

// GET /api/admin/users/:id — Get single user details
router.get('/users/:id', async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, first_name, last_name, email, role, is_approved, created_at')
      .eq('id', req.params.id)
      .single();

    if (error || !user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load user' });
  }
});

// PUT /api/admin/users/:id — Edit user details
router.put('/users/:id', async (req, res) => {
  try {
    const { first_name, last_name, email, role } = req.body;

    // Prevent editing own role down
    if (req.params.id === req.session.user.id && role && role !== 'master_teacher') {
      return res.status(400).json({ error: 'Cannot change your own admin role' });
    }

    const updates = {};
    if (first_name) updates.first_name = first_name;
    if (last_name) updates.last_name = last_name;
    if (email) updates.email = email;
    if (role) updates.role = role;

    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, user: data });
  } catch (err) {
    console.error('Edit user error:', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// DELETE /api/admin/users/:id — Delete user
router.delete('/users/:id', async (req, res) => {
  try {
    if (req.params.id === req.session.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const { error } = await supabase
      .from('users')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// POST /api/admin/users/:id/approve — Approve teacher
router.post('/users/:id/approve', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .update({ is_approved: true })
      .eq('id', req.params.id)
      .eq('role', 'teacher')
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, user: data });
  } catch (err) {
    console.error('Approve error:', err);
    res.status(500).json({ error: 'Failed to approve teacher' });
  }
});

// POST /api/admin/users/:id/reject — Reject/unapprove teacher
router.post('/users/:id/reject', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .update({ is_approved: false })
      .eq('id', req.params.id)
      .eq('role', 'teacher')
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, user: data });
  } catch (err) {
    console.error('Reject error:', err);
    res.status(500).json({ error: 'Failed to reject teacher' });
  }
});

// POST /api/admin/users/:id/promote — Promote to master_teacher
router.post('/users/:id/promote', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .update({ role: 'master_teacher', is_approved: true })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, user: data });
  } catch (err) {
    console.error('Promote error:', err);
    res.status(500).json({ error: 'Failed to promote user' });
  }
});

// GET /api/admin/pending-teachers — List unapproved teachers
router.get('/pending-teachers', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, first_name, last_name, email, created_at')
      .eq('role', 'teacher')
      .eq('is_approved', false)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Pending teachers error:', err);
    res.status(500).json({ error: 'Failed to load pending teachers' });
  }
});

// GET /api/admin/courses — All courses with teacher info
router.get('/courses', async (req, res) => {
  try {
    const { data: courses, error } = await supabase
      .from('courses')
      .select('*, users!courses_teacher_id_fkey(first_name, last_name, email)')
      .order('created_at', { ascending: false });

    if (error) {
      // Fallback if FK name doesn't match
      const { data: coursesSimple, error: err2 } = await supabase
        .from('courses')
        .select('*')
        .order('created_at', { ascending: false });

      if (err2) throw err2;

      // Get teacher info separately
      for (let course of coursesSimple) {
        const { data: teacher } = await supabase
          .from('users')
          .select('first_name, last_name, email')
          .eq('id', course.teacher_id)
          .single();
        course.teacher = teacher;
      }

      // Get enrollment counts
      for (let course of coursesSimple) {
        const { data: enrollments } = await supabase
          .from('enrollments')
          .select('id')
          .eq('course_id', course.id);
        course.enrollment_count = enrollments ? enrollments.length : 0;
      }

      return res.json(coursesSimple);
    }

    // Get enrollment counts
    for (let course of courses) {
      const { data: enrollments } = await supabase
        .from('enrollments')
        .select('id')
        .eq('course_id', course.id);
      course.enrollment_count = enrollments ? enrollments.length : 0;
      course.teacher = course.users;
      delete course.users;
    }

    res.json(courses);
  } catch (err) {
    console.error('Admin courses error:', err);
    res.status(500).json({ error: 'Failed to load courses' });
  }
});

module.exports = router;
