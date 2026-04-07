import { auth } from "../lib/auth.js";
import { fromNodeHeaders } from "better-auth/node";
import supabase from "../database.js";

/**
 * Middleware that attaches req.user from better-auth session.
 * All downstream routes use req.user instead of req.session.user.
 */
async function requireAuth(req, res, next) {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session || !session.user) {
      if (req.path.startsWith("/api/")) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      return res.redirect("/login");
    }

    // Attach user to request for downstream use
    req.user = session.user;
    next();
  } catch (err) {
    console.error("Auth middleware error:", err);
    return res.status(401).json({ error: "Not authenticated" });
  }
}

/**
 * Check if user has one of the required roles.
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}

/**
 * Check if teacher is approved.
 * Owners, admins, and students pass through automatically.
 */
async function requireApproved(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  // Owners, admins, and students don't need approval
  if (["owner", "admin", "student"].includes(req.user.role)) {
    return next();
  }

  try {
    // For teachers, check approval status from the user table
    const { data: user, error } = await supabase
      .from("user")
      .select("is_approved")
      .eq("id", req.user.id)
      .single();

    if (error || !user || !user.is_approved) {
      return res
        .status(403)
        .json({ error: "Your account is pending admin approval" });
    }

    next();
  } catch (err) {
    return res
      .status(500)
      .json({ error: "Server error checking approval status" });
  }
}

export { requireAuth, requireRole, requireApproved };
