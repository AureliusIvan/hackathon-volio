import { NextRequest } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { searchImageTopics, isExaAvailable } from '../../../utils/exa';

export async function POST(req: NextRequest) {
  try {
    // Parse the request body
    const { image, mode = 'narration', singleTap = false }: { image: string; mode?: 'narration' | 'guidance'; singleTap?: boolean } = await req.json();

    // Input validation
    if (!image || typeof image !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Invalid image data provided' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Check for API key
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      console.error('GOOGLE_API_KEY not found in environment variables');
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Initialize Gemini with mode-specific model configuration
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // Use different models based on mode
    const modelName = mode === 'narration' ? 'gemini-2.5-flash' : 'gemini-2.0-flash';
    const model = genAI.getGenerativeModel({ 
      model: modelName,
      generationConfig: {
        temperature: 0.7,
      },
    });

    // Prepare mode-specific prompts
    let prompt: string;

    if (mode === 'narration') {
      if (singleTap) {
        prompt = `

You are NaraNetra, a personal tour guide specializing in Indonesian art, culture, and heritage. You are in NUSANTARA GUIDE MODE.

When you see an image related to Indonesian culture (such as artwork, architecture, textiles, ceremonial objects, or historical sites), identify it and tell its story using this exact format:

**[Name of Object/Site], [Origin/Creator/Culture]**
[A brief 1-2 sentence description of what the object is and its medium.]
[In 2-4 sentences, tell the story behind the piece: its context, its use in ceremonies or daily life, and its cultural significance or symbolism.]
**Tour Guide's Take:** [Your short, honest, and critical insight. Share a local belief, a detail most people miss, or its relevance in modern Indonesia.]

Example 1 (Object):
**Keris Naga Sasra, Javanese Empu**
This is a ceremonial Javanese dagger, or keris, known for its distinctive wavy blade forged from patterned meteorite iron (pamor).
The keris is more than a weapon; it's a spiritual object believed to possess a life of its own. The "Naga Sasra" (Thousand Dragons) motif symbolizes immense power and protection, historically reserved for kings and high officials. Crafting a keris is a sacred art, involving complex rituals by a master smith known as an Empu.
**Tour Guide's Take:** Don't just see it as a knife. Many still believe the keris chooses its owner, and a mismatched pairing can bring bad luck. The real artistry is in the pamor, which is said to hold the blade's specific magical properties.

Example 2 (Site):
**Tanah Lot Temple, Bali**
This is a famous Hindu sea temple (Pura) in Bali, perched on a large offshore rock formation.
Built in the 16th century, it's one of seven sea temples that form a chain along the Balinese coast, meant to honor the sea gods. At high tide, the rock becomes an island, making the temple appear to float. It's a site of pilgrimage and a central part of Balinese spiritual mythology.
**Tour Guide's Take:** It's incredibly commercialized, but if you ignore the crowds and focus on the temple during sunset, you can still feel its power. The truly spiritual sites are often less crowded, but Tanah Lot's silhouette against the sunset is undeniably iconic for a reason.

Example 3 (Artwork):
**The Arrest of Prince Diponegoro, Raden Saleh**
This is an oil painting on canvas from the Romanticism period.
The painting depicts the historical moment when the Dutch colonial government betrayed and arrested Prince Diponegoro in 1830, effectively ending the Java War. Raden Saleh painted it as a nationalist response to a Dutch painter's version, portraying Diponegoro with dignity and defiance, while the Dutch officials look arrogant and deceitful.
**Tour Guide's Take:** This is a classic example of using art as counter-propaganda. Raden Saleh cleverly inserted himself into the crowd, as if watching the event. He also painted the Dutch officials with slightly oversized heads to make them look unnatural and grotesque, a subtle but sharp critique.
`;
      

} else {
        prompt = `
You are NaraNetra, an assistant for the visually impaired. You are in NARRATION MODE.

Analyze this image and provide a comprehensive, detailed description that includes:
1. The main object or subject in the image
2. Cultural significance, historical context, or interesting facts about what you see
3. Visual details like colors, textures, materials, and design elements
4. Any text, logos, or writing visible
5. The setting or environment where this is located

Be educational and informative. If you recognize specific objects, brands, landmarks, or cultural items, share relevant knowledge about them. Make it engaging and informative for someone who cannot see the image.

Format your response as a flowing, conversational explanation that would help someone understand both what they're looking at and learn something interesting about it.`;
      }
    } else {
      prompt = `
# ROLE: NaraNetra Guidance Mode

You are a vision-based guidance assistant using the phone's back camera to help the user navigate indoors. Your goal is to provide concise navigation instructions. You must prioritize safety from obstacles, but also identify art, stopping for pieces directly ahead and pointing out others when the path is clear.

TASK: Respond with **at most one short sentence** advising the user how to proceed.

# 1. IF there is an obstacle, hazard, or person in the user's path (within ~5 meters ahead):

**FORMAT:** "beware, {ACTION}, {description}."

- **ACTION** can be **GO LEFT**, **GO RIGHT**, or **STOP**.
- This is the highest priority rule for immediate safety.
- Example: **"beware, GO RIGHT, there is a chair 3 meters ahead."**

# 2. IF there is art directly in front of the user (and the path is otherwise clear):

**FORMAT:** "stop, {description}, activating Narration Mode."

- Use this to halt the user in front of the art and signal a mode change.
- Example: **"stop, there is a large oil painting in front of you, activating Narration Mode."**
- Example: **"stop, you are in front of a sculpture, activating Narration Mode."**

# 3. IF the path straight ahead is clear (no obstacles or art directly in front):

**FORMAT:** "safe, {context}."

- You may include **GO FORWARD** to indicate it is safe to proceed.
- If there is art on a side wall (not directly in front), mention it here.
- Example: **"safe, GO FORWARD, the hallway is clear for 10 meters."**
- Example: **"safe, GO FORWARD, there is a painting on the wall to your right."**

# 4. IF the camera view is unclear or you are unsure:

- Advise the user to stop due to uncertainty.
- Example: **"stop, I can't see clearly."*
`;
    }

    // Strip the data URL prefix if present
    const base64ImageData = image.replace(/^data:image\/[a-z]+;base64,/, '');

    // Prepare the image part
    const imagePart = {
      inlineData: {
        data: base64ImageData,
        mimeType: 'image/jpeg'
      }
    };

    // Create streaming response
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Send initial metadata
          const initialData = {
            type: 'start',
            mode: mode,
            singleTap: singleTap,
            timestamp: new Date().toISOString()
          };
          controller.enqueue(`data: ${JSON.stringify(initialData)}\n\n`);

          // Start streaming from Gemini
          const result = await model.generateContentStream([prompt, imagePart]);
          let fullText = '';

          for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            if (chunkText) {
              fullText += chunkText;

              // Send chunk data
              const chunkData = {
                type: 'chunk',
                text: chunkText,
                fullText: fullText,
                mode: mode,
                singleTap: singleTap
              };
              controller.enqueue(`data: ${JSON.stringify(chunkData)}\n\n`);
            }
          }

          // Enhanced response with web search for narration mode
          if (mode === 'narration' && isExaAvailable()) {
            try {
              // Send web search status
              const searchStatusData = {
                type: 'web_search_start',
                message: singleTap ? 'Searching for object information...' : 'Searching for additional information...'
              };
              controller.enqueue(`data: ${JSON.stringify(searchStatusData)}\n\n`);

              // Prepare search query based on mode
              let searchQuery = fullText;
              if (singleTap) {
                // Extract object name from structured response
                const objectMatch = fullText.match(/OBJECT:\s*([^\n\r]+)/i);
                if (objectMatch) {
                  searchQuery = objectMatch[1].trim();
                }
              }

              // Perform web search based on image description or object
              const searchResults = await searchImageTopics(searchQuery, mode);
              
              if (searchResults && searchResults.results.length > 0) {
                // Send web search results
                const webSearchData = {
                  type: 'web_search_results',
                  searchQuery: searchResults.searchQuery,
                  results: searchResults.results.slice(0, 2), // Limit to top 2 results
                  totalResults: searchResults.totalResults
                };
                controller.enqueue(`data: ${JSON.stringify(webSearchData)}\n\n`);

                // Create enhanced description with web info
                const webInfo = searchResults.results
                  .slice(0, 2)
                  .map(result => result.summary || result.text?.substring(0, 200))
                  .filter(Boolean)
                  .join(' ');

                if (webInfo) {
                  const enhancedText = `${fullText}\n\nAdditional Information: ${webInfo}`;
                  
                  // Extract object info for single tap mode
                  let objectInfo = null;
                  if (singleTap) {
                    const objectMatch = fullText.match(/OBJECT:\s*([^\n\r]+)/i);
                    const descMatch = fullText.match(/DESCRIPTION:\s*([^\n\r]+)/i);
                    if (objectMatch) {
                      objectInfo = {
                        name: objectMatch[1].trim(),
                        description: descMatch ? descMatch[1].trim() : null
                      };
                    }
                  }
                  
                  // Send enhanced complete data
                  const enhancedCompleteData = {
                    type: 'complete',
                    fullText: enhancedText,
                    originalText: fullText,
                    webInfo: webInfo,
                    mode: mode,
                    singleTap: singleTap,
                    objectInfo: objectInfo,
                    searchQuery: searchQuery,
                    timestamp: new Date().toISOString(),
                    hasWebSearch: true
                  };
                  controller.enqueue(`data: ${JSON.stringify(enhancedCompleteData)}\n\n`);
                } else {
                  // Extract object info for single tap mode
                  let objectInfo = null;
                  if (singleTap) {
                    const objectMatch = fullText.match(/OBJECT:\s*([^\n\r]+)/i);
                    const descMatch = fullText.match(/DESCRIPTION:\s*([^\n\r]+)/i);
                    if (objectMatch) {
                      objectInfo = {
                        name: objectMatch[1].trim(),
                        description: descMatch ? descMatch[1].trim() : null
                      };
                    }
                  }
                  
                  // Send regular completion if no useful web info
                  const completeData = {
                    type: 'complete',
                    fullText: fullText,
                    mode: mode,
                    singleTap: singleTap,
                    objectInfo: objectInfo,
                    timestamp: new Date().toISOString(),
                    hasWebSearch: false
                  };
                  controller.enqueue(`data: ${JSON.stringify(completeData)}\n\n`);
                }
              } else {
                // Extract object info for single tap mode
                let objectInfo = null;
                if (singleTap) {
                  const objectMatch = fullText.match(/OBJECT:\s*([^\n\r]+)/i);
                  const descMatch = fullText.match(/DESCRIPTION:\s*([^\n\r]+)/i);
                  if (objectMatch) {
                    objectInfo = {
                      name: objectMatch[1].trim(),
                      description: descMatch ? descMatch[1].trim() : null
                    };
                  }
                }
                
                // Send regular completion if no search results
                const completeData = {
                  type: 'complete',
                  fullText: fullText,
                  mode: mode,
                  singleTap: singleTap,
                  objectInfo: objectInfo,
                  timestamp: new Date().toISOString(),
                  hasWebSearch: false
                };
                controller.enqueue(`data: ${JSON.stringify(completeData)}\n\n`);
              }
            } catch (searchError) {
              console.error('Web search error:', searchError);
              
              // Extract object info for single tap mode
              let objectInfo = null;
              if (singleTap) {
                const objectMatch = fullText.match(/OBJECT:\s*([^\n\r]+)/i);
                const descMatch = fullText.match(/DESCRIPTION:\s*([^\n\r]+)/i);
                if (objectMatch) {
                  objectInfo = {
                    name: objectMatch[1].trim(),
                    description: descMatch ? descMatch[1].trim() : null
                  };
                }
              }
              
              // Send regular completion on search error
              const completeData = {
                type: 'complete',
                fullText: fullText,
                mode: mode,
                singleTap: singleTap,
                objectInfo: objectInfo,
                timestamp: new Date().toISOString(),
                hasWebSearch: false
              };
              controller.enqueue(`data: ${JSON.stringify(completeData)}\n\n`);
            }
          } else {
            // Extract object info for single tap mode
            let objectInfo = null;
            if (singleTap) {
              const objectMatch = fullText.match(/OBJECT:\s*([^\n\r]+)/i);
              const descMatch = fullText.match(/DESCRIPTION:\s*([^\n\r]+)/i);
              if (objectMatch) {
                objectInfo = {
                  name: objectMatch[1].trim(),
                  description: descMatch ? descMatch[1].trim() : null
                };
              }
            }
            
            // Send regular completion for guidance mode or when Exa not available
            const completeData = {
              type: 'complete',
              fullText: fullText,
              mode: mode,
              singleTap: singleTap,
              objectInfo: objectInfo,
              timestamp: new Date().toISOString(),
              hasWebSearch: false
            };
            controller.enqueue(`data: ${JSON.stringify(completeData)}\n\n`);
          }

        } catch (error: unknown) {
          console.error('Error in streaming image analysis:', error);

          const errorMessage = error instanceof Error ? error.message : 'Unknown error';

          // Send error data
          let errorType = 'UNKNOWN_ERROR';
          let retryAfter = undefined;

          if (errorMessage.includes('429') || errorMessage.includes('Quota exceeded')) {
            errorType = 'RATE_LIMIT_EXCEEDED';
            retryAfter = 60;
          } else if (errorMessage.includes('403') || errorMessage.includes('API key')) {
            errorType = 'INVALID_API_KEY';
          } else if (errorMessage.includes('400') || errorMessage.includes('Bad Request')) {
            errorType = 'INVALID_IMAGE';
          }

          const errorData = {
            type: 'error',
            error: errorMessage.includes('429') ? 'API quota exceeded. Please wait a moment and try again.' :
              errorMessage.includes('403') ? 'Invalid API key. Please check your configuration.' :
                errorMessage.includes('400') ? 'Invalid image format. Please try again.' :
                  'Failed to analyze image. Please try again.',
            errorType: errorType,
            retryAfter: retryAfter
          };
          controller.enqueue(`data: ${JSON.stringify(errorData)}\n\n`);
        } finally {
          controller.close();
        }
      }
    });

    // Return streaming response with SSE headers
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });

  } catch (error: unknown) {
    console.error('Error in image analysis setup:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return new Response(
      JSON.stringify({
        error: 'Failed to process request. Please try again.',
        errorType: 'SETUP_ERROR'
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
} 
