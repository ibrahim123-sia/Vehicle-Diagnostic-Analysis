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

function ensureDirectories() {
  if (process.env.NODE_ENV === 'production') {
    const tmpDirs = ['/tmp/uploads', '/tmp/output', '/tmp/recordings'];
    tmpDirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
    return '/tmp';
  } else {
    const localDirs = ["uploads", "output", "recordings"];
    localDirs.forEach((dir) => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
    return '.';
  }
}

const baseDir = ensureDirectories();

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

function getTempFilePath(filename) {
  return path.join(baseDir, 'uploads', filename);
}

function getOutputFilePath(filename) {
  return path.join(baseDir, 'output', filename);
}

function saveBufferToTempFile(buffer, filename) {
  const tempPath = getTempFilePath(filename);
  fs.writeFileSync(tempPath, buffer);
  return tempPath;
}

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
    return { success: false, error: error.message };
  }
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

app.post("/process-recording", upload.single("recording"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No recording received" });
    }

    const inputFileName = `input-${Date.now()}.webm`;
    const inputVideo = saveBufferToTempFile(req.file.buffer, inputFileName);
    const outputFileName = `recording-${Date.now()}.mp3`;
    const outputAudio = getOutputFilePath(outputFileName);

    ffmpeg(inputVideo)
      .output(outputAudio)
      .audioCodec("libmp3lame")
      .on("end", async () => {
        try {
          const transcription = await transcribeAudio(outputAudio);

          if (!transcription.success) {
            throw new Error(`Transcription failed: ${transcription.error}`);
          }

          const keywordResults = advancedKeywordSearch(transcription.text);
          const analysis = await analyzeWithGemini(transcription.text);

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
        } catch (error) {
          res.status(500).json({
            success: false,
            message: "Recording Analysis Failed",
            error: error.message,
          });
        }

        setTimeout(() => {
          try {
            if (fs.existsSync(inputVideo)) {
              fs.unlinkSync(inputVideo);
            }
            if (fs.existsSync(outputAudio)) {
              fs.unlinkSync(outputAudio);
            }
          } catch (cleanupError) {}
        }, 5000);
      })
      .on("error", (err) => {
        try {
          if (fs.existsSync(inputVideo)) {
            fs.unlinkSync(inputVideo);
          }
        } catch (cleanupError) {}
        res.status(500).json({ error: "Conversion failed" });
      })
      .run();
  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/download/:filename", (req, res) => {
  const filePath = getOutputFilePath(req.params.filename);
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).json({ error: "File not found" });
  }
});

app.get("/", (req, res) => {
  res.json({
    message: "Vehicle Problem Detector - Live Recording Only",
    status: "Ready for live video recording analysis",
    features: ["Live recording", "Keyword search", "AI analysis"],
    totalKeywords: vehicleKeywords.length,
    environment: process.env.NODE_ENV || 'development'
  });
});

module.exports = app;

if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Vehicle Problem Detector running on port ${PORT}`);
  });
}