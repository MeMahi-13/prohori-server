const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() }); // for photo

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.qjseg5b.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // await client.connect();

    // Collections
    const medicineCollection = client.db("bangladesh").collection("medicines");
   const lostFoundCollection = client.db("bangladesh").collection("lost"); // match your MongoDB collection

    const crimeCollection = client.db("bangladesh").collection("crimes");
    const sosCollection = client.db("bangladesh").collection("sos");
    const userCollection = client.db("bangladesh").collection("users");

    // Ensure GeoJSON index for crime locations
    await crimeCollection.createIndex({ location: "2dsphere" });

   
    /** ---------------- Crime Routes ---------------- */

    // POST: Add a new crime
    app.post('/crimes', async (req, res) => {
      try {
        const { title, description, category, location, user } = req.body;

        // Basic validation
        if (!title || !description || !category || !location?.coordinates) {
          return res.status(400).send({ error: "Missing required fields" });
        }

        // Ensure coordinates are numbers
        location.type = "Point";
        location.coordinates = location.coordinates.map(Number);

        const newCrime = {
          title,
          description,
          category,
          location, // include name if available
          user: user || { name: "Anonymous", contact: "" },
          time: new Date(),
        };

        const result = await crimeCollection.insertOne(newCrime);
        res.status(201).send(result);
      } catch (err) {
        res.status(400).send({ error: "Invalid data format", details: err.message });
      }
    });

    // GET: All crimes
    app.get('/crimes', async (req, res) => {
      const crimes = await crimeCollection.find().sort({ time: -1 }).toArray();
      res.send(crimes);
    });

    // GET: Single crime by ID
    app.get('/crimes/:id', async (req, res) => {
      const id = req.params.id;
      const crime = await crimeCollection.findOne({ _id: new ObjectId(id) });
      res.send(crime);
    });

    // GET: sos alert

    app.post("/sos", async (req, res) => {
      try {
        const { latitude, longitude, user } = req.body;

        if (!latitude || !longitude) {
          return res.status(400).json({ message: "Location is required" });
        }

        // Get user's IP
        const ip =
          req.headers["x-forwarded-for"]?.split(",").shift() || req.socket.remoteAddress;

        const alert = {
          latitude,
          longitude,
          ip,
          user: user || { name: "Anonymous", contact: "" },
          timestamp: new Date(),
        };

        const result = await sosCollection.insertOne(alert);

        console.log("🚨 SOS Alert received:", alert);

        res.json({ message: "SOS alert stored!", alertId: result.insertedId });
      } catch (err) {
        console.error("SOS error:", err);
        res.status(500).json({ message: "Failed to store SOS alert" });
      }
    });


// POST: Admin login
// POST: Login (works for both admin + users)
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: "Email & password required" });

  const user = await userCollection.findOne({ email, password }); // plaintext check for now

  if (!user) return res.status(401).json({ message: "Invalid credentials" });

  // ✅ return full user info including role
  res.json({
    message: "Login successful",
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role, 
    },
  });
});



    // GET: Fetch all SOS alerts
    app.get("/sos", async (req, res) => {
      const alerts = await sosCollection.find().sort({ timestamp: -1 }).toArray();
      res.json(alerts);
    });


    // Example: /crimes/nearby?lng=90.366&lat=23.8103&distance=5000
    app.get('/crimes/nearby', async (req, res) => {
      const { lng, lat, distance = 5000 } = req.query;
      if (!lng || !lat) return res.status(400).send({ error: "Missing coordinates" });

      const nearbyCrimes = await crimeCollection.find({
        location: {
          $near: {
            $geometry: { type: "Point", coordinates: [parseFloat(lng), parseFloat(lat)] },
            $maxDistance: parseInt(distance)
          }
        }
      }).toArray();
      res.send(nearbyCrimes);
    });

app.get("/admin/counts", async (req, res) => {
  try {
    const crimeCount = await crimeCollection.countDocuments();
    const sosCount = await sosCollection.countDocuments();
    const lostFoundCount = await lostFoundCollection.countDocuments();

    res.json({
      crimes: crimeCount,
      sos: sosCount,
      lostfound: lostFoundCount
    });
  } catch (err) {
    console.error("Error fetching counts:", err);
    res.status(500).json({ message: "Failed to fetch counts" });
  }
});


    // 2️⃣ GET route to fetch all lost & found cases
app.get("/lostfound", async (req, res) => {
  try {
    const cases = await lostFoundCollection.find().sort({ date: -1 }).toArray();
    res.json(cases);
  } catch (err) {
    console.error("Error fetching lost & found cases:", err);
    res.status(500).json({ message: "Failed to fetch lost & found cases" });
  }
});

