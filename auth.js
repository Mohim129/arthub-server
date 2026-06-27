const { betterAuth } = require("better-auth");
const { MongoClient } = require("mongodb");
const { mongodbAdapter } = require("better-auth/adapters/mongodb");
const { getOAuthState } = require("better-auth/api");

const client = new MongoClient(process.env.MONGO_DB_URI);
const db = client.db(process.env.AUTH_DB_NAME);

const auth = betterAuth({
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    google: {
      clientId:
        process.env.GOOGLE_CLIENT_ID,
      clientSecret:
        process.env.GOOGLE_CLIENT_SECRET,
    },
  },
  database: mongodbAdapter(db, {
    client,
  }),
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const oAuthState = await getOAuthState();
          const role = oAuthState?.role || user.role || "user";
          const image = user.image || oAuthState?.image || "";
          const bio = user.bio || oAuthState?.bio || "";
          return {
            data: {
              ...user,
              role,
              bio,
              image,
            },
          };
        },
      },
    },
  },
  user: {
    additionalFields: {
      role: {
        default: "user",
      },
      bio: {
        default: "",
      },
      image: {
        default: "",
      },
      tier: {
        default: "free",
      },
    },
  },
});

module.exports = { auth };
