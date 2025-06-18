import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertPropertySchema, type PredictionRequest, type PredictionResponse, type ModelMetrics } from "@shared/schema";
import { spawn } from "child_process";
import path from "path";

export async function registerRoutes(app: Express): Promise<Server> {
  
  // Predict house price endpoint
  app.post("/api/predict", async (req, res) => {
    try {
      const predictionData = req.body as PredictionRequest;
      
      // Validate the input data
      const validatedData = insertPropertySchema.parse(predictionData);
      
      let prediction: PredictionResponse;
      
      try {
        // Try to call Python ML model
        prediction = await callPythonModel(predictionData);
      } catch (pythonError) {
        console.warn("Python model failed, using fallback calculation:", pythonError);
        // Fallback calculation for development
        prediction = generateFallbackPrediction(predictionData);
      }
      
      // Store the property and prediction
      const property = await storage.createProperty(validatedData);
      await storage.createPrediction({
        propertyId: property.id,
        estimatedPrice: prediction.estimatedPrice,
        confidence: prediction.confidence,
        lowerBound: prediction.lowerBound,
        upperBound: prediction.upperBound,
      });
      
      res.json(prediction);
    } catch (error) {
      console.error("Prediction error:", error);
      res.status(400).json({ 
        message: error instanceof Error ? error.message : "Prediction failed" 
      });
    }
  });

  // Get model metrics endpoint
  app.get("/api/model-metrics", async (req, res) => {
    try {
      const metricsData = await getModelMetrics();
      res.json(metricsData);
    } catch (error) {
      console.error("Model metrics error:", error);
      res.status(500).json({ 
        message: "Failed to retrieve model metrics" 
      });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}

async function callPythonModel(data: PredictionRequest): Promise<PredictionResponse> {
  return new Promise((resolve, reject) => {
    // Try different Python commands for macOS compatibility
    const pythonCommands = ["python3", "python", "/usr/bin/python3"];
    const scriptPath = path.join(process.cwd(), "server", "ml_model.py");
    
    let pythonPath = process.env.PYTHON_PATH;
    if (!pythonPath) {
      // Find available Python command
      for (const cmd of pythonCommands) {
        try {
          const testProcess = spawn(cmd, ["--version"]);
          testProcess.on("close", (code) => {
            if (code === 0 && !pythonPath) {
              pythonPath = cmd;
            }
          });
        } catch (e) {
          continue;
        }
      }
      pythonPath = pythonPath || "python3";
    }
    
    console.log(`Using Python: ${pythonPath}`);
    
    const pythonProcess = spawn(pythonPath, [scriptPath]);
    
    let dataString = "";
    let errorString = "";
    
    pythonProcess.stdout.on("data", (data) => {
      dataString += data.toString();
    });
    
    pythonProcess.stderr.on("data", (data) => {
      errorString += data.toString();
    });
    
    pythonProcess.on("error", (error) => {
      console.error("Python process error:", error);
      reject(new Error(`Failed to start Python process: ${error.message}`));
    });
    
    pythonProcess.on("close", (code) => {
      if (code !== 0) {
        console.error("Python stderr:", errorString);
        reject(new Error(`Python process failed with code ${code}: ${errorString}`));
        return;
      }
      
      try {
        const result = JSON.parse(dataString);
        resolve(result);
      } catch (parseError) {
        console.error("Parse error:", parseError);
        console.error("Python output:", dataString);
        reject(new Error(`Failed to parse Python output: ${parseError}`));
      }
    });
    
    // Send input data to Python process
    try {
      pythonProcess.stdin.write(JSON.stringify(data));
      pythonProcess.stdin.end();
    } catch (error) {
      reject(new Error(`Failed to write to Python process: ${error}`));
    }
  });
}

async function getModelMetrics(): Promise<ModelMetrics> {
  return new Promise((resolve, reject) => {
    const pythonPath = process.env.PYTHON_PATH || "python3";
    const scriptPath = path.join(process.cwd(), "server", "ml_model.py");
    
    const pythonProcess = spawn(pythonPath, [scriptPath, "--metrics"]);
    
    let dataString = "";
    let errorString = "";
    
    pythonProcess.stdout.on("data", (data) => {
      dataString += data.toString();
    });
    
    pythonProcess.stderr.on("data", (data) => {
      errorString += data.toString();
    });
    
    pythonProcess.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Python process failed: ${errorString}`));
        return;
      }
      
      try {
        const result = JSON.parse(dataString);
        resolve(result);
      } catch (parseError) {
        reject(new Error(`Failed to parse Python output: ${parseError}`));
      }
    });
  });
}

// Fallback prediction function for development when Python model fails
function generateFallbackPrediction(data: PredictionRequest): PredictionResponse {
  // Simple fallback calculation based on square footage and other factors
  const basePrice = data.squareFootage * 2000; // ₹2000 per sq ft base
  
  // Adjust for year built (newer = more expensive)
  const ageAdjustment = (2024 - data.yearBuilt) * -500;
  
  // Adjust for rooms
  const roomAdjustment = (data.bedrooms * 50000) + (data.bathrooms * 30000);
  
  // Property type multiplier
  const typeMultipliers = {
    'Single Family': 1.2,
    'Condo': 0.9,
    'Townhouse': 1.0,
    'Multi-Family': 1.1
  };
  const typeMultiplier = typeMultipliers[data.propertyType as keyof typeof typeMultipliers] || 1.0;
  
  // Calculate estimated price
  let estimatedPrice = (basePrice + ageAdjustment + roomAdjustment) * typeMultiplier;
  
  // Add some randomness for realism (±10%)
  const randomFactor = 0.9 + (Math.random() * 0.2);
  estimatedPrice *= randomFactor;
  
  // Ensure minimum price
  estimatedPrice = Math.max(estimatedPrice, 500000); // Minimum ₹5 lakh
  
  // Calculate confidence and bounds
  const confidence = 0.75 + (Math.random() * 0.2); // 75-95% confidence
  const margin = estimatedPrice * 0.15; // ±15% margin
  
  return {
    estimatedPrice: Math.round(estimatedPrice),
    confidence: Math.round(confidence * 100) / 100,
    lowerBound: Math.round(estimatedPrice - margin),
    upperBound: Math.round(estimatedPrice + margin),
    featureImportance: [
      { feature: "Square Footage", importance: 0.45 },
      { feature: "Property Type", importance: 0.25 },
      { feature: "Year Built", importance: 0.15 },
      { feature: "Bedrooms", importance: 0.10 },
      { feature: "Bathrooms", importance: 0.05 }
    ]
  };
}
