const fetch = require('node-fetch'); // or use global fetch
const dotenv = require('dotenv');
dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("Missing GEMINI_API_KEY");
  process.exit(1);
}

async function run() {
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const data = await response.json();
    
    if (data.models) {
      console.log("=== GEMINI MODELS AVAILABLE FOR THIS API KEY ===");
      data.models.forEach(m => {
        if (m.name.includes('gemini')) {
          console.log(`- ${m.name} (${m.displayName}) -> Supported: ${m.supportedGenerationMethods.join(', ')}`);
        }
      });
    } else {
      console.log("No models returned:", data);
    }
  } catch (err) {
    console.error("Failed to query models:", err);
  }
}

run();
