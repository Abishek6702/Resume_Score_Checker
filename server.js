import express from "express";
import multer from "multer";
import pdfParse from "pdf-parse-fixed";
import mammoth from "mammoth";
import fs from "fs";
import dotenv from "dotenv";
import cors from "cors";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// =======================
// ENV CHECK
// =======================
if (!process.env.GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY missing in .env");
  process.exit(1);
}
console.log("✅ Gemini API key loaded");

// =======================
// GEMINI CLIENT (NEW SDK)
// =======================
const genAI = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

// =======================
// MULTER SETUP
// =======================
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ];
    cb(null, allowed.includes(file.mimetype));
  }
});

// =======================
// TEXT EXTRACTION
// =======================
async function extractText(filePath, mimeType) {
  if (mimeType === "application/pdf") {
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    return data.text;
  }

  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }

  throw new Error("Unsupported file type");
}

// =======================
// GEMINI ANALYSIS
// =======================
async function analyzeResume(resumeText, jobTitle) {
  const prompt = `
You are an advanced AI-powered Applicant Tracking System (ATS) evaluator.

Analyze the following resume against the job title "${jobTitle}".

Respond ONLY with valid JSON. No markdown. No explanations.

JSON FORMAT:
{
  "atsScore": number,
  "roleDetected": "string",
  "skills": {
    "matched": ["skill1"],
    "missing": ["skill2"]
  },
  "analysis": {
    "summary": "string",
    "skillsSection": "string",
    "experience": "string",
    "projects": "string",
    "education": "string",
    "formatting": "string",
    "keywords": "string"
  },
  "suggestions": ["string"]
}

Resume Text:
${resumeText}
`;

  const result = await genAI.models.generateContent({
  model: "gemini-2.5-flash",
  contents: [
    {
      role: "user",
      parts: [{ text: prompt }]
    }
  ]
});

return result.text;

}

// =======================
// SAFE JSON PARSE
// =======================
function safeParseJSON(text) {
  return JSON.parse(text.trim().replace(/^\uFEFF/, ""));
}

// =======================
// API ROUTE
// =======================
app.post("/check-resume", upload.single("resume"), async (req, res) => {
  let filePath;

  try {
    const { jobTitle } = req.body;

    if (!jobTitle) {
      return res.status(400).json({ error: "Job title required" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "Resume file required" });
    }

    filePath = req.file.path;

    const resumeText = await extractText(
      filePath,
      req.file.mimetype
    );

    const MAX_CHARS = 12000;
    const safeText = resumeText.slice(0, MAX_CHARS);

    let analysis = await analyzeResume(safeText, jobTitle);

    analysis = analysis
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const parsed = safeParseJSON(analysis);

    res.json(parsed);

  } catch (err) {
    console.error("❌ Resume analysis failed:", err);
    res.status(500).json({ error: "Resume analysis failed" });

  } finally {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
});

// =======================
// START SERVER
// =======================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});



