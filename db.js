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

    CREATE TABLE IF NOT EXISTS conversations (
    id SERIAL PRIMARY KEY,

    farmer_id TEXT NOT NULL,
    expert_id TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_conversation_farmer
        FOREIGN KEY (farmer_id)
        REFERENCES "user"(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_conversation_expert
        FOREIGN KEY (expert_id)
        REFERENCES "user"(id)
        ON DELETE CASCADE,

    CONSTRAINT unique_farmer_expert
        UNIQUE (farmer_id, expert_id)
);
CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,

    conversation_id INTEGER NOT NULL,

    sender_id TEXT NOT NULL,

    sender_role TEXT NOT NULL
        CHECK (sender_role IN ('farmer', 'expert')),

    message TEXT NOT NULL,
     image_url TEXT,
   
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_message_conversation
        FOREIGN KEY (conversation_id)
        REFERENCES conversations(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_message_sender
        FOREIGN KEY (sender_id)
        REFERENCES "user"(id)
        ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS market_prices (
    id SERIAL PRIMARY KEY,

    commodity TEXT NOT NULL,

    min_price NUMERIC(10,2),
    max_price NUMERIC(10,2),

    collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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