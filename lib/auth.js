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
      firstName: {
        type: "string",
        required: false,
        defaultValue: "",
        input: true,
        fieldName: "firstName",
      },
      lastName: {
        type: "string",
        required: false,
        defaultValue: "",
        input: true,
        fieldName: "lastName",
      },
      isApproved: {
        type: "boolean",
        required: false,
        defaultValue: false,
        input: false,
        fieldName: "isApproved",
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
          let firstName = user.firstName || "";
          let lastName = user.lastName || "";
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
              firstName,
              lastName,
              role,
              isApproved,
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
