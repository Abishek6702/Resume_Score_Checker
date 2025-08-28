import express from "express";
import multer from "multer";
import pdfParse from "pdf-parse-fixed";
import mammoth from "mammoth";
import fs from "fs";
import dotenv from "dotenv";
import cors from "cors";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ✅ API key check
if (!process.env.GEMINI_API_KEY) {
  console.error("❌ Gemini API key is missing. Add it in .env file as GEMINI_API_KEY=your_key_here");
  process.exit(1);
} else {
  console.log("✅ Gemini API key loaded.");
}

// Setup Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // more accurate than flash

// Multer setup for file upload
const upload = multer({ dest: "uploads/" });

// 🔹 Extract text from PDF/DOCX
async function extractText(filePath, mimeType) {
  console.log(`📄 Extracting text from: ${filePath} (${mimeType})`);
  if (mimeType === "application/pdf") {
    const dataBuffer = fs.readFileSync(filePath);
    const pdfData = await pdfParse(dataBuffer);
    return pdfData.text;
  } else if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  } else {
    throw new Error("Unsupported file type. Upload PDF or DOCX.");
  }
}

// 🔹 Analyze Resume with Gemini
async function analyzeResume(resumeText, jobTitle) {
  const prompt = `
  You are an advanced AI-powered Applicant Tracking System (ATS) evaluator.  
  Analyze the following resume text against the job title "${jobTitle}".  

  ✅ Respond only with valid JSON (no markdown, no explanations).  

  ### Scoring Rules:
  - atsScore: Integer 0–100  
    * Skills Match (40%)  
    * Experience Relevance (30%)  
    * Formatting & Clarity (10%)  
    * Keywords/ATS optimization (20%)  

  ### Output JSON format:
  {
    "atsScore": number,
    "roleDetected": "string",
    "skills": {
      "matched": ["skill1", "skill2"],
      "missing": ["skill3", "skill4"]
    },
    "analysis": {
      "summary": "feedback on resume summary",
      "skillsSection": "feedback on skills section",
      "experience": "feedback on work experience",
      "projects": "feedback on projects section",
      "education": "feedback on education section",
      "formatting": "feedback on structure, readability, ATS-friendliness",
      "keywords": "feedback on keyword density and missing keywords"
    },
    "suggestions": [
      "specific actionable suggestion 1",
      "specific actionable suggestion 2",
      "specific actionable suggestion 3"
    ]
  }

  Resume Text:
  ${resumeText}
  `;

  try {
    console.log("🤖 Sending request to Gemini...");
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    console.log("✅ Gemini raw response received.");
    return text;
  } catch (error) {
    console.error("❌ Gemini API call failed:", error.message);
    throw new Error("Gemini API request failed. Check network/API key/model.");
  }
}

// 🔹 Safe JSON parser
function safeParseJSON(str) {
  try {
    return JSON.parse(str);
  } catch (err) {
    console.error("❌ JSON parsing failed. Raw AI response:\n", str);
    throw new Error("Failed to parse AI response as JSON.");
  }
}

// 🔹 API Endpoint
app.post("/check-resume", upload.single("resume"), async (req, res) => {
  try {
    console.log("📩 New /check-resume request received.");
    const jobTitle = req.body.jobTitle;
    if (!jobTitle) {
      console.warn("⚠️ Job title missing in request.");
      return res.status(400).json({ error: "Job title required" });
    }

    const filePath = req.file.path;
    const mimeType = req.file.mimetype;

    // Extract text from resume
    const resumeText = await extractText(filePath, mimeType);
    console.log("📄 Resume text extracted. Length:", resumeText.length);

    // Analyze resume with Gemini
    let analysis = await analyzeResume(resumeText, jobTitle);

    // 🧹 Clean Gemini output
    analysis = analysis
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    console.log("🧹 Cleaned AI response:", analysis);

    // Parse JSON safely
    const parsed = safeParseJSON(analysis);

    // Clean up uploaded file
    fs.unlinkSync(filePath);
    console.log("🗑️ Temporary file deleted:", filePath);

    res.json(parsed);
  } catch (err) {
    console.error("❌ Error in /check-resume:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
