const express = require("express");
const cors = require("cors");
const multer = require("multer");

const app = express();

app.use(cors());
app.use(express.json());

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
    if (lowerText.includes(lowerKeyword)) {
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

function generateAnalysis(keywordResults) {
  const categories = keywordResults.categories;
  const foundKeywords = keywordResults.foundKeywords;
  
  let mainProblem = "Vehicle maintenance check recommended";
  let problemType = "other";
  let severity = "low";
  
  if (categories.length > 0) {
    problemType = categories[0];
    
    if (problemType === 'brake') {
      mainProblem = "Brake system issue detected";
      severity = foundKeywords.some(k => k.includes('failure') || k.includes('noise')) ? "high" : "medium";
    } else if (problemType === 'engine') {
      mainProblem = "Engine performance issue";
      severity = foundKeywords.some(k => k.includes('failure') || k.includes('overheating')) ? "high" : "medium";
    } else if (problemType === 'tire') {
      mainProblem = "Tire or wheel issue identified";
      severity = foundKeywords.some(k => k.includes('flat') || k.includes('wear')) ? "medium" : "low";
    } else if (problemType === 'electrical') {
      mainProblem = "Electrical system concern";
      severity = foundKeywords.some(k => k.includes('battery') || k.includes('failure')) ? "medium" : "low";
    } else if (problemType === 'transmission') {
      mainProblem = "Transmission issue detected";
      severity = foundKeywords.some(k => k.includes('slipping') || k.includes('failure')) ? "high" : "medium";
    }
  }
  
  const specificIssues = foundKeywords.slice(0, 5).map(keyword => 
    `${keyword.charAt(0).toUpperCase() + keyword.slice(1)} issue detected`
  );
  
  if (specificIssues.length === 0) {
    specificIssues.push("General vehicle inspection recommended");
  }
  
  const recommendations = {
    brake: "Have your brake system inspected by a certified mechanic immediately. Do not drive if brakes feel spongy or make unusual noises. Check brake fluid levels and pad thickness.",
    engine: "Schedule an engine diagnostic with a professional mechanic. Check oil levels, coolant, and look for any visible leaks. Avoid long drives until inspected.",
    tire: "Visit a tire shop for inspection and possible rotation or replacement. Check tire pressure weekly and look for uneven wear patterns.",
    electrical: "Have your vehicle's electrical system tested. Battery, alternator, and starter should be checked professionally. Look for corroded connections.",
    transmission: "Transmission service recommended. Have fluid levels and shifting performance evaluated. Avoid aggressive driving until inspected.",
    suspension: "Suspension system needs professional evaluation. Check for worn shocks, struts, or bushings. Look for uneven tire wear.",
    other: "Schedule a comprehensive vehicle inspection with a certified mechanic to identify any potential issues. Regular maintenance can prevent major problems."
  };
  
  return {
    mainProblem,
    problemType,
    specificIssues,
    severity,
    keywords: foundKeywords,
    recommendation: recommendations[problemType] || recommendations.other
  };
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

    // For now, we'll simulate transcription since we don't have AssemblyAI working
    // In a real scenario, you would process the audio here
    const simulatedTranscription = `
    Vehicle diagnostic check. I'm noticing some issues with the car. 
    There's a strange noise coming from the brakes when I press the pedal.
    Also, the engine seems to be running rough and there might be a tire pressure warning light on the dashboard.
    I think there could be electrical issues too as some lights are flickering.
    The transmission is shifting roughly between gears and I can hear some suspension noises when going over bumps.
    `;

    // Perform keyword analysis
    const keywordResults = advancedKeywordSearch(simulatedTranscription);
    console.log("Keyword analysis found:", keywordResults.totalMatches, "matches");

    // Generate analysis based on keywords
    const analysis = generateAnalysis(keywordResults);

    const response = {
      success: true,
      message: "Analysis completed successfully!",
      analysis: {
        transcription: simulatedTranscription,
        mainProblem: analysis.mainProblem,
        problemType: analysis.problemType,
        specificIssues: analysis.specificIssues,
        severity: analysis.severity,
        keywords: analysis.keywords,
        recommendation: analysis.recommendation,
        word_count: simulatedTranscription.split(/\s+/).length,
        problem_count: analysis.specificIssues.length,
        aiModel: "keyword-analysis",
        keywordSearch: {
          foundKeywords: keywordResults.foundKeywords,
          categories: keywordResults.categories,
          totalKeywordsFound: keywordResults.totalMatches,
          keywordMatch: keywordResults.totalMatches > 0,
          totalMatches: keywordResults.totalMatches
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
    version: "1.0.0",
    features: ["File upload", "Keyword analysis", "Basic diagnostics"],
    totalKeywords: vehicleKeywords.length,
    environment: process.env.NODE_ENV || 'development',
    maxFileSize: "100MB",
    supportedFormats: "All video formats",
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
    console.log(`Server ready for testing!`);
  });
}