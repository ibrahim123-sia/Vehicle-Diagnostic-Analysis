const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { AssemblyAI } = require("assemblyai");
const Groq = require("groq-sdk");
const dotenv = require("dotenv");
dotenv.config();
const app = express();

app.use(cors());
app.use(express.json());

// Use environment variables directly (no fallbacks)
const assemblyClient = new AssemblyAI({
  apiKey: process.env.ASSEMBLYAI_API_KEY,
});

// Initialize Groq with environment variable
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

// Configure multer for chunk uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per chunk
  }
});

// Directory to store chunks temporarily
const CHUNKS_DIR = '/tmp/chunks';
if (!fs.existsSync(CHUNKS_DIR)) {
  fs.mkdirSync(CHUNKS_DIR, { recursive: true });
}

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
  "oil leak", "power loss", "check engine", "warning light", "emission problem","suspension problem","suspension issue"
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

function parseGroqResponse(responseText) {
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

async function analyzeWithGroq(text) {
  try {
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

    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are an expert automotive technician. Analyze vehicle problem descriptions and provide structured JSON responses with diagnosis and recommendations."
        },
        {
          role: "user",
          content: prompt
        }
      ],
       model: "llama-3.3-70b-versatile", 
  temperature: 0.1,
      max_tokens: 1024,
      response_format: { type: "json_object" }
    });

    const responseText = chatCompletion.choices[0]?.message?.content || "";
    
    if (!responseText) {
      throw new Error("Empty response from Groq API");
    }

    const analysis = parseGroqResponse(responseText);

    return {
      success: true,
      ...analysis,
    };
  } catch (error) {
    console.error("Groq API error:", error.message);
    throw new Error(`AI analysis failed: ${error.message}`);
  }
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
    console.error("AssemblyAI error:", error.message);
    return { success: false, error: error.message };
  }
}

function cleanupOldChunks() {
  try {
    const files = fs.readdirSync(CHUNKS_DIR);
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);
    
    files.forEach(file => {
      if (file.startsWith('chunk_')) {
        const filePath = path.join(CHUNKS_DIR, file);
        const stats = fs.statSync(filePath);
        if (stats.mtimeMs < oneHourAgo) {
          fs.unlinkSync(filePath);
          console.log(`Cleaned up old chunk: ${file}`);
        }
      }
    });
  } catch (error) {
    console.error("Cleanup error:", error.message);
  }
}

app.post("/upload-chunk", upload.single("chunk"), async (req, res) => {
  try {
    const { chunkIndex, totalChunks, uploadId, fileName, fileType, fileSize } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: "No chunk received" 
      });
    }

    if (!chunkIndex || !totalChunks || !uploadId) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing required parameters" 
      });
    }

    console.log(`Received chunk ${chunkIndex}/${totalChunks} for upload ${uploadId}`);

    const chunkFileName = `chunk_${uploadId}_${chunkIndex}.tmp`;
    const chunkPath = path.join(CHUNKS_DIR, chunkFileName);
    
    fs.writeFileSync(chunkPath, req.file.buffer);

    res.json({
      success: true,
      message: `Chunk ${chunkIndex} uploaded successfully`,
      chunkIndex: parseInt(chunkIndex),
      totalChunks: parseInt(totalChunks),
      uploadId
    });

  } catch (error) {
    console.error("Chunk upload error:", error);
    res.status(500).json({ 
      success: false, 
      error: "Chunk upload failed",
      message: error.message 
    });
  }
});

app.post("/merge-chunks", async (req, res) => {
  try {
    const { uploadId, fileName, totalChunks, fileType, fileSize } = req.body;

    if (!uploadId || !fileName || !totalChunks) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing required parameters" 
      });
    }

    console.log(`Merging ${totalChunks} chunks for upload ${uploadId}`);

    const chunks = [];
    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = path.join(CHUNKS_DIR, `chunk_${uploadId}_${i}.tmp`);
      if (!fs.existsSync(chunkPath)) {
        return res.status(400).json({ 
          success: false, 
          error: `Missing chunk ${i}` 
        });
      }
      chunks.push(chunkPath);
    }

    const mergedFileName = `merged_${uploadId}_${fileName}`;
    const mergedFilePath = path.join(CHUNKS_DIR, mergedFileName);
    
    const writeStream = fs.createWriteStream(mergedFilePath);
    
    for (let i = 0; i < chunks.length; i++) {
      const chunkData = fs.readFileSync(chunks[i]);
      writeStream.write(chunkData);
      fs.unlinkSync(chunks[i]);
    }
    
    writeStream.end();

    writeStream.on('finish', () => {
      console.log(`Merged file created: ${mergedFilePath}, size: ${fs.statSync(mergedFilePath).size} bytes`);
      
      res.json({
        success: true,
        message: "Chunks merged successfully",
        filePath: mergedFilePath,
        fileName: mergedFileName,
        fileSize: fs.statSync(mergedFilePath).size
      });
    });

    writeStream.on('error', (error) => {
      throw error;
    });

  } catch (error) {
    console.error("Merge chunks error:", error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to merge chunks",
      message: error.message 
    });
  }
});

