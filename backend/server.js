const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { AssemblyAI } = require("assemblyai");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();

app.use(cors());
app.use(express.json());

const assemblyClient = new AssemblyAI({
  apiKey: process.env.ASSEMBLYAI_API_KEY || "c365a3cefbee47d2a8f1ea25ed797d35",
});

const genAI = new GoogleGenerativeAI(
  process.env.GEMINI_API_KEY || "AIzaSyAG08T5-jfcrWSIprRxOp1f-tTlY_ocAeo"
);

const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024,
  }
});

const vehicleKeywords = [
  "brake pedal", "brake pads", "brake discs", "brake fluid", "brake lines",
  "brake noise", "brake vibration", "brake failure", "brake warning",
  "engine overheating", "engine noise", "engine failure", "engine stalling",
  "engine misfire", "engine vibration", "engine smoking", "engine knocking",
  "motor starter", "motor mount",
  "battery dead", "battery drain", "alternator failure", "starter motor",
  "electrical short", "fuse blown", "wiring issue", "light failure",
  "flat tire", "tire pressure", "tire wear", "wheel alignment", "wheel bearing",
  "rim damage", "tire vibration",
  "suspension noise", "suspension failure", "shock absorbers", "strut failure", 
  "spring broken", "control arm", "ball joint", "bushing worn",
  "steering wheel", "power steering", "steering vibration", "alignment issue",
  "car pulling", "uneven ride", "body roll",
  "transmission slipping", "gear shifting", "clutch problem", "transmission fluid",
  "gear noise", "shifting difficulty",
  "coolant leak", "overheating issue", "radiator problem", "thermostat failure",
  "water pump", "cooling fan",
  "exhaust leak", "muffler problem", "catalytic converter", "exhaust noise",
  "fuel pump", "fuel injector", "fuel filter", "fuel leak",
  "side mirror", "windshield crack", "door lock", "window regulator",
  "seat belt", "air conditioning", "heater problem",
  "oil leak", "power loss", "check engine", "warning light", "emission problem"
];

function advancedKeywordSearch(text) {
  const lowerText = text.toLowerCase();
  const foundKeywords = [];
  const keywordCategories = {};
  
  vehicleKeywords.forEach(keyword => {
    const lowerKeyword = keyword.toLowerCase();
    const wordRegex = new RegExp(`\\b${lowerKeyword}\\b`, 'gi');
    const exactMatches = lowerText.match(wordRegex);
    const partialMatch = lowerText.includes(lowerKeyword);
    
    if ((exactMatches && exactMatches.length > 0) || partialMatch) {
      foundKeywords.push(keyword);
      
      if (lowerKeyword.includes('brake')) {
        keywordCategories.brake = true;
      }
      if (lowerKeyword.includes('tire') || lowerKeyword.includes('wheel')) {
        keywordCategories.tire = true;
      }
      if (lowerKeyword.includes('engine') || lowerKeyword.includes('motor')) {
        keywordCategories.engine = true;
      }
      if (lowerKeyword.includes('electrical') || lowerKeyword.includes('battery') || lowerKeyword.includes('light')) {
        keywordCategories.electrical = true;
      }
      if (lowerKeyword.includes('transmission') || lowerKeyword.includes('gear') || lowerKeyword.includes('clutch')) {
        keywordCategories.transmission = true;
      }
    }
  });
  
  return {
    foundKeywords: [...new Set(foundKeywords)],
    categories: Object.keys(keywordCategories),
    totalMatches: foundKeywords.length
  };
}

function parseGeminiResponse(responseText) {
  try {
    let cleanText = responseText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    
    try {
      return JSON.parse(cleanText);
    } catch (directError) {
      const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON object found in response");
      }
    }
  } catch (error) {
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

    const analysis = parseGeminiResponse(responseText);

    return {
      success: true,
      ...analysis,
    };
  } catch (error) {
    throw new Error(`AI analysis failed: ${error.message}`);
  }
}

// Updated transcribeAudio function to handle both file paths and buffers
async function transcribeAudio(audioBuffer, originalName = 'audio.webm') {
  try {
    // Create a temporary file in /tmp directory
    const tempFilePath = `/tmp/${Date.now()}-${originalName}`;
    fs.writeFileSync(tempFilePath, audioBuffer);

    try {
      const audioUrl = await assemblyClient.files.upload(tempFilePath);
      const transcript = await assemblyClient.transcripts.transcribe({
        audio: audioUrl,
      });

      return {
        success: true,
        text: transcript.text,
        language: transcript.language_code,
      };
    } finally {
      // Clean up temporary file
      try {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      } catch (cleanupError) {
        console.error("Cleanup error:", cleanupError.message);
      }
    }
  } catch (error) {
    console.error("AssemblyAI error:", error.message);
    return { success: false, error: error.message };
  }
}

// Test endpoint
app.post("/test", upload.single("recording"), (req, res) => {
  res.json({ 
    success: true, 
    message: "File received successfully",
    fileSize: req.file?.size,
    fileName: req.file?.originalname,
    fileType: req.file?.mimetype
  });
});

// Main processing endpoint
app.post("/process-recording", upload.single("recording"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No recording received" });
    }

    console.log("Processing recording... File size:", req.file.size, "Type:", req.file.mimetype);

    try {
      // Step 1: Transcribe with AssemblyAI using the buffer directly
      console.log("Starting transcription...");
      const transcription = await transcribeAudio(req.file.buffer, req.file.originalname);

      if (!transcription.success) {
        throw new Error(`Transcription failed: ${transcription.error}`);
      }

      console.log("Transcription successful, length:", transcription.text?.length || 0);

      // If transcription is empty, throw error
      if (!transcription.text || transcription.text.trim().length === 0) {
        throw new Error("No speech detected in the audio. Please ensure there is clear audio in the video.");
      }

      // Step 2: Search for keywords
      const keywordResults = advancedKeywordSearch(transcription.text);
      console.log("Keyword search found:", keywordResults.totalMatches, "matches");

      // Step 3: Analyze with Gemini
      console.log("Starting AI analysis...");
      const analysis = await analyzeWithGemini(transcription.text);
      console.log("AI analysis completed");

      const response = {
        success: true,
        message: "Video Analysis Completed!",
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
          keywordSearch: {
            foundKeywords: keywordResults.foundKeywords,
            categories: keywordResults.categories,
            totalKeywordsFound: keywordResults.totalMatches,
            keywordMatch: keywordResults.totalMatches > 0,
            totalMatches: keywordResults.totalMatches
          }
        },
      };

      res.json(response);

    } catch (processingError) {
      console.error("Processing error:", processingError);
      res.status(500).json({ 
        error: "Processing failed",
        message: processingError.message 
      });
    }

  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({ 
      error: "Server error",
      message: error.message 
    });
  }
});

// Health check endpoint
app.get("/", (req, res) => {
  res.json({
    message: "Vehicle Problem Detector - Live Recording & File Upload",
    status: "Ready for video analysis",
    features: ["Live recording", "File upload", "Keyword search", "AI analysis"],
    totalKeywords: vehicleKeywords.length,
    environment: process.env.NODE_ENV || 'development',
    maxFileSize: "100MB",
    supportedFormats: "All video formats with audio"
  });
});

// For Vercel serverless compatibility
module.exports = app;

// Only start server if not in Vercel environment
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Vehicle Problem Detector running on port ${PORT}`);
    console.log(`Total keywords loaded: ${vehicleKeywords.length}`);
  });
}