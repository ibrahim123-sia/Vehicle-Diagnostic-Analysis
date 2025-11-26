const express = require("express");
const cors = require("cors");
const multer = require("multer");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
const { AssemblyAI } = require("assemblyai");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();

app.use(cors());
app.use(express.json());

// Initialize APIs
const assemblyClient = new AssemblyAI({
  apiKey: process.env.ASSEMBLYAI_API_KEY || "c365a3cefbee47d2a8f1ea25ed797d35",
});

const genAI = new GoogleGenerativeAI(
  process.env.GEMINI_API_KEY || "AIzaSyAG08T5-jfcrWSIprRxOp1f-tTlY_ocAeo"
);

// File upload for recordings only
const upload = multer({
  dest: "uploads/",
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit for recordings
  }
});

// Create folders
["uploads", "output", "recordings"].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Keywords database for vehicle problems
const vehicleKeywords = [
  "brake problem", "brake issues", "braking system", "brake pads", "brake discs",
  "tire problem", "flat tire", "tire pressure", "wheel alignment", "tire wear",
  "engine problem", "engine noise", "overheating", "engine failure", "check engine",
  "transmission problem", "gear issues", "clutch problem", "shifting problem",
  "electrical problem", "battery issue", "alternator", "starter motor", "wiring",
  "suspension problem", "shocks", "struts", "alignment issue", "steering problem",
  "oil problem", "oil leak", "oil pressure", "engine oil", "lubrication",
  "cooling system", "radiator", "thermostat", "coolant leak",
  "exhaust system", "muffler", "catalytic converter", "exhaust leak",
  "fuel system", "fuel pump", "fuel injector", "fuel filter",
  "air conditioning", "ac problem", "heating system", "blower motor",
  "brake fluid", "power steering", "alignment", "vibration", "noise"
];

// Function to search keywords in text
function searchKeywords(text) {
  const foundKeywords = [];
  const lowerText = text.toLowerCase();
  
  vehicleKeywords.forEach(keyword => {
    if (lowerText.includes(keyword.toLowerCase())) {
      foundKeywords.push(keyword);
    }
  });
  
  return foundKeywords;
}

// Transcribe with AssemblyAI
async function transcribeAudio(audioPath) {
  try {
    const audioUrl = await assemblyClient.files.upload(audioPath);
    const transcript = await assemblyClient.transcripts.transcribe({
      audio: audioUrl,
    });

    return {
      success: true,
      text: transcript.text,
      language: transcript.language_code,
    };
  } catch (error) {
    console.error("AssemblyAI error:", error.message);
    return { success: false, error: error.message };
  }
}

// Improved Gemini response parsing
function parseGeminiResponse(responseText) {
  try {
    // Remove markdown code blocks if present
    let cleanText = responseText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    
    // Try to parse directly first
    try {
      return JSON.parse(cleanText);
    } catch (directError) {
      // If direct parse fails, try to extract JSON object
      const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON object found in response");
      }
    }
  } catch (error) {
    console.error("Failed to parse Gemini response:", error.message);
    console.error("Original response:", responseText);
    throw new Error(`Failed to parse AI response: ${error.message}`);
  }
}

async function analyzeWithGemini(text) {
  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
    });

    const prompt = `
Analyze this vehicle problem description and return ONLY valid JSON without any markdown formatting:

TRANSCRIPT: "${text}"

Return JSON with this exact structure:
{
  "mainProblem": "Brief description of the main vehicle issue",
  "problemType": "brake|tire|engine|electrical|suspension|transmission|oil|other",
  "specificIssues": ["list", "of", "specific", "problems", "mentioned"],
  "severity": "low|medium|high",
  "keywords": ["relevant", "technical", "keywords", "from", "text"],
  "recommendation": "Specific repair advice from mechanic perspective"
}

Focus on vehicle mechanical issues. Return ONLY the JSON object without any additional text or markdown.
`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const responseText = response.text();

    console.log("Gemini raw response:", responseText);

    // Parse the response
    const analysis = parseGeminiResponse(responseText);

    return {
      success: true,
      ...analysis,
    };
  } catch (error) {
    console.error("AI analysis failed:", error.message);
    throw new Error(`AI analysis failed: ${error.message}`);
  }
}

// Endpoint for live recording processing
app.post("/process-recording", upload.single("recording"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No recording received" });
    }

    const inputVideo = req.file.path;
    const outputFileName = `recording-${Date.now()}.mp3`;
    const outputAudio = path.join("output", outputFileName);

    console.log("Processing live recording...");

    ffmpeg(inputVideo)
      .output(outputAudio)
      .audioCodec("libmp3lame")
      .on("start", () => {
        console.log("Converting video to audio...");
      })
      .on("end", async () => {
        try {
          console.log("Conversion complete, starting transcription...");

          // Step 1: Transcribe with AssemblyAI
          const transcription = await transcribeAudio(outputAudio);

          if (!transcription.success) {
            throw new Error(`Transcription failed: ${transcription.error}`);
          }

          console.log("Transcription complete, searching keywords...");

          // Step 2: Search for keywords
          const foundKeywords = searchKeywords(transcription.text);

          console.log("Keyword search complete, starting AI analysis...");

          // Step 3: Analyze with Gemini
          const analysis = await analyzeWithGemini(transcription.text);

          console.log("AI analysis complete");

          // Response
          const response = {
            success: true,
            message: "Live Recording Analysis Completed!",
            downloadUrl: `/download/${outputFileName}`,
            analysis: {
              transcription: transcription.text,
              mainProblem: analysis.mainProblem,
              problemType: analysis.problemType,
              specificIssues: analysis.specificIssues,
              severity: analysis.severity,
              keywords: analysis.keywords,
              recommendation: analysis.recommendation,
              word_count: transcription.text.split(/\s+/).length,
              problem_count: analysis.specificIssues.length,
              aiModel: "gemini-2.0-flash",
              // Add keyword search results
              keywordSearch: {
                foundKeywords: foundKeywords,
                totalKeywordsFound: foundKeywords.length,
                keywordMatch: foundKeywords.length > 0
              }
            },
          };

          res.json(response);
        } catch (error) {
          console.error("Recording analysis error:", error.message);
          res.status(500).json({
            success: false,
            message: "Recording Analysis Failed",
            error: error.message,
          });
        }

        // Clean up input file
        setTimeout(() => {
          fs.unlink(inputVideo, () => {
            console.log("Cleaned up temporary files");
          });
        }, 5000);
      })
      .on("error", (err) => {
        console.error("Conversion error:", err);
        res.status(500).json({ error: "Conversion failed" });
      })
      .run();
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Download endpoint
app.get("/download/:filename", (req, res) => {
  const filePath = path.join("output", req.params.filename);
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).json({ error: "File not found" });
  }
});

// Health check endpoint
app.get("/", (req, res) => {
  res.json({
    message: "Vehicle Problem Detector - Live Recording Only",
    status: "Ready for live video recording analysis",
    features: ["Live recording", "Keyword search", "AI analysis"]
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Vehicle Problem Detector running on port ${PORT}`);
  console.log(`Mobile-friendly live recording interface ready`);
});