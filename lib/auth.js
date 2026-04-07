import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import pg from "pg";

const ROLES = {
  OWNER: "owner",
  ADMIN: "admin",
  TEACHER: "teacher",
  STUDENT: "student",
};

export { ROLES };

export const auth = betterAuth({
  database: new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  }),

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 6,
  },

  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      scope: [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/calendar.events",
      ],
      accessType: "offline",
    },
  },

  user: {
    additionalFields: {
      first_name: {
        type: "string",
        required: false,
        defaultValue: "",
        input: true,
      },
      last_name: {
        type: "string",
        required: false,
        defaultValue: "",
        input: true,
      },
      is_approved: {
        type: "boolean",
        required: false,
        defaultValue: false,
        input: false,
      },
    },
  },

  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const allowedSelfRegisterRoles = [ROLES.STUDENT, ROLES.TEACHER];
          const role = allowedSelfRegisterRoles.includes(user.role)
            ? user.role
            : ROLES.STUDENT;

          const isApproved = role === ROLES.STUDENT;

          // If name is provided but first/last are not, split the name
          let firstName = user.first_name || "";
          let lastName = user.last_name || "";
          if (!firstName && !lastName && user.name) {
            const parts = user.name.split(" ");
            firstName = parts[0] || "";
            lastName = parts.slice(1).join(" ") || "";
          }

          // Build full name if not already set
          const name =
            user.name || [firstName, lastName].filter(Boolean).join(" ");

          return {
            data: {
              ...user,
              name,
              first_name: firstName,
              last_name: lastName,
              role,
              is_approved: isApproved,
            },
          };
        },
      },
    },
  },

  plugins: [
    admin({
      defaultRole: ROLES.STUDENT,
    }),
  ],
});
