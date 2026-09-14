const express = require("express");
const cors = require("cors");
const pool = require("./db");
require("dotenv").config();
const db = require("./db");
const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    message: "Smart Agriculture Backend Running",
  });
});

app.get("/db-test", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");

    res.json({
      success: true,
      message: "PostgreSQL Connected",
      time: result.rows[0],
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Database connection failed",
    });
  }
});

app.get("/user/:email", async (req, res) => {
  try {
    const { email } = req.params;

    console.log("GET USER EMAIL:", email);

    const query = `
      SELECT *
      FROM public."user"
      WHERE "email" = $1
    `;

    const { rows } = await db.query(query, [email]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json(rows[0]);

  } catch (error) {
    console.error("GET USER ERROR:", error);

    return res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Something went wrong",
    });
  }
});

app.patch("/user/:email", async (req, res) => {
  try {
    const { email } = req.params;

    const { name, image } = req.body;

    const updates = {};

    if (name !== undefined) {
      updates.name = name;
    }

    if (image !== undefined) {
      updates.image = image;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No fields provided to update",
      });
    }

    const keys = Object.keys(updates);

    const setClause = keys
      .map((key, index) => `"${key}" = $${index + 1}`)
      .join(", ");

    const values = Object.values(updates);

    values.push(email);

    const query = `
      UPDATE public."user"
      SET ${setClause}
      WHERE "email" = $${values.length}
      RETURNING *
    `;

    console.log("UPDATE VALUES:", values);

    const result = await db.query(query, values);

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      updatedUser: result.rows[0],
    });

  } catch (error) {
    console.error("UPDATE USER ERROR:", error);

    return res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Something went wrong",
    });
  }
});

