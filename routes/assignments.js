const express = require('express');
const supabase = require('../database');
const { requireAuth, requireRole, requireApproved } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

// Helper: verify teacher owns the course
async function verifyTeacherOwns(courseId, userId) {
  const { data: course } = await supabase
    .from('courses')
    .select('teacher_id')
    .eq('id', courseId)
    .single();
  return course && course.teacher_id === userId;
}

// Helper: verify student is enrolled
async function verifyEnrolled(courseId, studentId) {
  const { data: enrollment } = await supabase
    .from('enrollments')
    .select('id')
    .eq('course_id', courseId)
    .eq('student_id', studentId)
    .single();
  return !!enrollment;
}

// GET /api/assignments/my-submissions — Student sees all their graded work
router.get('/my-submissions', requireRole('student'), async (req, res) => {
  try {
    const { data: submissions, error } = await supabase
      .from('submissions')
      .select('*')
      .eq('student_id', req.session.user.id)
      .order('submitted_at', { ascending: false });

    if (error) throw error;

    // Attach assignment info
    for (let sub of (submissions || [])) {
      const { data: assignment } = await supabase
        .from('assignments')
        .select('title, max_points, due_date, course_id')
        .eq('id', sub.assignment_id)
        .single();
      sub.assignment = assignment;

      if (assignment) {
        const { data: course } = await supabase
          .from('courses')
          .select('name')
          .eq('id', assignment.course_id)
          .single();
        sub.course_name = course ? course.name : '';
      }
    }

    res.json(submissions || []);
  } catch (err) {
    console.error('My submissions error:', err);
    res.status(500).json({ error: 'Failed to load submissions' });
  }
});

// GET /api/assignments/pending-grading — Teacher's ungraded submissions
router.get('/pending-grading', requireRole('teacher', 'master_teacher'), async (req, res) => {
  try {
    // Get teacher's courses
    const { data: courses } = await supabase
      .from('courses')
      .select('id, name')
      .eq('teacher_id', req.session.user.id);

    if (!courses || courses.length === 0) return res.json([]);

    const courseIds = courses.map(c => c.id);
    const courseMap = {};
    courses.forEach(c => { courseMap[c.id] = c.name; });

    // Get assignments for those courses
    const { data: assignments } = await supabase
      .from('assignments')
      .select('id, title, course_id')
      .in('course_id', courseIds);

    if (!assignments || assignments.length === 0) return res.json([]);

    const assignmentIds = assignments.map(a => a.id);
    const assignmentMap = {};
    assignments.forEach(a => { assignmentMap[a.id] = a; });

    // Get ungraded submissions
    const { data: submissions, error } = await supabase
      .from('submissions')
      .select('*')
      .in('assignment_id', assignmentIds)
      .is('grade', null)
      .order('submitted_at', { ascending: true });

    if (error) throw error;

    // Attach info
    for (let sub of (submissions || [])) {
      const { data: student } = await supabase
        .from('users')
        .select('first_name, last_name')
        .eq('id', sub.student_id)
        .single();
      sub.student = student;
      sub.assignment = assignmentMap[sub.assignment_id];
      sub.course_name = courseMap[sub.assignment?.course_id] || '';
    }

    res.json(submissions || []);
  } catch (err) {
    console.error('Pending grading error:', err);
    res.status(500).json({ error: 'Failed to load pending grades' });
  }
});

