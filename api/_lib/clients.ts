import { GoogleGenAI } from "@google/genai";

// Service-key client: server only, bypasses RLS.
export { admin } from './admin.js';
export const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