const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// Sleep Helper
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Gemini Diagnosis with Retry + Fallback
async function generateDiagnosis(requestData) {
  const models = [
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
  ];

  let lastError = null;
  for (const model of models) {
    const maxRetries = 1;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Gemini ${model} - attempt ${attempt}`);
        const response = await ai.models.generateContent({
          ...requestData,
          model,
        });
        console.log(`Gemini diagnosis successful with: ${model}`);
        return response;
      } catch (error) {
        lastError = error;
        console.error(
          `Gemini ${model} attempt ${attempt} failed:`,
          error.message
        );
        if (error.status === 429) {
          console.log(`${model} returned 429. Moving to fallback model...`);
          break;
        }
        if (error.status === 503) {
          if (attempt === maxRetries) {
            console.log(`${model} is still busy. Moving to fallback model...`);
            break;
          }
          const delay = 1500 * Math.pow(2, attempt - 1);
          console.log(`Retrying ${model} in ${delay / 1000} seconds...`);
          await sleep(delay);
          continue;
        }
        throw error;
      }
    }
  }
  throw lastError || new Error("All Gemini models failed");
}

// AI Crop Disease Diagnosis
app.post("/api/diagnose", async (req, res) => {
  try {
    const { imageUrl, language = "bn" } = req.body;

    if (!imageUrl) {
      return res.status(400).json({
        success: false,
        message: "Image URL is required",
      });
    }

    const fastImageUrl = imageUrl.replace(
      "/upload/",
      "/upload/w_600,q_auto,f_auto/"
    );

    console.log("Optimized image URL:", fastImageUrl);

    const imageResponse = await fetch(fastImageUrl);

    if (!imageResponse.ok) {
      throw new Error("Could not download image from Cloudinary");
    }

    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
    const mimeType = imageResponse.headers.get("content-type") || "image/jpeg";
    const base64Image = imageBuffer.toString("base64");

    const responseLanguage =
      language === "bn" ? "Bengali (Bangla)" : "English";

    const prompt = `
You are an expert agricultural plant pathologist.

Analyze the provided crop leaf image carefully.

Your tasks:
1. Identify the crop/plant if possible.
2. Identify the most likely disease or condition.
3. If the plant appears healthy, clearly say that it is healthy.
4. Do not invent symptoms that are not visible or reasonably inferable.
5. Provide a confidence score from 0 to 100.
6. List visible symptoms.
7. Provide practical organic treatment.
8. Provide chemical treatment when appropriate.
9. Provide prevention recommendations.
10. Return ONLY the requested JSON structure.
11. Do not use Markdown.
12. Do not add explanations outside JSON.
13. Every human-readable value must be written in ${responseLanguage}.

The response language is ${responseLanguage}.
`;

    const responseSchema = {
      type: "object",
      properties: {
        disease: {
          type: "string",
          description: "Most likely crop disease or condition",
        },
        scientificName: {
          type: "string",
          description: "Scientific name of the disease or pathogen",
        },
        confidence: {
          type: "number",
          description: "Confidence score from 0 to 100",
        },
        symptoms: {
          type: "array",
          items: { type: "string" },
          description: "Visible symptoms detected in the image",
        },
        organicTreatment: {
          type: "array",
          items: { type: "string" },
          description: "Recommended organic treatment methods",
        },
        chemicalTreatment: {
          type: "array",
          items: { type: "string" },
          description: "Recommended chemical treatment methods",
        },
        prevention: {
          type: "array",
          items: { type: "string" },
          description: "Disease prevention recommendations",
        },
      },
      required: [
        "disease",
        "scientificName",
        "confidence",
        "symptoms",
        "organicTreatment",
        "chemicalTreatment",
        "prevention",
      ],
    };

    const response = await generateDiagnosis({
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType,
                data: base64Image,
              },
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema,
      },
    });

    const diagnosis = JSON.parse(response.text);

    // Save diagnosis result to PostgreSQL
    const dbQuery = `
      INSERT INTO crop_diagnoses 
      (image_url, language, disease, scientific_name, confidence, symptoms, organic_treatment, chemical_treatment, prevention)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *;
    `;

    const dbValues = [
      imageUrl,
      language,
      diagnosis.disease,
      diagnosis.scientificName,
      diagnosis.confidence,
      JSON.stringify(diagnosis.symptoms),
      JSON.stringify(diagnosis.organicTreatment),
      JSON.stringify(diagnosis.chemicalTreatment),
      JSON.stringify(diagnosis.prevention),
    ];

    const savedRecord = await pool.query(dbQuery, dbValues);

    return res.json({
      success: true,
      result: diagnosis,
      recordId: savedRecord.rows[0].id,
    });
  } catch (error) {
    console.error("Gemini Diagnosis Error:", error);

    if (error.status === 429) {
      return res.status(429).json({
        success: false,
        message: "AI diagnosis limit has been reached. Please try again later.",
      });
    }
    if (error.status === 503) {
      return res.status(503).json({
        success: false,
        message: "AI service is temporarily busy. Please try again in a moment.",
      });
    }
    return res.status(500).json({
      success: false,
      message: "Diagnosis failed",
      error: error.message,
    });
  }
});

// Fetch saved Crop Diagnosis History
app.get("/api/diagnose/history", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM crop_diagnoses ORDER BY created_at DESC LIMIT 20"
    );
    res.json({
      success: true,
      history: result.rows,
    });
  } catch (error) {
    console.error("Error fetching diagnosis history:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// AI Soil Analysis
app.post("/api/soil", async (req, res) => {
  try {
    const { imageUrl, language = "bn" } = req.body;

    if (!imageUrl) {
      return res.status(400).json({
        success: false,
        message: "Image URL is required",
      });
    }

    const fastImageUrl = imageUrl.replace(
      "/upload/",
      "/upload/w_600,q_auto,f_auto/"
    );

    console.log("Optimized image URL:", fastImageUrl);

    const imageResponse = await fetch(fastImageUrl);

    if (!imageResponse.ok) {
      throw new Error("Could not download image from Cloudinary");
    }

    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
    const mimeType = imageResponse.headers.get("content-type") || "image/jpeg";
    const base64Image = imageBuffer.toString("base64");

    const responseLanguage =
      language === "bn" ? "Bengali (Bangla)" : "English";

    const prompt = `
You are an expert soil scientist and agricultural chemist.

Analyze the provided image of soil carefully.

Your tasks:
1. Identify the soil type (e.g., Clay, Sandy, Loamy, Silt, Peat, Chalky).
2. Estimate soil health indicators (texture, moisture, organic matter level, color).
3. Estimate approximate pH range and NPK (Nitrogen, Phosphorus, Potassium) status based on visual characteristics.
4. Recommend suitable crops or plants for this soil type.
5. Provide actionable recommendations to improve soil fertility and structure.
6. Provide a confidence score from 0 to 100.
7. Return ONLY the requested JSON structure.
8. Do not use Markdown.
9. Do not add explanations outside JSON.
10. Every human-readable value must be written in ${responseLanguage}.

The response language is ${responseLanguage}.
`;

    const responseSchema = {
      type: "object",
      properties: {
        soilType: {
          type: "string",
          description: "Primary category or type of the soil",
        },
        confidence: {
          type: "number",
          description: "Confidence score from 0 to 100",
        },
        estimatedpH: {
          type: "string",
          description: "Estimated pH range (e.g., 6.0 - 6.5)",
        },
        moistureLevel: {
          type: "string",
          description: "Visual moisture condition (e.g., Dry, Moist, Waterlogged)",
        },
        organicMatterContent: {
          type: "string",
          description:
            "Estimated organic matter content (e.g., Low, Medium, High)",
        },
        suitableCrops: {
          type: "array",
          items: { type: "string" },
          description: "List of crops suitable for this soil",
        },
        soilImprovements: {
          type: "array",
          items: { type: "string" },
          description:
            "Recommended organic/fertilizer actions to improve soil quality",
        },
        characteristics: {
          type: "array",
          items: { type: "string" },
          description: "Key visual features observed (color, texture, compaction)",
        },
      },
      required: [
        "soilType",
        "confidence",
        "estimatedpH",
        "moistureLevel",
        "organicMatterContent",
        "suitableCrops",
        "soilImprovements",
        "characteristics",
      ],
    };

    const response = await generateDiagnosis({
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType,
                data: base64Image,
              },
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema,
      },
    });

    const soil = JSON.parse(response.text);

    // Save soil analysis result to PostgreSQL
    const dbQuery = `
      INSERT INTO soil_analyses 
      (image_url, language, soil_type, confidence, estimated_ph, moisture_level, organic_matter_content, suitable_crops, soil_improvements, characteristics)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *;
    `;

    const dbValues = [
      imageUrl,
      language,
      soil.soilType,
      soil.confidence,
      soil.estimatedpH,
      soil.moistureLevel,
      soil.organicMatterContent,
      JSON.stringify(soil.suitableCrops),
      JSON.stringify(soil.soilImprovements),
      JSON.stringify(soil.characteristics),
    ];

    const savedRecord = await pool.query(dbQuery, dbValues);

    return res.json({
      success: true,
      result: soil,
      recordId: savedRecord.rows[0].id,
    });
  } catch (error) {
    console.error("Gemini Soil Analysis Error:", error);

    if (error.status === 429) {
      return res.status(429).json({
        success: false,
        message:
          "AI soil analysis limit has been reached. Please try again later.",
      });
    }
    if (error.status === 503) {
      return res.status(503).json({
        success: false,
        message: "AI service is temporarily busy. Please try again in a moment.",
      });
    }
    return res.status(500).json({
      success: false,
      message: "Soil analysis failed",
      error: error.message,
    });
  }
});

// Fetch saved Soil Analysis History
app.get("/api/soil/history", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM soil_analyses ORDER BY created_at DESC LIMIT 20"
    );
    res.json({
      success: true,
      history: result.rows,
    });
  } catch (error) {
    console.error("Error fetching soil history:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Weather API
app.get("/api/weather", async (req, res) => {
  try {
    const city = req.query.city || "Dhaka";
    const language = req.query.lang === "bn" ? "bn" : "en";

    const url = new URL("https://api.weatherapi.com/v1/forecast.json");

    url.searchParams.set("key", process.env.WEATHER_API_KEY);
    url.searchParams.set("q", city);
    url.searchParams.set("days", "3");
    url.searchParams.set("aqi", "no");
    url.searchParams.set("alerts", "yes");
    url.searchParams.set("lang", language);

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        message: data?.error?.message || "Failed to fetch weather data",
      });
    }
    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Weather API Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch weather data",
    });
  }
});

const http = require("http");
const { Server } = require("socket.io");
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

async function getOrCreateConversation(farmerId, expertId) {
  const result = await pool.query(
    `
    INSERT INTO conversations (farmer_id, expert_id)
    VALUES ($1, $2)

    ON CONFLICT (farmer_id, expert_id)
    DO UPDATE SET updated_at = NOW()

    RETURNING id
    `,
    [farmerId, expertId]
  );

  return result.rows[0].id;
}

io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  socket.on("join_room", async (data) => {
    try {
      const {
        roomId,
        farmerId,
        expertId,
      } = data;

      console.log("Join room data:", {
        roomId,
        farmerId,
        expertId,
      });

      // Validate IDs
      if (!roomId || !farmerId || !expertId) {
        console.log("Invalid join room data");

        return;
      }

      const conversationId = await getOrCreateConversation(farmerId, expertId);

      socket.join(roomId);

      socket.data.conversationId = conversationId;

      socket.data.farmerId = farmerId;

      socket.data.expertId = expertId;

      console.log(
        `Socket ${socket.id} joined room ${roomId}`
      );

      console.log(
        "Conversation ID:",
        conversationId
      );

    } catch (error) {
      console.error(
        "Join room error:",
        error
      );
    }
  });

socket.on("send_message", async (messageData) => {
  try {
    const { roomId, sender, senderId, message, image } = messageData;

    const cleanedMessage = typeof message === "string" ? message.trim() : "";
    const hasText = cleanedMessage.length > 0;
    const hasImage = Boolean(image);

    if (!roomId || !senderId || (!hasText && !hasImage)) {
      return;
    }

    const conversationId = socket.data.conversationId;

    if (!conversationId) {
      console.log("Conversation not found");
      return;
    }

    const result = await pool.query(
      `
      INSERT INTO messages
      (
        conversation_id,
        sender_id,
        sender_role,
        message,
        image_url
      )
      VALUES
      ($1, $2, $3, $4, $5)
      RETURNING
        id,
        conversation_id,
        sender_id,
        sender_role,
        message,
        image_url,
        created_at
      `,
      [
        conversationId,
        senderId,
        sender,
        cleanedMessage, // null না পাঠিয়ে পরিষ্কার করা টেক্সট (অথবা ফাঁকা স্ট্রিং "") পাঠানো হচ্ছে
        image || null,
      ]
    );

    const savedMessage = result.rows[0];

    io.to(roomId).emit("receive_message", {
      id: savedMessage.id,
      sender: savedMessage.sender_role,
      senderId: savedMessage.sender_id,
      message: savedMessage.message,
      imageUrl: savedMessage.image_url,
      conversationId: savedMessage.conversation_id,
      createdAt: savedMessage.created_at,
    });

    await pool.query(
      `
      UPDATE conversations
      SET updated_at = NOW()
      WHERE id = $1
      `,
      [conversationId]
    );
  } catch (error) {
    console.error("Save message error:", error);
  }
});

  socket.on("disconnect", () => {
    console.log(
      "A user disconnected:",
      socket.id
    );
  });
});

app.get("/api/experts", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, email, image
      FROM "user"
      WHERE role = 'expert'
      AND status = 'active'
      ORDER BY name ASC
    `);

    res.json({
      success: true,
      experts: result.rows,
    });
  } catch (error) {
    console.error("Get experts error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to get experts",
    });
  }
});

app.get("/api/farmers", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, email, image
      FROM "user"
      WHERE role = 'farmer'
      AND status = 'active'
      ORDER BY name ASC
    `);

    res.json({
      success: true,
      farmers: result.rows,
    });
  } catch (error) {
    console.error("Get farmers error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to get farmers",
    });
  }
});
app.get(
  "/api/conversations/:farmerId/:expertId/messages",
  async (req, res) => {
    try {
      const {
        farmerId,
        expertId,
      } = req.params;

      const result = await pool.query(
        `
        SELECT
          m.id,
          m.conversation_id,
          m.sender_id,
          m.sender_role,
          m.message,
           m.image_url,
          m.created_at
        FROM messages m

        INNER JOIN conversations c
          ON m.conversation_id = c.id

        WHERE c.farmer_id = $1
          AND c.expert_id = $2

        ORDER BY m.created_at ASC
        `,
        [farmerId, expertId]
      );

      res.json({
        success: true,
        messages: result.rows,
      });

    } catch (error) {
      console.error(
        "Chat history error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Failed to fetch chat history",
      });
    }
  }
);
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});