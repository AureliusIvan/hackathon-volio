import { NextRequest } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { searchImageTopics, isExaAvailable } from '../../../utils/exa';

export async function POST(req: NextRequest) {
  try {
    // Parse the request body
    const { image, mode = 'narration' }: { image: string; mode?: 'narration' | 'guidance' } = await req.json();

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

    // Initialize Gemini
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.0-flash",
    });

    // Prepare mode-specific prompts
    let prompt: string;

    if (mode === 'narration') {
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
    } else {
      prompt = `
# ROLE: NaraNetra Guidance Mode  
You will guide the user using phone back camera.

TASK: In max 1 short sentences, tell the user:

# IF THERE is danger/obstacle/people around 5m
## FORMAT: beware, {action} {explanation}.
- action can only be GO LEFT, GO RIGHT, or STOP
## Example: 
"beware, GO Left, there is large Pilar in 5m",
"beware, GO Right, there are people in front of you",

# IF path is clear and NOTHING BLOCK
## FORMAT: 
safe, {explanation}
## EXAMPLE: 
"safe, there is door in 5 meters",

# (ELSE) IF YOU ARE UNSURE/IMAGE BLUR
"stop, I can't see clearly"
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
                mode: mode
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
                message: 'Searching for additional information...'
              };
              controller.enqueue(`data: ${JSON.stringify(searchStatusData)}\n\n`);

              // Perform web search based on image description
              const searchResults = await searchImageTopics(fullText, mode);
              
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
                  
                  // Send enhanced complete data
                  const enhancedCompleteData = {
                    type: 'complete',
                    fullText: enhancedText,
                    originalText: fullText,
                    webInfo: webInfo,
                    mode: mode,
                    timestamp: new Date().toISOString(),
                    hasWebSearch: true
                  };
                  controller.enqueue(`data: ${JSON.stringify(enhancedCompleteData)}\n\n`);
                } else {
                  // Send regular completion if no useful web info
                  const completeData = {
                    type: 'complete',
                    fullText: fullText,
                    mode: mode,
                    timestamp: new Date().toISOString(),
                    hasWebSearch: false
                  };
                  controller.enqueue(`data: ${JSON.stringify(completeData)}\n\n`);
                }
              } else {
                // Send regular completion if no search results
                const completeData = {
                  type: 'complete',
                  fullText: fullText,
                  mode: mode,
                  timestamp: new Date().toISOString(),
                  hasWebSearch: false
                };
                controller.enqueue(`data: ${JSON.stringify(completeData)}\n\n`);
              }
            } catch (searchError) {
              console.error('Web search error:', searchError);
              // Send regular completion on search error
              const completeData = {
                type: 'complete',
                fullText: fullText,
                mode: mode,
                timestamp: new Date().toISOString(),
                hasWebSearch: false
              };
              controller.enqueue(`data: ${JSON.stringify(completeData)}\n\n`);
            }
          } else {
            // Send regular completion for guidance mode or when Exa not available
            const completeData = {
              type: 'complete',
              fullText: fullText,
              mode: mode,
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
