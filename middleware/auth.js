const supabase = require('../database');

// Check if user is logged in
function requireAuth(req, res, next) {
  if (!req.session.user) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    return res.redirect('/login');
  }
  next();
}

// Check if user has one of the required roles
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// Check if teacher is approved (students and admins pass through)
async function requireApproved(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Students and master teachers don't need approval
  if (req.session.user.role === 'student' || req.session.user.role === 'master_teacher') {
    return next();
  }

  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('is_approved')
      .eq('id', req.session.user.id)
      .single();

    if (error || !user || !user.is_approved) {
      return res.status(403).json({ error: 'Your account is pending admin approval' });
    }

    next();
  } catch (err) {
    return res.status(500).json({ error: 'Server error checking approval status' });
  }
}

module.exports = { requireAuth, requireRole, requireApproved };
