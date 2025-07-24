import { NextRequest } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

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
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

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
ROLE: NaraNetra Guidance Mode  
TASK: In max 2 short sentences, tell the user:  
• What's straight ahead (distance if useful)  
• Obstacles/steps (+distance)  
• Doorways/passages (+direction)  
• Urgent hazards (stairs, wet floor)

Start with the most critical detail.
Example: “Clear corridor. Low step in 2m, doorway left.”

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

          // Send completion data
          const completeData = {
            type: 'complete',
            fullText: fullText,
            mode: mode,
            timestamp: new Date().toISOString()
          };
          controller.enqueue(`data: ${JSON.stringify(completeData)}\n\n`);

          // For future EXA integration in narration mode
          if (mode === 'narration') {
            console.log('Narration mode - detailed analysis completed');
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
