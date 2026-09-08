const express = require("express");
const cors = require("cors");
const pool = require("./db");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    message:
      "Smart Agriculture Backend Running",
  });
});

app.get("/db-test", async (req, res) => {
  try {
    const result =
      await pool.query("SELECT NOW()");

    res.json({
      success: true,
      message:
        "PostgreSQL Connected",

      time:
        result.rows[0],
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      success: false,
      message:
        "Database connection failed",
    });
  }
});

const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// Sleep Helper
const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Gemini Diagnosis with Retry + Fallback
async function generateDiagnosis(requestData) {
  const models = [
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
  ];

  let lastError = null;
  for (const model of models) {
    const maxRetries = 2;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(
          `Gemini ${model} - attempt ${attempt}`
        );
        const response = await ai.models.generateContent({
          ...requestData,
          model,
        });
        console.log(
          `Gemini diagnosis successful with: ${model}`
        );
        return response;
      } catch (error) {
        lastError = error;
        console.error(
          `Gemini ${model} attempt ${attempt} failed:`,
          error.message
        );
        if (error.status === 429) {
          console.log(
            `${model} returned 429. Moving to fallback model...`
          );
          break;
        }
        if (error.status === 503) {
          if (attempt === maxRetries) {
            console.log(
              `${model} is still busy. Moving to fallback model...`
            );
            break;
          }
          const delay =
            1500 * Math.pow(2, attempt - 1);
          console.log(
            `Retrying ${model} in ${
              delay / 1000
            } seconds...`
          );
          await sleep(delay);
          continue;
        }
        throw error;
      }
    }
  }
  throw (
    lastError ||
    new Error("All Gemini models failed")
  );
}

// AI Crop Disease Diagnosis
app.post("/api/diagnose", async (req, res) => {
  try {
    const {
      imageUrl,
      language = "bn",
    } = req.body;

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

    console.log(
      "Optimized image URL:",
      fastImageUrl
    );

    const imageResponse = await fetch(
      fastImageUrl
    );

    if (!imageResponse.ok) {
      throw new Error(
        "Could not download image from Cloudinary"
      );
    }

    const imageBuffer = Buffer.from(
      await imageResponse.arrayBuffer()
    );

    const mimeType = imageResponse.headers.get("content-type") || "image/jpeg";

    const base64Image =
      imageBuffer.toString("base64");

    const responseLanguage =
      language === "bn"
        ? "Bengali (Bangla)"
        : "English";

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
          description:
            "Most likely crop disease or condition",
        },
        scientificName: {
          type: "string",
          description:
            "Scientific name of the disease or pathogen",
        },
        confidence: {
          type: "number",
          description:
            "Confidence score from 0 to 100",
        },
        symptoms: {
          type: "array",
          items: {
            type: "string",
          },
          description:
            "Visible symptoms detected in the image",
        },
        organicTreatment: {
          type: "array",
          items: {
            type: "string",
          },
          description:
            "Recommended organic treatment methods",
        },
        chemicalTreatment: {
          type: "array",
          items: {
            type: "string",
          },
          description:
            "Recommended chemical treatment methods",
        },
        prevention: {
          type: "array",
          items: {
            type: "string",
          },
          description:
            "Disease prevention recommendations",
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
            {
              text: prompt,
            },
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

    const diagnosis =
      JSON.parse(response.text);

    console.log(
      "AI Diagnosis:",
      diagnosis
    );

    return res.json({
      success: true,
      result: diagnosis,
    });

  } catch (error) {
    console.error(
      "Gemini Diagnosis Error:",
      error
    );
  
    if (error.status === 429) {
      return res.status(429).json({
        success: false,
        message:
          "AI diagnosis limit has been reached. Please try again later.",
      });
    }
    if (error.status === 503) {
      return res.status(503).json({
        success: false,

        message:
          "AI service is temporarily busy. Please try again in a moment.",
      });
    }
    return res.status(500).json({
      success: false,
      message:
        "Diagnosis failed",

      error:
        error.message,
    });
  }
});

// Weather API
app.get("/api/weather", async (req, res) => {
  try {
    const city = req.query.city || "Dhaka";
    const language = req.query.lang === "bn" ? "bn" : "en";

    const url = new URL(
      "https://api.weatherapi.com/v1/forecast.json"
    );

    url.searchParams.set(
      "key",
      process.env.WEATHER_API_KEY
    );
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
        message:
          data?.error?.message ||
          "Failed to fetch weather data",
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
const {Server} = require("socket.io");
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);
  socket.on("disconnect", () => {
    console.log("A user disconnected:", socket.id);
  });
});
const PORT =
  process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(
    `Server running on port ${PORT}`
  );
});