app.post("/cancel-upload", async (req, res) => {
  try {
    const { uploadId } = req.body;

    if (!uploadId) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing uploadId" 
      });
    }

    console.log(`Cancelling upload: ${uploadId}`);

    const files = fs.readdirSync(CHUNKS_DIR);
    files.forEach(file => {
      if (file.includes(uploadId)) {
        const filePath = path.join(CHUNKS_DIR, file);
        fs.unlinkSync(filePath);
        console.log(`Deleted chunk: ${file}`);
      }
    });

    res.json({
      success: true,
      message: "Upload cancelled and chunks cleaned up"
    });

  } catch (error) {
    console.error("Cancel upload error:", error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to cancel upload",
      message: error.message 
    });
  }
});

app.post("/process-recording", async (req, res) => {
  try {
    const { filePath, fileName, fileSize, fileType } = req.body;

    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(400).json({ 
        error: "No valid file path provided" 
      });
    }

    console.log("Processing recording from file path:", filePath);
    console.log("File size:", fileSize);

    try {
      console.log("Starting transcription...");
      const transcription = await transcribeAudio(filePath);

      if (!transcription.success) {
        throw new Error(`Transcription failed: ${transcription.error}`);
      }

      console.log("Transcription successful, length:", transcription.text.length);

      const keywordResults = advancedKeywordSearch(transcription.text);
      console.log("Keyword search found:", keywordResults.totalMatches, "matches");

      console.log("Starting AI analysis...");
      const analysis = await analyzeWithGroq(transcription.text);
      console.log("AI analysis completed");

      const response = {
        success: true,
        message: "Live Recording Analysis Completed!",
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
          aiModel: "mixtral-8x7b-32768",
          keywordSearch: {
            foundKeywords: keywordResults.foundKeywords,
            categories: keywordResults.categories,
            totalKeywordsFound: keywordResults.totalMatches,
            keywordMatch: keywordResults.totalMatches > 0,
            totalMatches: keywordResults.totalMatches
          }
        },
      };

      try {
        fs.unlinkSync(filePath);
        console.log("Cleaned up merged file:", filePath);
      } catch (cleanupError) {
        console.error("File cleanup error:", cleanupError.message);
      }

      res.json(response);
    } catch (processingError) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (cleanupError) {
        console.error("File cleanup error:", cleanupError.message);
      }
      throw processingError;
    }

  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({ 
      error: "Server error",
      message: error.message 
    });
  }
});

app.post("/process-recording-legacy", upload.single("recording"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No recording received" });
    }

    console.log("Processing recording... File size:", req.file.size);

    const tempDir = '/tmp';
    const tempFilePath = path.join(tempDir, `audio-${Date.now()}.webm`);
    fs.writeFileSync(tempFilePath, req.file.buffer);

    try {
      console.log("Starting transcription...");
      const transcription = await transcribeAudio(tempFilePath);

      if (!transcription.success) {
        throw new Error(`Transcription failed: ${transcription.error}`);
      }

      console.log("Transcription successful, length:", transcription.text.length);

      const keywordResults = advancedKeywordSearch(transcription.text);
      console.log("Keyword search found:", keywordResults.totalMatches, "matches");

      console.log("Starting AI analysis...");
      const analysis = await analyzeWithGroq(transcription.text);
      console.log("AI analysis completed");

      const response = {
        success: true,
        message: "Live Recording Analysis Completed!",
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
          aiModel: "mixtral-8x7b-32768",
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
    } finally {
      try {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      } catch (cleanupError) {
        console.error("Cleanup error:", cleanupError.message);
      }
    }

  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({ 
      error: "Server error",
      message: error.message 
    });
  }
});

app.get("/", (req, res) => {
  cleanupOldChunks();
  
  res.json({
    message: "Vehicle Problem Detector - Chunked Upload Enabled",
    status: "Ready for large video uploads",
    features: ["Chunked upload", "Live recording", "Keyword search", "AI analysis (Groq)"],
    totalKeywords: vehicleKeywords.length,
    environment: process.env.NODE_ENV || 'development',
    chunkUpload: true,
    apiKeysConfigured: {
      assemblyAI: !!process.env.ASSEMBLYAI_API_KEY,
      groq: !!process.env.GROQ_API_KEY
    }
  });
});

app.post("/cleanup", (req, res) => {
  cleanupOldChunks();
  res.json({ success: true, message: "Cleanup completed" });
});

module.exports = app;

if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Vehicle Problem Detector running on port ${PORT}`);
    console.log(`Total keywords loaded: ${vehicleKeywords.length}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Chunk upload directory: ${CHUNKS_DIR}`);
    console.log(`AI Provider: Groq`);
    console.log(`AI Model: mixtral-8x7b-32768`);
  });
}