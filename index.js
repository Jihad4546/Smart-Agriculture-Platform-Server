const express = require("express");
const cors = require("cors");
const pool = require("./db");
require("dotenv").config();

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

// Gemini API Diagnose Route
app.post("/api/diagnose", async (req, res) => {
  try {
    const { imageUrl, language = "bn" } = req.body;
    if (!imageUrl) {
      return res.status(400).json({
        success: false,
        message: "Image URL is required",
      });
    }
    // Gemini SDK
    const { GoogleGenAI } = await import("@google/genai");

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });
    // Cloudinary image download
const imageResponse = await fetch(imageUrl);

if (!imageResponse.ok) {
  throw new Error("Could not download image from Cloudinary");
}
const imageBuffer = Buffer.from(
  await imageResponse.arrayBuffer()
);
// Image MIME type
const mimeType =
  imageResponse.headers.get("content-type") || "image/jpeg";

// Convert image to Base64
const base64Image = imageBuffer.toString("base64");
    // 2. JSON Schema
    const responseSchema = {
      type: "object",

      properties: {
        disease: {
          type: "string",
          description: "Most likely crop disease name",
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
          items: {
            type: "string",
          },
          description: "Visible symptoms detected in the image",
        },

        organicTreatment: {
          type: "array",
          items: {
            type: "string",
          },
          description: "Recommended organic treatment methods",
        },

        chemicalTreatment: {
          type: "array",
          items: {
            type: "string",
          },
          description: "Recommended chemical treatment methods",
        },

        prevention: {
          type: "array",
          items: {
            type: "string",
          },
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
    // 3. Prompt
const responseLanguage =
  language === "bn"
    ? "Bengali (Bangla)"
    : "English";

const prompt = `
You are an expert agricultural plant pathologist.
Analyze the provided crop leaf image carefully.
Identify the most likely disease affecting the plant.
Important instructions:
1. Identify the crop if possible.
2. Identify the most likely disease or condition.
3. If the plant appears healthy, clearly indicate that it is healthy.
4. Do not invent symptoms that are not visible or reasonably inferable.
5. Give a confidence score between 0 and 100.
6. Provide practical treatment recommendations.
7. Provide organic treatment options.
8. Provide chemical treatment options when appropriate.
9. Provide prevention recommendations.
10. Return ONLY the JSON structure.
11. Do not use Markdown.
12. Do not add explanations outside the JSON.
13. Every human-readable value inside the JSON MUST be written in ${responseLanguage}.
The response language is ${responseLanguage}.
Return the result according to the provided JSON schema.
`;
    // 4. Gemini Multimodal Request
    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
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
      // 5. Structured JSON Response
      config: {
        responseMimeType: "application/json",
        responseSchema,
      },
    });
    // 6. Convert AI JSON string → JS object
    const diagnosis = JSON.parse(response.text);
    console.log("AI Diagnosis:", diagnosis);
    // 7. Send result to frontend
    res.json({
      success: true,
      result: diagnosis,
    });
  } catch (error) {
    console.error("Gemini Diagnosis Error:", error);
    res.status(500).json({
      success: false,
      message: "Diagnosis failed",
      error: error.message,
    });
  }
});
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});