import express from "express";

const router = express.Router();

// All email/password and OAuth auth is handled by better-auth at /api/auth/*
// This file is kept for any custom auth-related endpoints.

// GET /auth/google — Convenience redirect to better-auth Google OAuth
router.get("/google", (req, res) => {
  const callbackURL = req.query.callbackURL || "/dashboard";
  res.redirect(
    `/api/auth/sign-in/social?provider=google&callbackURL=${encodeURIComponent(callbackURL)}`
  );
});

export default router;
