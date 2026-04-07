import express from "express";
import supabase from "../database.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { ROLES } from "../lib/auth.js";

const router = express.Router();

// All admin routes require owner or admin role
router.use(requireAuth, requireRole(ROLES.OWNER, ROLES.ADMIN));

// GET /api/admin/stats — Platform statistics
router.get("/stats", async (req, res) => {
  try {
    const { data: users } = await supabase
      .from("user")
      .select("role, is_approved");
    const { data: courses } = await supabase.from("courses").select("id");

    const stats = {
      totalStudents: users.filter((u) => u.role === ROLES.STUDENT).length,
      totalTeachers: users.filter((u) => u.role === ROLES.TEACHER).length,
      totalAdmins: users.filter((u) => u.role === ROLES.ADMIN).length,
      totalOwners: users.filter((u) => u.role === ROLES.OWNER).length,
      pendingApprovals: users.filter(
        (u) => u.role === ROLES.TEACHER && !u.is_approved
      ).length,
      totalCourses: courses ? courses.length : 0,
      totalUsers: users.length,
    };

    res.json(stats);
  } catch (err) {
    console.error("Stats error:", err);
    res.status(500).json({ error: "Failed to load stats" });
  }
});

// GET /api/admin/users — List all users
router.get("/users", async (req, res) => {
  try {
    const { role, approved } = req.query;

    let query = supabase
      .from("user")
      .select(
        "id, first_name, last_name, name, email, role, is_approved, created_at, image"
      )
      .order("created_at", { ascending: false });

    if (role) query = query.eq("role", role);
    if (approved !== undefined)
      query = query.eq("is_approved", approved === "true");

    const { data: users, error } = await query;

    if (error) throw error;
    res.json(users);
  } catch (err) {
    console.error("List users error:", err);
    res.status(500).json({ error: "Failed to load users" });
  }
});

// GET /api/admin/users/:id — Get single user details
router.get("/users/:id", async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from("user")
      .select(
        "id, first_name, last_name, name, email, role, is_approved, created_at, image"
      )
      .eq("id", req.params.id)
      .single();

    if (error || !user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: "Failed to load user" });
  }
});

// PUT /api/admin/users/:id — Edit user details
router.put("/users/:id", async (req, res) => {
  try {
    const targetId = req.params.id;
    const { first_name, last_name, email, role } = req.body;

    // Get target user to check their role
    const { data: targetUser } = await supabase
      .from("user")
      .select("role")
      .eq("id", targetId)
      .single();

    if (!targetUser) return res.status(404).json({ error: "User not found" });

    // Prevent editing own role down
    if (targetId === req.user.id && role && role !== req.user.role) {
      return res.status(400).json({ error: "Cannot change your own role" });
    }

    // Admins cannot edit owners or other admins
    if (req.user.role === ROLES.ADMIN) {
      if (
        targetUser.role === ROLES.OWNER ||
        targetUser.role === ROLES.ADMIN
      ) {
        return res
          .status(403)
          .json({ error: "Only owners can modify admin/owner accounts" });
      }
    }

    const updates = {};
    if (first_name) updates.first_name = first_name;
    if (last_name) updates.last_name = last_name;
    if (email) updates.email = email;
    if (role) {
      // Only owners can assign owner/admin roles
      if (
        (role === ROLES.OWNER || role === ROLES.ADMIN) &&
        req.user.role !== ROLES.OWNER
      ) {
        return res
          .status(403)
          .json({ error: "Only owners can assign admin roles" });
      }
      updates.role = role;
    }

    // Update name field from first/last
    if (first_name || last_name) {
      const newFirst = first_name || targetUser.first_name || "";
      const newLast = last_name || targetUser.last_name || "";
      updates.name = [newFirst, newLast].filter(Boolean).join(" ");
    }

    const { data, error } = await supabase
      .from("user")
      .update(updates)
      .eq("id", targetId)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, user: data });
  } catch (err) {
    console.error("Edit user error:", err);
    res.status(500).json({ error: "Failed to update user" });
  }
});

