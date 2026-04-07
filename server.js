import "dotenv/config";

// Required for Supabase pooler SSL on Vercel
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./lib/auth.js";
import { requireAuth } from "./middleware/auth.js";

import courseRoutes from "./routes/courses.js";
import assignmentRoutes from "./routes/assignments.js";
import messageRoutes from "./routes/messages.js";
import adminRoutes from "./routes/admin.js";
import authRoutes from "./routes/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5432;

// better-auth catch-all — MUST come before express.json()
const authHandler = toNodeHandler(auth);
app.all("/api/auth/*", (req, res) => {
  authHandler(req, res).catch((err) => {
    console.error("Auth error:", err);
    res.status(500).json({ error: "Internal auth error", message: err.message });
  });
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// API Routes
app.use("/auth", authRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/assignments", assignmentRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/admin", adminRoutes);

// Page routes
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "index.html"));
});

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "login.html"));
});

app.get("/register", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "register.html"));
});

// Role-based dashboard routing
app.get("/dashboard", requireAuth, (req, res) => {
  const role = req.user.role;
  if (role === "owner" || role === "admin") {
    res.sendFile(path.join(__dirname, "views", "admin-dashboard.html"));
  } else if (role === "teacher") {
    res.sendFile(path.join(__dirname, "views", "teacher-dashboard.html"));
  } else {
    res.sendFile(path.join(__dirname, "views", "student-dashboard.html"));
  }
});

// Sub-pages
app.get("/course/:id", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "views", "course-detail.html"));
});

app.get("/assignment/:id", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "views", "assignment-detail.html"));
});

app.get("/messages", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "views", "messages.html"));
});

// API endpoint to get current user info (uses better-auth session)
app.get("/api/user", requireAuth, (req, res) => {
  res.json({
    id: req.user.id,
    firstName: req.user.firstName || req.user.name?.split(" ")[0] || "",
    lastName: req.user.lastName || req.user.name?.split(" ").slice(1).join(" ") || "",
    email: req.user.email,
    role: req.user.role,
    isApproved: req.user.isApproved,
    image: req.user.image,
  });
});

// Local development
if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log(`GeniusTestBoost running at http://localhost:${PORT}`);
  });
}

// Export for Vercel
export default app;