// GET /api/assignments/course/:courseId — List assignments for a course
router.get('/course/:courseId', async (req, res) => {
  try {
    const { role, id } = req.session.user;

    // Verify access
    if (role === 'student') {
      const enrolled = await verifyEnrolled(req.params.courseId, id);
      if (!enrolled) return res.status(403).json({ error: 'Not enrolled in this course' });
    } else if (role === 'teacher') {
      const owns = await verifyTeacherOwns(req.params.courseId, id);
      if (!owns) return res.status(403).json({ error: 'Not your course' });
    }

    const { data: assignments, error } = await supabase
      .from('assignments')
      .select('*')
      .eq('course_id', req.params.courseId)
      .order('due_date', { ascending: true });

    if (error) throw error;

    // For students, attach their submission status
    if (role === 'student' && assignments && assignments.length > 0) {
      const assignmentIds = assignments.map(a => a.id);
      const { data: subs } = await supabase
        .from('submissions')
        .select('*')
        .eq('student_id', id)
        .in('assignment_id', assignmentIds);

      const subMap = {};
      (subs || []).forEach(s => { subMap[s.assignment_id] = s; });
      assignments.forEach(a => { a.my_submission = subMap[a.id] || null; });
    }

    // For teachers, add submission counts
    if ((role === 'teacher' || role === 'master_teacher') && assignments) {
      for (let a of assignments) {
        const { data: subs } = await supabase
          .from('submissions')
          .select('id, grade')
          .eq('assignment_id', a.id);
        a.submission_count = subs ? subs.length : 0;
        a.ungraded_count = subs ? subs.filter(s => s.grade === null).length : 0;
      }
    }

    res.json(assignments || []);
  } catch (err) {
    console.error('List assignments error:', err);
    res.status(500).json({ error: 'Failed to load assignments' });
  }
});

// GET /api/assignments/:id — Single assignment
router.get('/:id', async (req, res) => {
  try {
    const { data: assignment, error } = await supabase
      .from('assignments')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !assignment) return res.status(404).json({ error: 'Assignment not found' });

    // Get course info
    const { data: course } = await supabase
      .from('courses')
      .select('name, teacher_id')
      .eq('id', assignment.course_id)
      .single();
    assignment.course = course;

    // For student, get their submission
    if (req.session.user.role === 'student') {
      const { data: sub } = await supabase
        .from('submissions')
        .select('*')
        .eq('assignment_id', assignment.id)
        .eq('student_id', req.session.user.id)
        .single();
      assignment.my_submission = sub || null;
    }

    res.json(assignment);
  } catch (err) {
    console.error('Get assignment error:', err);
    res.status(500).json({ error: 'Failed to load assignment' });
  }
});

// POST /api/assignments — Create assignment
router.post('/', requireRole('teacher', 'master_teacher'), requireApproved, async (req, res) => {
  try {
    const { course_id, title, description, due_date, max_points } = req.body;

    if (!course_id || !title) {
      return res.status(400).json({ error: 'Course and title are required' });
    }

    // Verify teacher owns the course
    if (req.session.user.role === 'teacher') {
      const owns = await verifyTeacherOwns(course_id, req.session.user.id);
      if (!owns) return res.status(403).json({ error: 'Not your course' });
    }

    const { data: assignment, error } = await supabase
      .from('assignments')
      .insert({
        course_id,
        title,
        description: description || '',
        due_date: due_date || null,
        max_points: max_points || 100
      })
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, assignment });
  } catch (err) {
    console.error('Create assignment error:', err);
    res.status(500).json({ error: 'Failed to create assignment' });
  }
});

// PUT /api/assignments/:id — Update assignment
router.put('/:id', requireRole('teacher', 'master_teacher'), async (req, res) => {
  try {
    const { data: assignment } = await supabase
      .from('assignments')
      .select('course_id')
      .eq('id', req.params.id)
      .single();

    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

    if (req.session.user.role === 'teacher') {
      const owns = await verifyTeacherOwns(assignment.course_id, req.session.user.id);
      if (!owns) return res.status(403).json({ error: 'Not your course' });
    }

    const { title, description, due_date, max_points } = req.body;
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (due_date !== undefined) updates.due_date = due_date;
    if (max_points !== undefined) updates.max_points = max_points;

    const { data, error } = await supabase
      .from('assignments')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, assignment: data });
  } catch (err) {
    console.error('Update assignment error:', err);
    res.status(500).json({ error: 'Failed to update assignment' });
  }
});

