const express = require('express');
const cors = require('cors');
const app = express()
const port = 5000
const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config();

app.use(cors());
app.use(express.json());



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

async function run() {
    try {
      // Connect the client to the server	(optional starting in v4.7)
      await client.connect();

      const database = client.db("arthub_db");
      const artworkCollection = database.collection("artworks");

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

      // Send a ping to confirm a successful connection
      await client.db("admin").command({ ping: 1 });
      console.log(
        "Pinged your deployment. You successfully connected to MongoDB!",
      );
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);



app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})