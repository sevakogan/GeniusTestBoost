const express = require('express');
const supabase = require('../database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

// GET /api/messages/unread-count — Unread message count
router.get('/unread-count', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('messages')
      .select('id')
      .eq('receiver_id', req.session.user.id)
      .eq('is_read', false);

    if (error) throw error;
    res.json({ count: data ? data.length : 0 });
  } catch (err) {
    console.error('Unread count error:', err);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

// GET /api/messages/conversations — List conversation partners
router.get('/conversations', async (req, res) => {
  try {
    const userId = req.session.user.id;

    // Get all messages involving this user
    const { data: sent, error: err1 } = await supabase
      .from('messages')
      .select('receiver_id, content, created_at, is_read')
      .eq('sender_id', userId)
      .order('created_at', { ascending: false });

    const { data: received, error: err2 } = await supabase
      .from('messages')
      .select('sender_id, content, created_at, is_read')
      .eq('receiver_id', userId)
      .order('created_at', { ascending: false });

    if (err1 || err2) throw (err1 || err2);

    // Build conversation map
    const convMap = {};

    (sent || []).forEach(m => {
      const partnerId = m.receiver_id;
      if (!convMap[partnerId] || new Date(m.created_at) > new Date(convMap[partnerId].last_at)) {
        convMap[partnerId] = {
          partner_id: partnerId,
          last_message: m.content,
          last_at: m.created_at,
          unread: 0
        };
      }
    });

    (received || []).forEach(m => {
      const partnerId = m.sender_id;
      if (!convMap[partnerId] || new Date(m.created_at) > new Date(convMap[partnerId].last_at)) {
        convMap[partnerId] = {
          partner_id: partnerId,
          last_message: m.content,
          last_at: m.created_at,
          unread: 0
        };
      }
      if (!m.is_read) {
        convMap[partnerId] = convMap[partnerId] || {};
        convMap[partnerId].unread = (convMap[partnerId].unread || 0) + 1;
      }
    });

    // Get partner details
    const conversations = Object.values(convMap);
    conversations.sort((a, b) => new Date(b.last_at) - new Date(a.last_at));

    for (let conv of conversations) {
      const { data: partner } = await supabase
        .from('users')
        .select('first_name, last_name, role')
        .eq('id', conv.partner_id)
        .single();
      conv.partner = partner;
    }

    res.json(conversations);
  } catch (err) {
    console.error('Conversations error:', err);
    res.status(500).json({ error: 'Failed to load conversations' });
  }
});

// GET /api/messages/contacts — Get available contacts to message
router.get('/contacts', async (req, res) => {
  try {
    const { role, id } = req.session.user;
    let contacts = [];

    if (role === 'student') {
      // Students can only message teachers from enrolled courses
      const { data: enrollments } = await supabase
        .from('enrollments')
        .select('course_id')
        .eq('student_id', id);

      if (enrollments && enrollments.length > 0) {
        const courseIds = enrollments.map(e => e.course_id);
        const { data: courses } = await supabase
          .from('courses')
          .select('teacher_id')
          .in('id', courseIds);

        const teacherIds = [...new Set((courses || []).map(c => c.teacher_id))];
        if (teacherIds.length > 0) {
          const { data: teachers } = await supabase
            .from('users')
            .select('id, first_name, last_name, role')
            .in('id', teacherIds);
          contacts = teachers || [];
        }
      }
    } else if (role === 'teacher') {
      // Teachers can message their students
      const { data: courses } = await supabase
        .from('courses')
        .select('id')
        .eq('teacher_id', id);

      if (courses && courses.length > 0) {
        const courseIds = courses.map(c => c.id);
        const { data: enrollments } = await supabase
          .from('enrollments')
          .select('student_id')
          .in('course_id', courseIds);

        const studentIds = [...new Set((enrollments || []).map(e => e.student_id))];
        if (studentIds.length > 0) {
          const { data: students } = await supabase
            .from('users')
            .select('id, first_name, last_name, role')
            .in('id', studentIds);
          contacts = students || [];
        }
      }
    } else {
      // Admin can message anyone
      const { data: users } = await supabase
        .from('users')
        .select('id, first_name, last_name, role')
        .neq('id', id);
      contacts = users || [];
    }

    res.json(contacts);
  } catch (err) {
    console.error('Contacts error:', err);
    res.status(500).json({ error: 'Failed to load contacts' });
  }
});

// GET /api/messages/conversation/:userId — Message history with a user
router.get('/conversation/:userId', async (req, res) => {
  try {
    const userId = req.session.user.id;
    const partnerId = req.params.userId;

    // Get messages between the two users
    const { data: messages, error } = await supabase
      .from('messages')
      .select('*')
      .or(`and(sender_id.eq.${userId},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${userId})`)
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Mark received messages as read
    await supabase
      .from('messages')
      .update({ is_read: true })
      .eq('sender_id', partnerId)
      .eq('receiver_id', userId)
      .eq('is_read', false);

    // Get partner info
    const { data: partner } = await supabase
      .from('users')
      .select('first_name, last_name, role')
      .eq('id', partnerId)
      .single();

    res.json({ partner, messages: messages || [] });
  } catch (err) {
    console.error('Conversation error:', err);
    res.status(500).json({ error: 'Failed to load conversation' });
  }
});

// POST /api/messages/send — Send a message
router.post('/send', async (req, res) => {
  try {
    const { receiver_id, content } = req.body;

    if (!receiver_id || !content) {
      return res.status(400).json({ error: 'Receiver and content are required' });
    }

    // Verify receiver exists
    const { data: receiver } = await supabase
      .from('users')
      .select('id')
      .eq('id', receiver_id)
      .single();

    if (!receiver) return res.status(404).json({ error: 'Recipient not found' });

    const { data: message, error } = await supabase
      .from('messages')
      .insert({
        sender_id: req.session.user.id,
        receiver_id,
        content
      })
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, message });
  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

module.exports = router;
