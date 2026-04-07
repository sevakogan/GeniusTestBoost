# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

GeniusTestBoost is a full-stack Learning Management System (LMS) for test prep tutoring. Built with Express.js 4, Supabase (PostgreSQL), server-side sessions, and vanilla HTML/CSS/JS frontend.

**This is NOT a React/Next.js project** — it's a traditional Express MVC application with HTML templates.

## Commands

```bash
npm start         # Start server (node server.js, port 5432)
npm run dev       # Same as start
```

No test framework or linter is configured.

## Architecture

### Entry Point (`server.js`)
- Express server on port 5432 (or `PORT` env var)
- Session-based auth (express-session, 24-hour cookie, secret: `'onlineschool-v1-secret-key'`)
- Static files from `public/`
- `res.locals.user` set from session for template access
- Dashboard route (`GET /dashboard`) redirects to role-specific HTML template

### Route Files (`routes/`)
- `auth.js` — register (bcrypt hashing), login, logout
- `courses.js` — CRUD, enrollment/unenrollment, student listing (ownership-verified)
- `assignments.js` — CRUD, submit/resubmit work, grade submissions
- `messages.js` — send messages, conversations, contacts, unread counts
- `admin.js` — platform stats, user management, teacher approval/rejection/promotion

### Middleware (`middleware/auth.js`)
Three middleware functions composable via route chains:
- `requireAuth` — checks `req.session.user`
- `requireRole(...roles)` — checks user role against allowed list
- `requireApproved` — async check against DB that teacher is approved

### Role System
| Role | Registration | Key Permissions |
|------|-------------|----------------|
| **student** | Self-register, auto-approved | Enroll in courses, submit assignments, message enrolled teachers |
| **teacher** | Self-register, requires admin approval | Create courses/assignments (only when approved), grade submissions, message enrolled students |
| **master_teacher** | Created by admin only | Full admin panel, manage all users, approve teachers, view all courses, message anyone |

### Database (`database.js`)
Supabase client initialized with `SUPABASE_URL` and `SUPABASE_ANON_KEY`.

**Tables**: `users`, `courses`, `enrollments` (unique student+course), `assignments`, `submissions` (upsert pattern), `messages`

### Views (`views/`)
HTML templates with inline `<script>` tags for frontend logic (vanilla JS + Fetch API):
- `index.html` — landing page
- `login.html`, `register.html` — auth pages
- `student-dashboard.html`, `teacher-dashboard.html`, `admin-dashboard.html` — role-specific dashboards
- `course-detail.html`, `assignment-detail.html`, `messages.html`

### Key Patterns
- **Ownership verification**: teachers can only modify their own courses; admin bypasses
- **Soft deletes**: courses use `is_active` flag
- **Enrollment-gated access**: students can only see courses they're enrolled in
- **Teacher approval gate**: unapproved teachers see a banner and cannot create content
- **Relationship loading**: N+1 pattern (loop + individual queries for teacher/student info)

## Environment Variables

```
SUPABASE_URL
SUPABASE_ANON_KEY
PORT              # Optional, defaults to 5432
```
