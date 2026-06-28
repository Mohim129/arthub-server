const { MongoClient } = require("mongodb");

async function createAuth() {
  // Dynamically import the ES modules required by better-auth
  const { betterAuth } = await import("better-auth");
  const { mongodbAdapter } = await import("better-auth/adapters/mongodb");
  const { getOAuthState } = await import("better-auth/api");

  const client = new MongoClient(process.env.MONGO_DB_URI);
  const db = client.db(process.env.AUTH_DB_NAME);

  const auth = betterAuth({
    trustedOrigins: [process.env.CLIENT_URL].filter(Boolean),
    emailAndPassword: { enabled: true },
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      },
    },

    // ===== ADDED: Cross‑site session cookie =====
    session: {
      cookieOptions: {
        secure: true, // only sent over HTTPS (required by SameSite=None)
        sameSite: "none", // allow the cookie to be sent to other domains
        httpOnly: true, // not accessible by JavaScript
        maxAge: 60 * 60 * 24 * 7, // 7 days
        domain: process.env.COOKIE_DOMAIN || undefined, // scoped to the frontend's domain
      },
    },
    // ==========================================

    database: mongodbAdapter(db, { client }),
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const oAuthState = await getOAuthState();
            const role = oAuthState?.role || user.role || "user";
            const image = user.image || oAuthState?.image || "";
            const bio = user.bio || oAuthState?.bio || "";
            return { data: { ...user, role, bio, image } };
          },
        },
      },
    },
    user: {
      additionalFields: {
        role: { default: "user" },
        bio: { default: "" },
        image: { default: "" },
        tier: { default: "free" },
      },
    },
  });

  return auth;
}

module.exports = { authPromise: createAuth() };