// DELETE /api/admin/users/:id — Delete user
router.delete("/users/:id", async (req, res) => {
  try {
    const targetId = req.params.id;

    if (targetId === req.user.id) {
      return res
        .status(400)
        .json({ error: "Cannot delete your own account" });
    }

    // Get target user
    const { data: targetUser } = await supabase
      .from("user")
      .select("role")
      .eq("id", targetId)
      .single();

    if (!targetUser) return res.status(404).json({ error: "User not found" });

    // Admins cannot delete owners or other admins
    if (req.user.role === ROLES.ADMIN) {
      if (
        targetUser.role === ROLES.OWNER ||
        targetUser.role === ROLES.ADMIN
      ) {
        return res
          .status(403)
          .json({ error: "Only owners can delete admin/owner accounts" });
      }
    }

    const { error } = await supabase.from("user").delete().eq("id", targetId);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error("Delete user error:", err);
    res.status(500).json({ error: "Failed to delete user" });
  }
});

// POST /api/admin/users/:id/approve — Approve teacher
router.post("/users/:id/approve", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("user")
      .update({ is_approved: true })
      .eq("id", req.params.id)
      .eq("role", ROLES.TEACHER)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, user: data });
  } catch (err) {
    console.error("Approve error:", err);
    res.status(500).json({ error: "Failed to approve teacher" });
  }
});

// POST /api/admin/users/:id/reject — Reject/unapprove teacher
router.post("/users/:id/reject", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("user")
      .update({ is_approved: false })
      .eq("id", req.params.id)
      .eq("role", ROLES.TEACHER)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, user: data });
  } catch (err) {
    console.error("Reject error:", err);
    res.status(500).json({ error: "Failed to reject teacher" });
  }
});

// POST /api/admin/users/:id/promote-admin — Promote to admin (owner only)
router.post(
  "/users/:id/promote-admin",
  requireRole(ROLES.OWNER),
  async (req, res) => {
    try {
      const { data, error } = await supabase
        .from("user")
        .update({ role: ROLES.ADMIN, is_approved: true })
        .eq("id", req.params.id)
        .select()
        .single();

      if (error) throw error;
      res.json({ success: true, user: data });
    } catch (err) {
      console.error("Promote admin error:", err);
      res.status(500).json({ error: "Failed to promote user to admin" });
    }
  }
);

// POST /api/admin/users/:id/demote-admin — Demote admin (owner only)
router.post(
  "/users/:id/demote-admin",
  requireRole(ROLES.OWNER),
  async (req, res) => {
    try {
      const targetId = req.params.id;

      if (targetId === req.user.id) {
        return res
          .status(400)
          .json({ error: "Cannot demote yourself" });
      }

      const { data, error } = await supabase
        .from("user")
        .update({ role: ROLES.TEACHER })
        .eq("id", targetId)
        .eq("role", ROLES.ADMIN)
        .select()
        .single();

      if (error) throw error;
      res.json({ success: true, user: data });
    } catch (err) {
      console.error("Demote admin error:", err);
      res.status(500).json({ error: "Failed to demote admin" });
    }
  }
);

// GET /api/admin/pending-teachers — List unapproved teachers
router.get("/pending-teachers", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("user")
      .select("id, first_name, last_name, name, email, created_at")
      .eq("role", ROLES.TEACHER)
      .eq("is_approved", false)
      .order("created_at", { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error("Pending teachers error:", err);
    res.status(500).json({ error: "Failed to load pending teachers" });
  }
});

// GET /api/admin/courses — All courses with teacher info
router.get("/courses", async (req, res) => {
  try {
    const { data: courses, error } = await supabase
      .from("courses")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    // Get teacher info and enrollment counts
    for (const course of courses || []) {
      const { data: teacher } = await supabase
        .from("user")
        .select("first_name, last_name, name, email")
        .eq("id", course.teacher_id)
        .single();
      course.teacher = teacher;

      const { data: enrollments } = await supabase
        .from("enrollments")
        .select("id")
        .eq("course_id", course.id);
      course.enrollment_count = enrollments ? enrollments.length : 0;
    }

    res.json(courses);
  } catch (err) {
    console.error("Admin courses error:", err);
    res.status(500).json({ error: "Failed to load courses" });
  }
});

export default router;
