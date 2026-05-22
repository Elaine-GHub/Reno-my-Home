import express from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";

dotenv.config();

const app = express();
const PORT = 3000;

// Increase request size limit for floor plan image base64 uploads
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ limit: "15mb", extended: true }));

// Shared Gemini Client Utility
let ai: GoogleGenAI | null = null;
if (process.env.GEMINI_API_KEY) {
  ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

// API: Check health and configuration
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    environment: process.env.NODE_ENV || "development",
    hasApiKey: !!process.env.GEMINI_API_KEY,
  });
});

// API: Generate spatial layout & design proposal
app.post("/api/gemini/generate", async (req, res) => {
  try {
    const { 
      country, 
      floorPlanName, 
      floorPlanImage, 
      occupantCount, 
      occupantProfile, 
      lifestylePriorities, 
      preferences, 
      totalBudget, 
      budgetAllocation 
    } = req.body;

    // Strict validation
    if (!country) {
      return res.status(400).json({ error: "Missing 'country' parameter." });
    }

    const { style, moodTones, flooring, sofaMaterial, carpentryLevel, extremeSpaceSaving } = preferences || {};
    const { hacking, carpentry, furniture, contingency } = budgetAllocation || {};

    const systemInstruction = `You are a Principal AI Interior Designer and Spatial Architect specializing in Singapore residential properties, including HDB flats, BTO, and modern Executive Condominiums (such as My Home EC).
Your task is to review the occupant profiles, budget separation, design style preferences, material selections, space optimization flags, and optional floor plan image, and output a highly personalized, deep Spatial Renovation Report.

You must reply with a valid JSON document conforming to the exact schema specified. Follow these logical criteria strictly:
1. Spatial Layout: Break down room-by-room layout (Living room, Master bedroom, Common rooms, Corridor). Suggest clear, item-by-item placements (with clearance guidelines) specifically suited for modern compact rooms in Singaporian flats.
2. Fit-to-Space Analytics: Always compute exact walking clearance warnings based on typical furniture sizes versus common Singapore room layouts. (e.g. Master room with size ~9-11sqm cannot fit a King bed + study desk + huge wardrobe without reducing walkways below 60cm). Warn the user specifically.
3. Mini-Space Accents: Suggest at least one creative space-elongation trick, explicitly naming Corridor Wall Art/Painting Placement or strategic mirror styling to make the entryway or corridor look wider.
4. Material Climate Index: Rate and discuss flooring, sofas, and carpentry against Singapore's ultra-high tropical humidity climate (average humidity 84%). Explicitly explain how fabric vs premium leather behaves on bare skin and moisture absorption, or how engineered wood needs specific maintenance compared to vinyl or marble.
5. Financial Compliance Audit: Average renovation in Singapore lands between S$50k and S$110k depending on works. Evaluate user's S$ budget. Identify deficit or surplus based on user's carpentry preferences, hacking amounts, and loose furniture. Break out standard BCA/HDB permits needed (e.g. wall hacking, toilet retiling waterproofing, window grilles, wiring work) based on user selections.`;

    const promptText = `
User Input Parameters for Renovation Optimization:
- Country: ${country} (Targeting Singapore Environmental Guidelines & regulations)
- Occupants: ${occupantCount} person(s). Profile: ${occupantProfile?.workingAdults || 0} Working Adults, ${occupantProfile?.toddlers || 0} Toddler(s), ${occupantProfile?.elderly || 0} Elderly members. Pets? ${occupantProfile?.hasPets ? "Yes" : "No"}.
- Lifestyle Priorities: ${Array.isArray(lifestylePriorities) ? lifestylePriorities.join(", ") : "Multi-functional, Storage-priority"}
- Preferred Style: ${style || "Modern Minimalist"} (Mood: ${moodTones || "Warm neutrals"})
- Selected Materials Matrix:
  - Flooring: ${flooring || "Vinyl"}
  - Sofa type: ${sofaMaterial || "Fabric"}
  - Custom Carpentry Level: ${carpentryLevel || "Moderate"}
- Extreme Space-Saving / Tiny Room Optimization: ${extremeSpaceSaving ? "ENABLED (CRITICAL)" : "DISABLED"}
- Total Budget: S$${totalBudget || 60000}
- Budget Allocation Split: Hacking ${hacking || 15}%, Carpentry ${carpentry || 40}%, loose Furniture ${furniture || 35}%, Contingency ${contingency || 10}%
- Floor Plan name: ${floorPlanName || "Standard Executive Layout"}

Please analyze and generate spatial recommendations and cost-regulatory audits specifically for Singapore's tropical climate and legal rules. Return only JSON.`;

    // Try live Gemini API call if enabled
    if (ai) {
      let contents: any[] = [];

      if (floorPlanImage && floorPlanImage.startsWith("data:image")) {
        const matches = floorPlanImage.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
          contents.push({
            inlineData: {
              mimeType: matches[1],
              data: matches[2]
            }
          });
        }
      }

      contents.push({ text: promptText });

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: { parts: contents },
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              spatialLayout: {
                type: Type.OBJECT,
                properties: {
                  rooms: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        name: { type: Type.STRING, description: "Name of the room" },
                        items: {
                          type: Type.ARRAY,
                          items: {
                            type: Type.OBJECT,
                            properties: {
                              name: { type: Type.STRING },
                              position: { type: Type.STRING },
                              clearanceReq: { type: Type.STRING },
                              advice: { type: Type.STRING }
                            }
                          }
                        },
                        dimensionWarnings: {
                          type: Type.ARRAY,
                          items: {
                            type: Type.OBJECT,
                            properties: {
                              roomName: { type: Type.STRING },
                              furnitureItem: { type: Type.STRING },
                              recommendedSize: { type: Type.STRING },
                              warningMessage: { type: Type.STRING },
                              dangerLevel: { type: Type.STRING, enum: ["low", "medium", "high"] }
                            }
                          }
                        },
                        accents: {
                          type: Type.ARRAY,
                          items: { type: Type.STRING }
                        }
                      },
                      required: ["name", "items", "dimensionWarnings", "accents"]
                    }
                  }
                },
                required: ["rooms"]
              },
              materialClimateIndex: {
                type: Type.OBJECT,
                properties: {
                  materials: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        material: { type: Type.STRING },
                        suitabilityScore: { type: Type.NUMBER },
                        humidityPerformance: { type: Type.STRING },
                        maintenanceAdvice: { type: Type.STRING }
                      }
                    }
                  },
                  humiditySummary: { type: Type.STRING }
                },
                required: ["materials", "humiditySummary"]
              },
              complianceGuide: {
                type: Type.OBJECT,
                properties: {
                  marketAverageSGD: { type: Type.NUMBER },
                  budgetStatus: { type: Type.STRING, enum: ["deficit", "surplus", "balanced"] },
                  differenceSGD: { type: Type.NUMBER },
                  permits: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        authority: { type: Type.STRING },
                        permitName: { type: Type.STRING },
                        status: { type: Type.STRING, enum: ["Mandatory", "Recommended", "Not Required"] },
                        description: { type: Type.STRING }
                      }
                    }
                  },
                  advice: { type: Type.STRING }
                },
                required: ["marketAverageSGD", "budgetStatus", "differenceSGD", "permits", "advice"]
              }
            },
            required: ["spatialLayout", "materialClimateIndex", "complianceGuide"]
          }
        }
      });

      const jsonString = response.text || "{}";
      const parsedData = JSON.parse(jsonString.trim());
      return res.json(parsedData);
    } else {
      // Fallback local mock simulation when API key is missing. 
      // This is a highly robust response specifically engineered for My Home space layouts.
      console.log("No Gemini API key found, serving highly structural, localized SG client-side blueprint analysis fallback.");
      
      const responseFallback = simulateInteriorDesignerAI(
        style || "Japandi", 
        flooring || "Vinyl", 
        sofaMaterial || "Fabric", 
        extremeSpaceSaving, 
        totalBudget || 65000,
        budgetAllocation,
        occupantCount
      );
      
      return res.json(responseFallback);
    }
  } catch (err: any) {
    console.error("Error generating interior layout:", err);
    res.status(500).json({ error: err.message || "An unexpected error occurred building layout suggestions." });
  }
});

