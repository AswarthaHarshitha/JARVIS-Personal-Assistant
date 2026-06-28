const { GoogleGenerativeAI } = require('@google/generative-ai');
const dotenv = require('dotenv');
dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("Missing GEMINI_API_KEY in .env");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

async function run() {
  try {
    console.log("Listing models for API Key:", apiKey.substring(0, 10) + "...");
    
    // Check v1beta listModels
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (!response.ok) {
      const txt = await response.text();
      console.error(`HTTP Error ${response.status}: ${txt}`);
      return;
    }
    const data = await response.json();
    console.log("Available Models:", JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Error listing models:", err);
  }
}

run();