// 3️⃣ Optional: POST route to report a new case
app.post("/lostfound", async (req, res) => {
  try {
    const { type, item, location, date, reporter, contact, photo } = req.body;

    if (!type || !item || !location || !date || !reporter || !contact) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const newCase = { type, item, location, date, reporter, contact, photo };
    const result = await lostFoundCollection.insertOne(newCase);

    res.status(201).json({ message: "Case reported successfully", id: result.insertedId });
  } catch (err) {
    console.error("Error adding lost & found case:", err);
    res.status(500).json({ message: "Failed to report case" });
  }
});

app.delete('/crimes/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const result = await crimeCollection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) return res.status(404).json({ message: 'Crime not found' });
    res.json({ message: 'Crime deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});
// Mark lost & found case as resolved
app.patch("/lostfound/:id/resolve", async (req, res) => {
  const { id } = req.params;
  const { resolved } = req.body;

  try {
    const result = await lostFoundCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { resolved: resolved } }
    );

    if (result.modifiedCount > 0) {
      res.json({ message: "Case marked as resolved" });
    } else {
      res.status(404).json({ message: "Case not found or already resolved" });
    }
  } catch (err) {
    console.error("Error resolving case:", err);
    res.status(500).json({ message: "Failed to resolve case" });
  }
});

const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() }); // keep photo in memory

// 1️⃣ GET all lost & found cases
app.get("/lostfound", async (req, res) => {
  try {
    const cases = await lostFoundCollection.find().sort({ createdAt: -1 }).toArray();
    res.json(cases);
  } catch (err) {
    console.error("Error fetching lost & found cases:", err);
    res.status(500).json({ message: "Failed to fetch lost & found cases" });
  }
});

// 2️⃣ POST a new lost/found case
app.post("/lostfound", upload.single("photo"), async (req, res) => {
  try {
    const { type, item, location, date, reporter, contact, email } = req.body;

    if (!type || !item || !location || !date || !reporter || !contact || !email) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const newCase = {
      type,
      item,
      location,
      date,
      reporter,
      contact,
      email, // store user's email
      photo: req.file ? req.file.buffer.toString("base64") : null,
      resolved: false,
      createdAt: new Date(),
    };

    const result = await lostFoundCollection.insertOne(newCase);
    res.status(201).json({ message: "Case reported successfully", id: result.insertedId });
  } catch (err) {
    console.error("Error adding lost & found case:", err);
    res.status(500).json({ message: "Failed to report case" });
  }
});

// 3️⃣ PATCH to mark as resolved
app.patch("/lostfound/:id/resolve", async (req, res) => {
  try {
    const { id } = req.params;
    const { resolved } = req.body;

    const result = await lostFoundCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { resolved: resolved } }
    );

    if (result.modifiedCount > 0) {
      res.json({ message: "Case marked as resolved" });
    } else {
      res.status(404).json({ message: "Case not found or already resolved" });
    }
  } catch (err) {
    console.error("Error resolving case:", err);
    res.status(500).json({ message: "Failed to resolve case" });
  }
});


// PATCH /sos/:id/handle
app.patch("/sos/:id/handle", async (req, res) => {
  const { id } = req.params;
  const { handled } = req.body; // expects { handled: true }

  if (typeof handled !== "boolean") {
    return res.status(400).json({ message: "Handled must be boolean" });
  }

  try {
    const result = await sosCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { handled: handled } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "SOS alert not found" });
    }

    res.json({ message: `SOS alert marked as ${handled ? "handled" : "pending"}` });
  } catch (err) {
    console.error("Error marking SOS alert:", err);
    res.status(500).json({ message: "Failed to update SOS alert" });
  }
});

// Add this in your backend (server.js or app.js)


// POST: Register new user
app.post("/users/register", upload.single("photo"), async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email, and password are required" });
    }

    // Check if user already exists
    const existingUser = await userCollection.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    // Prepare user object
    const newUser = {
      uid: new ObjectId().toString(), // generate unique ID
      name,
      email,
      password, // NOTE: For production, hash the password
      role: role || "user",
      photo: req.file ? req.file.buffer.toString("base64") : null,
      createdAt: new Date(),
    };

    // Insert into MongoDB
    await userCollection.insertOne(newUser);

    res.status(201).json({ message: "User registered successfully", user: newUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to register user" });
  }
});





    /** -------------------------------------------------- */

    // await client.db("admin").command({ ping: 1 });
    // console.log("✅ Connected to MongoDB successfully!");
  } finally {
    // Keep connection alive
  }
}


run().catch(console.dir);

app.get('/', (req, res) => res.send('Server is running.. 🚀'));

app.listen(port, () => console.log(`Server is running on port ${port}`));
