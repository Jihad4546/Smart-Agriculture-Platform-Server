const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});
const initDb = async () => {
  const queryText = `
    CREATE TABLE IF NOT EXISTS crop_diagnoses (
        id SERIAL PRIMARY KEY,
        image_url TEXT NOT NULL,
        language VARCHAR(10) DEFAULT 'bn',
        disease VARCHAR(255) NOT NULL,
        scientific_name VARCHAR(255),
        confidence NUMERIC(5,2),
        symptoms JSONB,
        organic_treatment JSONB,
        chemical_treatment JSONB,
        prevention JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS soil_analyses (
        id SERIAL PRIMARY KEY,
        image_url TEXT NOT NULL,
        language VARCHAR(10) DEFAULT 'bn',
        soil_type VARCHAR(255) NOT NULL,
        confidence NUMERIC(5,2),
        estimated_ph VARCHAR(50),
        moisture_level VARCHAR(50),
        organic_matter_content VARCHAR(50),
        suitable_crops JSONB,
        soil_improvements JSONB,
        characteristics JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;

  try {
    await pool.query(queryText);
    console.log("Database tables verified/created successfully.");
  } catch (err) {
    console.error("Error creating tables:", err);
  }
};
initDb();
module.exports = pool;