const express = require("express");
const cors = require("cors");
const multer = require("multer");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require('ffmpeg-static');
const fs = require("fs");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();

app.use(cors());
app.use(express.json());

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024,
  }
});

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "AIzaSyAG08T5-jfcrWSIprRxOp1f-tTlY_ocAeo");

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
  "oil leak", "power loss", "check engine", "warning light", "emission problem",
  "clicking sound", "grinding noise", "whining sound", "squeaking", "rattling",
  "vibration", "shaking", "pulling", "difficulty starting", "poor fuel economy"
];

function advancedKeywordSearch(text) {
  const lowerText = text.toLowerCase();
  const foundKeywords = [];
  const keywordCategories = {};
  
  vehicleKeywords.forEach(keyword => {
    const lowerKeyword = keyword.toLowerCase();
    const wordRegex = new RegExp(`\\b${lowerKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
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
      if (lowerKeyword.includes('electrical') || lowerKeyword.includes('battery') || lowerKeyword.includes('light') || lowerKeyword.includes('fuse')) {
        keywordCategories.electrical = true;
      }
      if (lowerKeyword.includes('transmission') || lowerKeyword.includes('gear') || lowerKeyword.includes('clutch')) {
        keywordCategories.transmission = true;
      }
      if (lowerKeyword.includes('suspension') || lowerKeyword.includes('shock') || lowerKeyword.includes('strut')) {
        keywordCategories.suspension = true;
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

async function analyzeWithGemini(transcription, fileName) {
  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
    });

    const prompt = `
Analyze this vehicle problem description from a video recording and return ONLY valid JSON without any markdown formatting:

VIDEO FILE: ${fileName}
TRANSCRIPT: "${transcription}"

Return JSON with this exact structure:
{
  "mainProblem": "Brief specific description of the main vehicle issue mentioned",
  "problemType": "brake|tire|engine|electrical|suspension|transmission|cooling|exhaust|fuel|other",
  "specificIssues": ["array", "of", "specific", "problems", "mentioned", "in", "the", "audio"],
  "severity": "low|medium|high",
  "keywords": ["relevant", "technical", "keywords", "extracted", "from", "the", "description"],
  "recommendation": "Specific repair advice from mechanic perspective based on the issues described"
}

Focus on the actual vehicle mechanical issues described in the audio. Be specific about the problems mentioned.
Return ONLY the JSON object without any additional text or markdown.
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
    console.error("Gemini analysis error:", error);
    throw new Error(`AI analysis failed: ${error.message}`);
  }
}

// Function to extract audio from video and convert to text using Gemini
async function extractAndTranscribeAudio(videoBuffer, fileName) {
  return new Promise(async (resolve, reject) => {
    try {
      // Create temporary files
      const tempDir = '/tmp';
      const inputPath = path.join(tempDir, `input-${Date.now()}-${fileName}`);
      const outputPath = path.join(tempDir, `output-${Date.now()}.mp3`);
      
      // Write video buffer to temporary file
      fs.writeFileSync(inputPath, videoBuffer);
      
      console.log("Extracting audio from video...");
      
      // Extract audio using ffmpeg
      ffmpeg(inputPath)
        .output(outputPath)
        .audioCodec('libmp3lame')
        .audioFrequency(16000)
        .on('end', async () => {
          try {
            console.log("Audio extraction completed");
            
            // Read the audio file
            const audioBuffer = fs.readFileSync(outputPath);
            
            // Convert audio to base64 for Gemini
            const base64Audio = audioBuffer.toString('base64');
            
            // Use Gemini to transcribe audio
            const model = genAI.getGenerativeModel({
              model: "gemini-1.5-flash",
            });
            
            const prompt = "Please transcribe the audio from this vehicle diagnostic video. Focus on the vehicle problems, symptoms, and issues described by the user.";
            
            const result = await model.generateContent([
              prompt,
              {
                inlineData: {
                  mimeType: "audio/mp3",
                  data: base64Audio
                }
              }
            ]);
            
            const response = await result.response;
            const transcription = response.text();
            
            console.log("Transcription completed");
            
            // Clean up temporary files
            try {
              fs.unlinkSync(inputPath);
              fs.unlinkSync(outputPath);
            } catch (cleanupError) {
              console.error("Cleanup error:", cleanupError);
            }
            
            resolve({
              success: true,
              text: transcription,
              language: "en"
            });
            
          } catch (transcriptionError) {
            // Clean up temporary files even if transcription fails
            try {
              fs.unlinkSync(inputPath);
              fs.unlinkSync(outputPath);
            } catch (cleanupError) {
              console.error("Cleanup error:", cleanupError);
            }
            reject(transcriptionError);
          }
        })
        .on('error', (error) => {
          // Clean up temporary files
          try {
            fs.unlinkSync(inputPath);
            if (fs.existsSync(outputPath)) {
              fs.unlinkSync(outputPath);
            }
          } catch (cleanupError) {
            console.error("Cleanup error:", cleanupError);
          }
          reject(new Error(`Audio extraction failed: ${error.message}`));
        })
        .run();
        
    } catch (error) {
      reject(new Error(`Audio processing failed: ${error.message}`));
    }
  });
}

// Fallback transcription for when audio processing fails
function getFallbackTranscription(fileName) {
  return `Audio from ${fileName}. The video contains a vehicle diagnostic recording. Please ensure the audio is clear and describes the vehicle issues in detail for proper analysis.`;
}

// Test endpoint
app.post("/test", upload.single("recording"), (req, res) => {
  console.log("Test endpoint - File received:", {
    size: req.file?.size,
    type: req.file?.mimetype,
    name: req.file?.originalname
  });
  
  res.json({ 
    success: true, 
    message: "Server is working! File received successfully.",
    fileSize: req.file?.size,
    fileName: req.file?.originalname,
    fileType: req.file?.mimetype,
    timestamp: new Date().toISOString()
  });
});

// Main processing endpoint
app.post("/process-recording", upload.single("recording"), async (req, res) => {
  console.log("=== PROCESSING REQUEST ===");
  
  try {
    if (!req.file) {
      console.log("No file received");
      return res.status(400).json({ 
        success: false,
        error: "No file received",
        message: "Please select a video file to analyze" 
      });
    }

    console.log("Processing file:", {
      size: req.file.size,
      type: req.file.mimetype,
      name: req.file.originalname
    });

    let transcription;
    let analysis;

    try {
      // Step 1: Extract audio and transcribe
      console.log("Starting audio extraction and transcription...");
      transcription = await extractAndTranscribeAudio(req.file.buffer, req.file.originalname);
      
      if (!transcription.success) {
        console.log("Transcription failed, using fallback");
        transcription = {
          success: true,
          text: getFallbackTranscription(req.file.originalname),
          language: "en"
        };
      }

      console.log("Transcription completed, length:", transcription.text?.length);

      // If transcription is too short or seems like an error, use fallback
      if (!transcription.text || transcription.text.length < 10) {
        transcription.text = getFallbackTranscription(req.file.originalname);
      }

      // Step 2: Perform keyword analysis
      const keywordResults = advancedKeywordSearch(transcription.text);
      console.log("Keyword analysis found:", keywordResults.totalMatches, "matches");

      // Step 3: Analyze with Gemini
      console.log("Starting AI analysis with Gemini...");
      analysis = await analyzeWithGemini(transcription.text, req.file.originalname);
      console.log("AI analysis completed");

    } catch (processingError) {
      console.error("Processing error:", processingError);
      
      // Create fallback analysis based on file info
      transcription = {
        text: `Video analysis for ${req.file.originalname}. ${processingError.message}`,
        language: "en"
      };
      
      const keywordResults = advancedKeywordSearch(transcription.text);
      analysis = {
        mainProblem: "Video analysis in progress - please describe vehicle issues clearly in audio",
        problemType: "other",
        specificIssues: ["Ensure clear audio description of vehicle problems", "Describe symptoms and when they occur"],
        severity: "medium",
        keywords: ["vehicle", "diagnostic", "inspection"],
        recommendation: "Please record a new video with clear audio description of the vehicle issues. Speak clearly about the symptoms, when they occur, and what you've noticed."
      };
    }

    const response = {
      success: true,
      message: "Analysis completed successfully!",
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
        aiModel: "gemini-1.5-flash",
        keywordSearch: {
          foundKeywords: advancedKeywordSearch(transcription.text).foundKeywords,
          categories: advancedKeywordSearch(transcription.text).categories,
          totalKeywordsFound: advancedKeywordSearch(transcription.text).totalMatches,
          keywordMatch: advancedKeywordSearch(transcription.text).totalMatches > 0,
          totalMatches: advancedKeywordSearch(transcription.text).totalMatches
        }
      },
    };

    console.log("Sending successful response");
    res.json(response);

  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({ 
      success: false,
      error: "Processing failed",
      message: "We're experiencing technical difficulties. Please try again later.",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Health check endpoint
app.get("/", (req, res) => {
  res.json({
    message: "Vehicle Problem Detector API",
    status: "Operational",
    version: "2.0.0",
    features: ["Real audio transcription", "AI analysis", "Video processing"],
    totalKeywords: vehicleKeywords.length,
    environment: process.env.NODE_ENV || 'development',
    maxFileSize: "100MB",
    supportedFormats: "All video formats with audio",
    timestamp: new Date().toISOString()
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
    console.log(`Server ready for real video processing!`);
  });
}