// DELETE /api/assignments/:id — Delete assignment
router.delete('/:id', requireRole('teacher', 'master_teacher'), async (req, res) => {
  try {
    const { data: assignment } = await supabase
      .from('assignments')
      .select('course_id')
      .eq('id', req.params.id)
      .single();

    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

    if (req.session.user.role === 'teacher') {
      const owns = await verifyTeacherOwns(assignment.course_id, req.session.user.id);
      if (!owns) return res.status(403).json({ error: 'Not your course' });
    }

    const { error } = await supabase
      .from('assignments')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('Delete assignment error:', err);
    res.status(500).json({ error: 'Failed to delete assignment' });
  }
});

// POST /api/assignments/:id/submit — Student submits work
router.post('/:id/submit', requireRole('student'), async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Submission content is required' });

    // Verify assignment exists and student is enrolled
    const { data: assignment } = await supabase
      .from('assignments')
      .select('course_id')
      .eq('id', req.params.id)
      .single();

    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

    const enrolled = await verifyEnrolled(assignment.course_id, req.session.user.id);
    if (!enrolled) return res.status(403).json({ error: 'Not enrolled in this course' });

    // Upsert submission
    const { data: existing } = await supabase
      .from('submissions')
      .select('id')
      .eq('assignment_id', req.params.id)
      .eq('student_id', req.session.user.id)
      .single();

    let result;
    if (existing) {
      const { data, error } = await supabase
        .from('submissions')
        .update({ content, submitted_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw error;
      result = data;
    } else {
      const { data, error } = await supabase
        .from('submissions')
        .insert({
          assignment_id: req.params.id,
          student_id: req.session.user.id,
          content
        })
        .select()
        .single();
      if (error) throw error;
      result = data;
    }

    res.json({ success: true, submission: result });
  } catch (err) {
    console.error('Submit error:', err);
    res.status(500).json({ error: 'Failed to submit' });
  }
});

// GET /api/assignments/:id/submissions — Teacher views all submissions
router.get('/:id/submissions', requireRole('teacher', 'master_teacher'), async (req, res) => {
  try {
    const { data: assignment } = await supabase
      .from('assignments')
      .select('course_id, title, max_points')
      .eq('id', req.params.id)
      .single();

    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

    if (req.session.user.role === 'teacher') {
      const owns = await verifyTeacherOwns(assignment.course_id, req.session.user.id);
      if (!owns) return res.status(403).json({ error: 'Not your course' });
    }

    const { data: submissions, error } = await supabase
      .from('submissions')
      .select('*')
      .eq('assignment_id', req.params.id)
      .order('submitted_at', { ascending: false });

    if (error) throw error;

    // Attach student info
    for (let sub of (submissions || [])) {
      const { data: student } = await supabase
        .from('users')
        .select('first_name, last_name, email')
        .eq('id', sub.student_id)
        .single();
      sub.student = student;
    }

    res.json({ assignment, submissions: submissions || [] });
  } catch (err) {
    console.error('List submissions error:', err);
    res.status(500).json({ error: 'Failed to load submissions' });
  }
});

// PUT /api/assignments/submissions/:id/grade — Grade a submission
router.put('/submissions/:id/grade', requireRole('teacher', 'master_teacher'), async (req, res) => {
  try {
    const { grade, feedback } = req.body;

    if (grade === undefined || grade === null) {
      return res.status(400).json({ error: 'Grade is required' });
    }

    // Verify ownership
    const { data: submission } = await supabase
      .from('submissions')
      .select('assignment_id')
      .eq('id', req.params.id)
      .single();

    if (!submission) return res.status(404).json({ error: 'Submission not found' });

    const { data: assignment } = await supabase
      .from('assignments')
      .select('course_id')
      .eq('id', submission.assignment_id)
      .single();

    if (req.session.user.role === 'teacher') {
      const owns = await verifyTeacherOwns(assignment.course_id, req.session.user.id);
      if (!owns) return res.status(403).json({ error: 'Not your course' });
    }

    const { data, error } = await supabase
      .from('submissions')
      .update({
        grade: parseInt(grade),
        feedback: feedback || '',
        graded_at: new Date().toISOString()
      })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, submission: data });
  } catch (err) {
    console.error('Grade error:', err);
    res.status(500).json({ error: 'Failed to grade submission' });
  }
});

module.exports = router;
