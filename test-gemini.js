import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

// 1. Load the secret key from .env
dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;

// 2. Check if the key exists in .env
if (!apiKey) {
  console.log("❌ FAILED: GEMINI_API_KEY is missing or empty in your .env file.");
  process.exit(1);
}

console.log("🔑 Found API Key ending with: ..." + apiKey.slice(-4));
console.log("⏳ Sending a test message to Gemini...");

// 3. Connect to Gemini
const ai = new GoogleGenAI({ apiKey });

async function runTest() {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: 'Reply with exactly three words: Connection is working'
    });

    console.log("-----------------------------------------");
    console.log("✅ SUCCESS! Connected to Gemini API.");
    console.log("Gemini says:", response.text.trim());
    console.log("-----------------------------------------");
  } catch (error) {
    console.log("-----------------------------------------");
    console.log("❌ FAILED TO CONNECT. Exact error below:");
    console.log("-----------------------------------------");
    console.error(error);
  }
}

runTest();