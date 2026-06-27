const express = require('express');
const cors = require('cors');
const app = express()
const port = 5000
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const Stripe = require('stripe');
require('dotenv').config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());

// Helper: Get purchase limit based on subscription tier
const getUserPurchaseLimit = (tier) => {
  const limits = {
    free: 3,
    pro: 9,
    premium: -1 // unlimited
  };
  return limits[tier] || 3;
};

const { authPromise } = require('./auth');

const requireAuth = async (req, res, next) => {
  try {
    const auth = await authPromise;
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = session.user;   // contains { id, email, name, role, ... }
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(401).json({ error: 'Authentication failed' });
  }
};



app.get('/', (req, res) => {
    res.send('Hello World!')
})



const uri = process.env.MONGO_DB_URI;



// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

// Connect the client to the server (optional, will connect dynamically)
client.connect().catch(console.error);

const database = client.db("arthub_db");
const artworkCollection = database.collection("artworks");
const usersCollection = database.collection("user");
const transactionsCollection = database.collection("transactions");
const commentsCollection = database.collection("comments");

      app.get("/api/artworks", async (req, res) => {
        try {
          const {
            artistId,
            status,
            category,
            search,
            minPrice,
            maxPrice,
            sortBy = "createdAt",
            sortOrder = "desc",
            page = 1,
            limit = 8,
          } = req.query;

          // Build match stage
          const match = {};
          if (artistId) match.artistId = artistId;
          if (status) match.status = status;
          if (category && category !== "All Media") match.category = category;

          // Price filter
          if (minPrice || maxPrice) {
            match.price = {};
            if (minPrice) match.price.$gte = Number(minPrice);
            if (maxPrice) match.price.$lte = Number(maxPrice);
          }

          // Text search – we’ll search in both artwork title and joined artist name
          if (search) {
            const regex = new RegExp(search, "i");
            match.$or = [
              { title: { $regex: regex } },
              // artist name will be added after lookup, so we can’t filter on it directly in the match.
              // We’ll filter after lookup instead.
            ];
          }

          // Sort stage
          const sort = {};
          if (sortBy === "price") {
            sort.price = sortOrder === "asc" ? 1 : -1;
          } else {
            sort.createdAt = sortOrder === "asc" ? 1 : -1;
          }

          const pipeline = [
            { $match: match },
            {
              $addFields: {
                artistObjectId: {
                  $convert: {
                    input: "$artistId",
                    to: "objectId",
                    onError: null,
                    onNull: null,
                  },
                },
              },
            },
            {
              $lookup: {
                from: "user",
                localField: "artistObjectId",
                foreignField: "_id",
                as: "artist",
              },
            },
            { $unwind: { path: "$artist", preserveNullAndEmptyArrays: true } },
            // If search is provided, filter by artist name now
            ...(search
              ? [
                  {
                    $match: {
                      $or: [
                        { title: { $regex: new RegExp(search, "i") } },
                        { "artist.name": { $regex: new RegExp(search, "i") } },
                      ],
                    },
                  },
                ]
              : []),
            { $sort: sort },
            { $skip: (Number(page) - 1) * Number(limit) },
            { $limit: Number(limit) },
            {
              $project: {
                _id: 1,
                title: 1,
                category: 1,
                description: 1,
                price: 1,
                image: 1,
                artistId: 1,
                status: 1,
                createdAt: 1,
                artistName: "$artist.name",
              },
            },
          ];

          // For total count, run a separate aggregation without pagination
          const countPipeline = [
            { $match: match },
            {
              $addFields: {
                artistObjectId: {
                  $convert: {
                    input: "$artistId",
                    to: "objectId",
                    onError: null,
                    onNull: null,
                  },
                },
              },
            },
            {
              $lookup: {
                from: "user",
                localField: "artistObjectId",
                foreignField: "_id",
                as: "artist",
              },
            },
            { $unwind: { path: "$artist", preserveNullAndEmptyArrays: true } },
            ...(search
              ? [
                  {
                    $match: {
                      $or: [
                        { title: { $regex: new RegExp(search, "i") } },
                        { "artist.name": { $regex: new RegExp(search, "i") } },
                      ],
                    },
                  },
                ]
              : []),
            { $count: "total" },
          ];

          const [artworks, countResult] = await Promise.all([
            artworkCollection.aggregate(pipeline).toArray(),
            artworkCollection.aggregate(countPipeline).toArray(),
          ]);

          const total = countResult[0]?.total || 0;

          const result = artworks.map((art) => ({
            id: art._id.toString(),
            title: art.title,
            category: art.category,
            description: art.description,
            price: art.price,
            image: art.image,
            artistId: art.artistId,
            artistName: art.artistName || "Unknown Artist",
            status: art.status,
            createdAt: art.createdAt ? art.createdAt.toISOString() : null,
          }));

          res.json({
            artworks: result,
            total,
            page: Number(page),
            pages: Math.ceil(total / Number(limit)),
          });
        } catch (error) {
          console.error("Error fetching artworks:", error);
          res.status(500).json({ error: "Failed to fetch artworks" });
        }
      });

      app.post("/api/artworks", async (req, res) => {
        const artwork = req.body;
        const result = await artworkCollection.insertOne(artwork);
        res.send(result);
      });

      // Update an artwork
      app.put("/api/artworks/:id", async (req, res) => {
        try {
          const { id } = req.params;
          const { ObjectId } = require("mongodb");

          if (!ObjectId.isValid(id)) {
            return res.status(400).json({ error: "Invalid artwork ID." });
          }

          const { title, category, description, price, image } = req.body;

          const updateData = {
            ...(title && { title }),
            ...(category && { category }),
            ...(description !== undefined && { description }),
            ...(price !== undefined && { price: Number(price) }),
            ...(image !== undefined && { image }),
            updatedAt: new Date(),
          };

          const result = await artworkCollection.findOneAndUpdate(
            { _id: new ObjectId(id) },
            { $set: updateData },
            { returnDocument: "after" },
          );

          if (!result) {
            return res.status(404).json({ error: "Artwork not found." });
          }

          const updated = {
            id: result._id.toString(),
            title: result.title,
            category: result.category,
            description: result.description,
            price: result.price,
            image: result.image,
            artistId: result.artistId,
            status: result.status,
            createdAt: result.createdAt?.toISOString() || null,
          };

          res.json(updated);
        } catch (error) {
          console.error("Error updating artwork:", error);
          res.status(500).json({ error: "Failed to update artwork." });
        }
      });

      // Get single artwork by ID
      app.get("/api/artworks/:id", async (req, res) => {
        try {
          const { ObjectId } = require("mongodb");
          const { id } = req.params;

          if (!ObjectId.isValid(id)) {
            return res.status(400).json({ error: "Invalid artwork ID." });
          }

          const pipeline = [
            { $match: { _id: new ObjectId(id) } },
            {
              $addFields: {
                artistObjectId: {
                  $convert: {
                    input: "$artistId",
                    to: "objectId",
                    onError: null,
                    onNull: null,
                  },
                },
              },
            },
            {
              $lookup: {
                from: "user",
                localField: "artistObjectId",
                foreignField: "_id",
                as: "artist",
              },
            },
            { $unwind: { path: "$artist", preserveNullAndEmptyArrays: true } },
            {
              $project: {
                _id: 1,
                title: 1,
                category: 1,
                description: 1,
                price: 1,
                image: 1,
                artistId: 1,
                status: 1,
                createdAt: 1,
                artistName: "$artist.name",
                artistAvatar: "$artist.image",
              },
            },
          ];

          const artworks = await artworkCollection
            .aggregate(pipeline)
            .toArray();

          if (!artworks.length) {
            return res.status(404).json({ error: "Artwork not found." });
          }

          const art = artworks[0];
          res.json({
            id: art._id.toString(),
            title: art.title,
            category: art.category,
            description: art.description,
            price: art.price,
            image: art.image,
            artistId: art.artistId,
            status: art.status,
            createdAt: art.createdAt ? art.createdAt.toISOString() : null,
            artistName: art.artistName || "Unknown Artist",
            artistAvatar: art.artistAvatar || "",
          });
        } catch (error) {
          console.error("Error fetching artwork:", error);
          res.status(500).json({ error: "Failed to fetch artwork." });
        }
      });

      // Check if user has purchased a specific artwork
      app.get("/api/artworks/:id/purchased", requireAuth, async (req, res) => {
        try {
          const artworkId = req.params.id;
          const userId = req.user.id;

          const transaction = await transactionsCollection.findOne({
            userId,
            artworkId,
            type: "purchase",
            status: "completed",
          });

          res.json({ purchased: !!transaction });
        } catch (error) {
          console.error("Error checking purchase:", error);
          res.status(500).json({ error: "Failed to check purchase" });
        }
      });

      // Send a ping to confirm a successful connection
      client.db("admin").command({ ping: 1 }).then(() => {
        console.log(
          "Pinged your deployment. You successfully connected to MongoDB!",
        );
      }).catch(console.dir);

      // ============= STRIPE ENDPOINTS =============

      // Helper collections (lifted to global scope)

      // Phase 2: Create Purchase Session
      app.post(
        "/api/stripe/create-purchase-session",
        requireAuth,
        async (req, res) => {
          try {
            const { artworkId } = req.body;
            const userId = req.user.id;

            // Fetch artwork
            if (!ObjectId.isValid(artworkId)) {
              return res.status(400).json({ error: "Invalid artwork ID" });
            }

            const artwork = await artworkCollection.findOne({
              _id: new ObjectId(artworkId),
            });
            if (!artwork) {
              return res.status(404).json({ error: "Artwork not found" });
            }

            // Check if user is trying to buy their own artwork
            if (artwork.artistId === userId) {
              return res
                .status(400)
                .json({ error: "You cannot purchase your own artwork" });
            }

            // Check purchase limit
            const user = await usersCollection.findOne({
              _id: new ObjectId(userId),
            });
            const subscriptionTier = user?.subscriptionTier || "free";
            const purchaseLimit = getUserPurchaseLimit(subscriptionTier);

            if (purchaseLimit !== -1) {
              const purchaseCount = await transactionsCollection.countDocuments(
                {
                  userId,
                  type: "purchase",
                  status: "completed",
                },
              );

              if (purchaseCount >= purchaseLimit) {
                return res
                  .status(403)
                  .json({
                    error: "Purchase limit reached for your subscription tier",
                  });
              }
            }

            // Create Stripe session
            const session = await stripe.checkout.sessions.create({
              mode: "payment",
              line_items: [
                {
                  price_data: {
                    currency: "usd",
                    product_data: {
                      name: artwork.title,
                      description: artwork.description?.substring(0, 500) || "",
                      images: artwork.image ? [artwork.image] : [],
                    },
                    unit_amount: Math.round(artwork.price * 100),
                  },
                  quantity: 1,
                },
              ],
              success_url: `${process.env.CLIENT_URL}/dashboard/user?tab=history&session_id={CHECKOUT_SESSION_ID}`,
              cancel_url: `${process.env.CLIENT_URL}/artwork/${artworkId}?payment=cancelled`,
              metadata: {
                userId,
                artworkId,
                type: "purchase",
              },
            });

            res.json({ url: session.url });
          } catch (error) {
            console.error("Error creating purchase session:", error);
            res
              .status(500)
              .json({ error: "Failed to create checkout session" });
          }
        },
      );

      // Phase 3: Create Subscription Session
      app.post(
        "/api/stripe/create-subscription-session",
        requireAuth,
        async (req, res) => {
          try {
            const { tier } = req.body;
            const userId = req.user.id;

            if (!["pro", "premium"].includes(tier)) {
              return res
                .status(400)
                .json({ error: "Invalid subscription tier" });
            }

            const priceId =
              tier === "pro"
                ? process.env.STRIPE_PRO_PRICE_ID
                : process.env.STRIPE_PREMIUM_PRICE_ID;

            const session = await stripe.checkout.sessions.create({
              mode: "subscription",
              line_items: [
                {
                  price: priceId,
                  quantity: 1,
                },
              ],
              success_url: `${process.env.CLIENT_URL}/dashboard/user?tab=subscription&session_id={CHECKOUT_SESSION_ID}`,
              cancel_url: `${process.env.CLIENT_URL}/dashboard/user?tab=subscription&cancelled`,
              metadata: {
                userId,
                tier,
              },
            });

            res.json({ url: session.url });
          } catch (error) {
            console.error("Error creating subscription session:", error);
            res
              .status(500)
              .json({ error: "Failed to create subscription session" });
          }
        },
      );

      // Phase 4: Get Stripe Session and Finalize Transaction
      app.get(
        "/api/stripe/session/:sessionId",
        requireAuth,
        async (req, res) => {
          try {
            const { sessionId } = req.params;
            const userId = req.user.id;

            const session = await stripe.checkout.sessions.retrieve(sessionId);

            if (!session) {
              return res.status(404).json({ error: "Session not found" });
            }

            // Check if already recorded
            const existingTransaction = await transactionsCollection.findOne({
              stripeSessionId: sessionId,
            });

            if (existingTransaction) {
              return res.json({ success: true, alreadyRecorded: true });
            }

            if (session.payment_status === "paid") {
              const { type, artworkId, tier } = session.metadata;

              if (type === "purchase") {
                // Record purchase transaction
                await transactionsCollection.insertOne({
                  userId,
                  artworkId,
                  amount: session.amount_total / 100,
                  type: "purchase",
                  status: "completed",
                  stripeSessionId: sessionId,
                  createdAt: new Date(),
                });
              } else if (tier) {
                // Record subscription transaction
                await transactionsCollection.insertOne({
                  userId,
                  amount: session.amount_total / 100,
                  type: "subscription",
                  status: "completed",
                  stripeSessionId: sessionId,
                  createdAt: new Date(),
                });

                // Update user subscription
                await usersCollection.updateOne(
                  { _id: new ObjectId(userId) },
                  {
                    $set: {
                      tier: tier,
                      subscriptionTier: tier,
                      purchaseLimit: getUserPurchaseLimit(tier),
                    },
                  },
                );
              }

              return res.json({ success: true });
            }

            res.json({ success: false });
          } catch (error) {
            console.error("Error retrieving session:", error);
            res.status(500).json({ error: "Failed to retrieve session" });
          }
        },
      );

      // Phase 5: User Purchase History
      app.get("/api/users/:id/purchases", requireAuth, async (req, res) => {
        try {
          const { id } = req.params;

          if (!ObjectId.isValid(id)) {
            return res.status(400).json({ error: "Invalid user ID" });
          }

          const transactions = await transactionsCollection
            .aggregate([
              {
                $match: {
                  userId: id,
                  type: "purchase",
                  status: "completed",
                },
              },
              {
                $addFields: {
                  artworkObjectId: {
                    $convert: {
                      input: "$artworkId",
                      to: "objectId",
                      onError: null,
                      onNull: null,
                    },
                  },
                },
              },
              {
                $lookup: {
                  from: "artworks",
                  localField: "artworkObjectId",
                  foreignField: "_id",
                  as: "artwork",
                },
              },
              {
                $unwind: { path: "$artwork", preserveNullAndEmptyArrays: true },
              },
              {
                $addFields: {
                  artistObjectId: {
                    $convert: {
                      input: "$artwork.artistId",
                      to: "objectId",
                      onError: null,
                      onNull: null,
                    },
                  },
                },
              },
              {
                $lookup: {
                  from: "user",
                  localField: "artistObjectId",
                  foreignField: "_id",
                  as: "artist",
                },
              },
              {
                $unwind: { path: "$artist", preserveNullAndEmptyArrays: true },
              },
              { $sort: { createdAt: -1 } },
              {
                $project: {
                  _id: 1,
                  artworkId: 1,
                  amount: 1,
                  createdAt: 1,
                  artworkTitle: "$artwork.title",
                  artworkImage: "$artwork.image",
                  artistId: "$artwork.artistId",
                  artistName: "$artist.name",
                },
              },
            ])
            .toArray();

          const result = transactions.map((t) => ({
            id: t._id.toString(),
            artworkId: t.artworkId,
            amount: t.amount,
            createdAt: t.createdAt?.toISOString(),
            artworkTitle: t.artworkTitle || "Unknown",
            artworkImage: t.artworkImage || "",
            artistId: t.artistId,
            artistName: t.artistName || "Unknown Artist",
          }));

          res.json(result);
        } catch (error) {
          console.error("Error fetching purchases:", error);
          res.status(500).json({ error: "Failed to fetch purchases" });
        }
      });

      // Phase 5: Artist Sales History
      app.get("/api/artists/:id/sales", async (req, res) => {
        try {
          const { id } = req.params;

          const sales = await transactionsCollection
            .aggregate([
              {
                $lookup: {
                  from: "artworks",
                  let: { artworkId: "$artworkId" },
                  pipeline: [
                    {
                      $match: {
                        $expr: {
                          $eq: ["$_id", { $toObjectId: "$$artworkId" }],
                        },
                        artistId: id,
                      },
                    },
                  ],
                  as: "artwork",
                },
              },
              {
                $unwind: { path: "$artwork", preserveNullAndEmptyArrays: true },
              },
              {
                $match: {
                  "artwork._id": { $exists: true },
                  type: "purchase",
                  status: "completed",
                },
              },
              {
                $lookup: {
                  from: "user",
                  let: { userId: "$userId" },
                  pipeline: [
                    {
                      $match: {
                        $expr: { $eq: ["$_id", { $toObjectId: "$$userId" }] },
                      },
                    },
                  ],
                  as: "buyer",
                },
              },
              { $unwind: { path: "$buyer", preserveNullAndEmptyArrays: true } },
              { $sort: { createdAt: -1 } },
              {
                $project: {
                  _id: 1,
                  artworkId: "$artwork._id",
                  artworkTitle: "$artwork.title",
                  artworkImage: "$artwork.image",
                  buyerName: "$buyer.name",
                  buyerEmail: "$buyer.email",
                  amount: 1,
                  createdAt: 1,
                },
              },
            ])
            .toArray();

          const result = sales.map((s) => ({
            id: s._id.toString(),
            artworkId: s.artworkId ? s.artworkId.toString() : "",
            artworkTitle: s.artworkTitle || "Unknown",
            artworkImage: s.artworkImage || "",
            buyerName: s.buyerName || "Unknown",
            buyerEmail: s.buyerEmail || "",
            amount: s.amount,
            createdAt: s.createdAt?.toISOString(),
          }));

          res.json(result);
        } catch (error) {
          console.error("Error fetching sales:", error);
          res.status(500).json({ error: "Failed to fetch sales" });
        }
      });

      // Phase 5: Admin All Transactions
      app.get("/api/admin/transactions", requireAuth, async (req, res) => {
        try {
          // In a real app, check if user is admin
          const transactions = await transactionsCollection
            .aggregate([
              {
                $lookup: {
                  from: "user",
                  let: { userId: "$userId" },
                  pipeline: [
                    {
                      $match: {
                        $expr: { $eq: ["$_id", { $toObjectId: "$$userId" }] },
                      },
                    },
                  ],
                  as: "user",
                },
              },
              { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
              {
                $addFields: {
                  artworkObjectId: {
                    $convert: {
                      input: "$artworkId",
                      to: "objectId",
                      onError: null,
                      onNull: null,
                    },
                  },
                },
              },
              {
                $lookup: {
                  from: "artworks",
                  localField: "artworkObjectId",
                  foreignField: "_id",
                  as: "artwork",
                },
              },
              {
                $unwind: { path: "$artwork", preserveNullAndEmptyArrays: true },
              },
              { $sort: { createdAt: -1 } },
              {
                $project: {
                  _id: 1,
                  userId: 1,
                  artworkId: 1,
                  type: 1,
                  amount: 1,
                  status: 1,
                  createdAt: 1,
                  userEmail: "$user.email",
                  userName: "$user.name",
                  artworkTitle: "$artwork.title",
                },
              },
            ])
            .toArray();

          const result = transactions.map((t) => ({
            id: t._id.toString(),
            userId: t.userId,
            type:
              t.type === "purchase"
                ? "Purchase"
                : t.type === "subscription"
                  ? "Subscription"
                  : t.type,
            amount: t.amount,
            status: t.status,
            createdAt: t.createdAt?.toISOString(),
            userEmail: t.userEmail || "Unknown",
            userName: t.userName || "Unknown",
            artworkTitle: t.artworkTitle || null,
          }));

          res.json(result);
        } catch (error) {
          console.error("Error fetching transactions:", error);
          res.status(500).json({ error: "Failed to fetch transactions" });
        }
      });

      // Phase 6: Post Comment (Purchase Protected)
      app.post("/api/artworks/:id/comments", requireAuth, async (req, res) => {
        try {
          const { id: artworkId } = req.params;
          const { text } = req.body;
          const userId = req.user.id;

          if (!ObjectId.isValid(artworkId)) {
            return res.status(400).json({ error: "Invalid artwork ID" });
          }

          // Check if user has purchased this artwork
          const purchase = await transactionsCollection.findOne({
            userId,
            artworkId,
            type: "purchase",
            status: "completed",
          });

          if (!purchase) {
            return res
              .status(403)
              .json({ error: "You must purchase this artwork to comment" });
          }

          const comment = {
            artworkId,
            userId,
            text,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          const result = await commentsCollection.insertOne(comment);

          res.json({
            id: result.insertedId.toString(),
            ...comment,
            createdAt: comment.createdAt.toISOString(),
            updatedAt: comment.updatedAt.toISOString(),
          });
        } catch (error) {
          console.error("Error posting comment:", error);
          res.status(500).json({ error: "Failed to post comment" });
        }
      });

      // Phase 6: Update Comment
      app.put("/api/comments/:id", requireAuth, async (req, res) => {
        try {
          const { id: commentId } = req.params;
          const { text } = req.body;
          const userId = req.user.id;

          if (!ObjectId.isValid(commentId)) {
            return res.status(400).json({ error: "Invalid comment ID" });
          }

          const comment = await commentsCollection.findOne({
            _id: new ObjectId(commentId),
          });
          if (!comment) {
            return res.status(404).json({ error: "Comment not found" });
          }

          if (comment.userId !== userId) {
            return res.status(403).json({ error: "Unauthorized" });
          }

          const result = await commentsCollection.findOneAndUpdate(
            { _id: new ObjectId(commentId) },
            { $set: { text, updatedAt: new Date() } },
            { returnDocument: "after" },
          );

          res.json({
            id: result._id.toString(),
            ...result,
            createdAt: result.createdAt.toISOString(),
            updatedAt: result.updatedAt.toISOString(),
          });
        } catch (error) {
          console.error("Error updating comment:", error);
          res.status(500).json({ error: "Failed to update comment" });
        }
      });

      // Phase 6: Delete Comment
      app.delete("/api/comments/:id", requireAuth, async (req, res) => {
        try {
          const { id: commentId } = req.params;
          const userId = req.user.id;

          if (!ObjectId.isValid(commentId)) {
            return res.status(400).json({ error: "Invalid comment ID" });
          }

          const comment = await commentsCollection.findOne({
            _id: new ObjectId(commentId),
          });
          if (!comment) {
            return res.status(404).json({ error: "Comment not found" });
          }

          if (comment.userId !== userId) {
            return res.status(403).json({ error: "Unauthorized" });
          }

          await commentsCollection.deleteOne({ _id: new ObjectId(commentId) });

          res.json({ success: true });
        } catch (error) {
          console.error("Error deleting comment:", error);
          res.status(500).json({ error: "Failed to delete comment" });
        }
      });

      // Phase 7: Admin Stats
      app.get("/api/admin/stats", requireAuth, async (req, res) => {
        try {
          // In a real app, check if user is admin
          const [totalUsers, totalArtists, totalArtworks, totalRevenue] =
            await Promise.all([
              usersCollection.countDocuments(),
              usersCollection.countDocuments({ role: "artist" }),
              artworkCollection.countDocuments(),
              transactionsCollection
                .aggregate([
                  { $match: { status: "completed" } },
                  { $group: { _id: null, total: { $sum: "$amount" } } },
                ])
                .toArray(),
            ]);

          const totalSoldArtworks = await transactionsCollection.countDocuments(
            {
              type: "purchase",
              status: "completed",
            },
          );

          // 1. Group artworks by category
          const categoriesCount = await artworkCollection
            .aggregate([
              { $group: { _id: "$category", count: { $sum: 1 } } },
              { $sort: { count: -1 } },
            ])
            .toArray();

          const categories = categoriesCount.map((c) => ({
            category: c._id || "Other",
            count: c.count,
          }));

          // 2. Sales performance for the last 7 days
          const sevenDaysAgo = new Date();
          sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

          const dailyTransactions = await transactionsCollection
            .aggregate([
              {
                $match: {
                  status: "completed",
                  createdAt: { $gte: sevenDaysAgo },
                },
              },
              {
                $group: {
                  _id: {
                    $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
                  },
                  amount: { $sum: "$amount" },
                  count: { $sum: 1 },
                },
              },
              { $sort: { _id: 1 } },
            ])
            .toArray();

          // Generate last 7 days labels and fill missing days with 0
          const dailySales = [];
          for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split("T")[0];
            const found = dailyTransactions.find((t) => t._id === dateStr);
            dailySales.push({
              date: dateStr,
              dayName: d.toLocaleDateString("en-US", { weekday: "short" }),
              amount: found ? found.amount : 0,
              count: found ? found.count : 0,
            });
          }

          res.json({
            totalUsers,
            totalArtists,
            totalArtworks,
            totalSoldArtworks,
            totalRevenue: totalRevenue[0]?.total || 0,
            categories,
            dailySales,
          });
        } catch (error) {
          console.error("Error fetching stats:", error);
          res.status(500).json({ error: "Failed to fetch stats" });
        }
      });

      // Phase 7: Featured Artworks
      app.get("/api/artworks/featured", async (req, res) => {
        try {
          const artworks = await artworkCollection
            .find({ status: "active" || undefined })
            .sort({ createdAt: -1 })
            .limit(6)
            .toArray();

          const result = artworks.map((art) => ({
            id: art._id.toString(),
            title: art.title,
            category: art.category,
            description: art.description,
            price: art.price,
            image: art.image,
            artistId: art.artistId,
            status: art.status,
            createdAt: art.createdAt?.toISOString(),
          }));

          res.json(result);
        } catch (error) {
          console.error("Error fetching featured artworks:", error);
          res.status(500).json({ error: "Failed to fetch featured artworks" });
        }
      });

      // Phase 7: Top Artists
      app.get("/api/artists/top", async (req, res) => {
        try {
          const topArtists = await transactionsCollection
            .aggregate([
              { $match: { type: "purchase", status: "completed" } },
              {
                $lookup: {
                  from: "artworks",
                  let: { artworkId: "$artworkId" },
                  pipeline: [
                    {
                      $match: {
                        $expr: {
                          $eq: ["$_id", { $toObjectId: "$$artworkId" }],
                        },
                      },
                    },
                  ],
                  as: "artwork",
                },
              },
              {
                $unwind: { path: "$artwork", preserveNullAndEmptyArrays: true },
              },
              {
                $group: {
                  _id: "$artwork.artistId",
                  salesCount: { $sum: 1 },
                },
              },
              { $sort: { salesCount: -1 } },
              { $limit: 3 },
              {
                $lookup: {
                  from: "user",
                  let: { artistId: "$_id" },
                  pipeline: [
                    {
                      $match: {
                        $expr: { $eq: ["$_id", { $toObjectId: "$$artistId" }] },
                      },
                    },
                  ],
                  as: "artist",
                },
              },
              {
                $unwind: { path: "$artist", preserveNullAndEmptyArrays: true },
              },
              {
                $project: {
                  _id: 1,
                  name: "$artist.name",
                  image: "$artist.image",
                  salesCount: 1,
                },
              },
            ])
            .toArray();

          const result = topArtists.map((artist) => ({
            id: artist._id,
            name: artist.name || "Unknown",
            avatar: artist.image || "",
            salesCount: artist.salesCount,
          }));

          res.json(result);
        } catch (error) {
          console.error("Error fetching top artists:", error);
          res.status(500).json({ error: "Failed to fetch top artists" });
        }
      });

      // Get Comments for Artwork
      app.get("/api/artworks/:id/comments", async (req, res) => {
        try {
          const { id: artworkId } = req.params;

          const comments = await commentsCollection
            .aggregate([
              { $match: { artworkId } },
              {
                $lookup: {
                  from: "user",
                  let: { userId: "$userId" },
                  pipeline: [
                    {
                      $match: {
                        $expr: { $eq: ["$_id", { $toObjectId: "$$userId" }] },
                      },
                    },
                  ],
                  as: "user",
                },
              },
              { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
              { $sort: { createdAt: -1 } },
              {
                $project: {
                  _id: 1,
                  userId: 1,
                  text: 1,
                  createdAt: 1,
                  updatedAt: 1,
                  userName: "$user.name",
                  userAvatar: "$user.image",
                },
              },
            ])
            .toArray();

          const result = comments.map((c) => ({
            id: c._id.toString(),
            userId: c.userId,
            text: c.text,
            createdAt: c.createdAt?.toISOString(),
            updatedAt: c.updatedAt?.toISOString(),
            userName: c.userName || "Anonymous",
            userAvatar: c.userAvatar || "",
          }));

          res.json(result);
        } catch (error) {
          console.error("Error fetching comments:", error);
          res.status(500).json({ error: "Failed to fetch comments" });
        }
      });

module.exports = app;

if (process.env.VERCEL !== '1') {
  app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
  })
}