// Helper: Local fallback mock structure simulating highly advanced logic
function simulateInteriorDesignerAI(
  style: string, 
  flooring: string, 
  sofa: string, 
  spaceSaving: boolean, 
  budget: number,
  alloc: any,
  occupants: number
) {
  const hackingPct = alloc?.hacking || 15;
  const carpentryPct = alloc?.carpentry || 40;
  const furniturePct = alloc?.furniture || 35;
  const contingencyPct = alloc?.contingency || 10;

  const standardAvgSgd = 78000;
  const diffSgd = Math.abs(budget - standardAvgSgd);
  const budgetStatus = budget < standardAvgSgd ? "deficit" : "surplus";

  return {
    spatialLayout: {
      rooms: [
        {
          name: "Living Room & Entryway",
          items: [
            {
              name: `3-Seater Low-Profile Sofa (${sofa})`,
              position: "Flush against the main structural wall, leaving a minimum 90cm walkways to standard corridor.",
              clearanceReq: "90cm clear walkway",
              advice: sofa === "Fabric" 
                ? "Fabric provides premium cozy acoustics but needs high-breathability or consistent dehumidification to block Singapore tropical mold."
                : "Premium leather cleans sweat instantly and keeps surfaces cool but avoid direct exposure to coastal high salt humidity windows."
            },
            {
              name: "Wall-Mounted Suspended Media Console",
              position: "Levitated 20cm above the floor directly opposite the sofa layout.",
              clearanceReq: "50cm clearance beneath console",
              advice: "By floating the carpentry off the floor, you elongate the floor tiles visually and provide storage underneath for robot cleaners."
            }
          ],
          dimensionWarnings: spaceSaving 
            ? [
                {
                  roomName: "Living Room",
                  furnitureItem: "Standard Coffee Table",
                  recommendedSize: "Diameter max 60cm, or modular nest tablets",
                  warningMessage: "At current tight condo widths (~3.2m), a bulky rectangular coffee table restricts leg clearance below 45cm. Modular nesting tablets are required.",
                  dangerLevel: "medium"
                }
              ]
            : [],
          accents: [
            "Entryway Foyer: Install a 2.4m tall custom full-height copper-tinted mirror wall. This instantly bounces light from the balcony and visually doubles structural foyer width.",
            "Visual Accents: Use a single premium display painting on the corridor accent wall styled with recessed warm 3000K spotlights."
          ]
        },
        {
          name: "Master Bedroom",
          items: [
            {
              name: "Storage Queen-Size Platform Bed Frame",
              position: "Positioned centrally with headboard against northern wall, avoiding direct door alignment.",
              clearanceReq: "65cm walkway margin around bed",
              advice: "Platform storage beds lift the mattress, providing critical hidden storage for bulky items, replacing deep freestanding dressers."
            }
          ],
          dimensionWarnings: [
            {
              roomName: "Master Bedroom",
              furnitureItem: "King-Size Bed & Dresser",
              recommendedSize: "Strictly Queen-Size Bed only",
              warningMessage: "Fitting a King bed alongside a 3-door swinging wardrobe reduces walkway clearance to 42cm. Switch to a Queen-size frame with integrated platform storage.",
              dangerLevel: "high"
            }
          ],
          accents: [
            "Floating open nightstands keep floor area clean",
            "Place large vertical floor mirrors on the side corner to bounce light from main bedroom windows."
          ]
        },
        {
          name: "Tiny Common Rooms (Multi-functional Studio / Study)",
          items: [
            {
              name: "Foldable Murphy Desk / Daybed Loft System",
              position: "Along the single window structural wall to capture tropical natural light.",
              clearanceReq: "110cm when unfolded",
              advice: "Combines remote WFH study workspace and custom guest lounge. Foldable desks are crucial for 8.5sqm standard layouts."
            }
          ],
          dimensionWarnings: spaceSaving 
            ? [
                {
                  roomName: "Tiny Common Room 1",
                  furnitureItem: "Double Bed Frame",
                  recommendedSize: "Single or Super Single Platform Bed Frame",
                  warningMessage: "Placing a standard double bed blocks study desk clearance entirely, leaving only 35cm doorway clearance.",
                  dangerLevel: "high"
                }
              ]
            : [],
          accents: [
            "Use warm LED light-stripping beneath the cabinetry to eliminate dark floor corners.",
            "Install light Japandi-style sheer day curtains to diffuse harsh Singapore morning sun while maintaining privacy."
          ]
        },
        {
          name: "Corridors & Transition Zones",
          items: [
            {
              name: "Corridor Wall Art/Painting Placement & Illumination",
              position: "Evenly spaced at 1.4m height from floor, on the long corridor dry-wall partition.",
              clearanceReq: "Keep walkway 100% unobstructed",
              advice: "Hanging series of minimalist 3-part gallery prints draws the eye forward, resolving the claustrophobic feel of long windowless Singapore hallways. Use 12cm low-projection profiles."
            }
          ],
          dimensionWarnings: [],
          accents: [
            "Incorporate a focal full-length mirror at the end of the corridor to create a false visual depth look.",
            "Install circular warm directional eyeball LED spotlights focused specifically on the corridor wall art."
          ]
        }
      ],
    },
    materialClimateIndex: {
      materials: [
        {
          material: `Flooring (${flooring})`,
          suitabilityScore: flooring === "Vinyl" ? 95 : flooring === "Engineered Wood" ? 70 : 85,
          humidityPerformance: flooring === "Vinyl" 
            ? "100% moisture-proof, zero risk of popping or dynamic expansion under extreme humidity."
            : flooring === "Engineered Wood"
            ? "Vulnerable to high humidity swelling. Requires a 12mm expansion gap along perimeter margins."
            : "Cold under bare skin, stable performance, but high grout upkeep on tropical humidity mold.",
          maintenanceAdvice: flooring === "Engineered Wood" 
            ? "Maintain indoor humidity range from 45% to 65% with regular AC usage. Never use water-drenched heavy mops."
            : flooring === "Vinyl"
            ? "Wipe with a moderately micro-damp fiber cloth. Perfect for pets and children spillages."
            : "Regular weekly resealing of tile grouts to bypass green water mold accumulation."
        },
        {
          material: `Sofa Cover (${sofa})`,
          suitabilityScore: sofa === "Premium Leather" ? 90 : 82,
          humidityPerformance: sofa === "Premium Leather"
            ? "Excellent dust-mite resistance but traps direct heat if placed near sunny balconies."
            : "Highly breathable which matches the warm Singapore climate, but prone to liquid sweat staining and tropical relative humidity odor absorption.",
          maintenanceAdvice: sofa === "Premium Leather"
            ? "Treat with deep leather conditioner every 6 months to bypass cracking under high AC dehumidification cycle."
            : "Apply anti-stain hydrophobic protective coating, and perform quick bi-annual dry deep vacuums."
        }
      ],
      humiditySummary: "Singapore sits at 84% average relative humidity. Your selected material palette scores highly on water-defense, but careful venting and moderate high-efficiency filtration maintain comfort."
    },
    complianceGuide: {
      marketAverageSGD: standardAvgSgd,
      budgetStatus: budgetStatus,
      differenceSGD: diffSgd,
      permits: [
        {
          authority: "HDB / BCA",
          permitName: "Wall Hacking & Structural Safety Approval",
          status: hackingPct > 10 ? "Mandatory" : "Not Required",
          description: "All non-load-bearing wall modifications inside HDB flat blocks require professional PE endorsement & official BCA permits (S$1,500-S$2,500 standard)."
        },
        {
          authority: "HDB",
          permitName: "Wet Area Flooring Replacement & Screeding",
          status: hackingPct > 5 ? "Mandatory" : "Recommended",
          description: "Waterproofing membrane test is strictly mandatory if replacing floor finishes in HDB bathroom units. It must be tested for 24-hour ponding."
        },
        {
          authority: "SP Group / EMA",
          permitName: "Three-Phase Power Upgrade Verification",
          status: carpentryPct > 30 ? "Recommended" : "Not Required",
          description: "High volume of built-in heavy appliances (induction, multiple AC units) may overload baseline 30-45Amp consumer boards."
        }
      ],
      advice: budgetStatus === "deficit" 
        ? "Your budget of S$" + budget + " is slightly lower than the Singapore local average for extensive custom works. To optimize, prioritize custom built-in Carpentry strictly for the Master wardrobe and Living console, and procure loose furniture through trusted local distributors rather than bespoke custom order shops."
        : "Your budget profile is robust. We recommend investing in premium multi-zone air filtration systems and advanced Blum pocket door systems for extreme space-saving flexibility."
    }
  };
}

// Dev and Production Routing for Single-Page Application (SPA)
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`My Home Renovation Server running on port ${PORT}`);
  });
}

startServer();
