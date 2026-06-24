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
          const query = {};

          if (req.query.artistId) {
            query.artistId = req.query.artistId;
          }
          if (req.query.status) {
            query.status = req.query.status;
          }
          if (req.query.category) {
            query.category = req.query.category; // e.g. "Digital Painting"
          }

          const artworks = await artworkCollection.find(query).toArray();

          const result = artworks.map((art) => ({
            id: art._id.toString(),
            title: art.title,
            category: art.category, // ← include category
            description: art.description,
            price: art.price,
            image: art.image,
            artistId: art.artistId,
            status: art.status,
            createdAt: art.createdAt ? art.createdAt.toISOString() : null,
          }));

          res.json(result);
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