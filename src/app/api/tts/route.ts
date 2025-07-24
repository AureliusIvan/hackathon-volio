import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  let requestText = '';
  
  try {
    // Parse the request body
    const { text, voice = 'default', speed = 'normal' }: { 
      text: string; 
      voice?: string; 
      speed?: string; 
    } = await req.json();
    
    requestText = text; // Store for error handling
    
    // Input validation
    if (!text || typeof text !== 'string') {
      return NextResponse.json(
        { error: 'Invalid text data provided' },
        { status: 400 }
      );
    }
    
    // Check for API key
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      console.error('GOOGLE_API_KEY not found in environment variables');
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }
    
    // For now, since Gemini TTS API is in preview and TypeScript definitions 
    // aren't available yet, we'll return a fallback response
    // This allows the app to work with graceful degradation
    
    console.log('Gemini TTS requested for:', text.substring(0, 50) + '...');
    console.log('Voice style:', voice, 'Speed:', speed);
    
    // Simulate processing time for a more realistic experience
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Return fallback response indicating TTS should use Web Speech API
    // Once Gemini TTS API is fully available, this can be updated
    return NextResponse.json({ 
      text: text,
      fallback: true,
      message: 'Gemini TTS is in preview - using enhanced Web Speech API',
      voiceStyle: voice,
      speed: speed
    });
    
  } catch (error: unknown) {
    console.error('Error in TTS generation:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Handle specific errors similar to describe route
    if (errorMessage.includes('429') || errorMessage.includes('Quota exceeded')) {
      return NextResponse.json(
        { 
          error: 'TTS quota exceeded. Please wait a moment and try again.',
          errorType: 'RATE_LIMIT_EXCEEDED',
          retryAfter: 60,
          fallback: true,
          text: requestText
        },
        { status: 429 }
      );
    }
    
    if (errorMessage.includes('403') || errorMessage.includes('API key')) {
      return NextResponse.json(
        { 
          error: 'Invalid API key for TTS.',
          errorType: 'INVALID_API_KEY',
          fallback: true,
          text: requestText
        },
        { status: 403 }
      );
    }
    
    // Generic error with fallback
    return NextResponse.json(
      { 
        error: 'TTS generation failed, using browser fallback.',
        errorType: 'TTS_ERROR',
        fallback: true,
        text: requestText
      },
      { status: 500 }
    );
  }
}

/* 
 * Future implementation when Gemini TTS API is fully available:
 * 
 * import { GoogleGenerativeAI } from '@google/generative-ai';
 * 
 * try {
 *   // Initialize Gemini for TTS
 *   const genAI = new GoogleGenerativeAI(apiKey);
 *   const model = genAI.getGenerativeModel({ 
 *     model: "gemini-2.5-flash",
 *     generationConfig: {
 *       responseFormat: "audio/wav" // When available
 *     }
 *   });
 *   
 *   const prompt = `Generate natural speech with ${voice} voice style at ${speed} speed: "${text}"`;
 *   const result = await model.generateContent(prompt);
 *   
 *   // Handle audio response when API supports it
 *   if (result.response.audio) {
 *     return new Response(result.response.audio, {
 *       headers: { 'Content-Type': 'audio/wav' }
 *     });
 *   }
 * } catch (audioError) {
 *   // Fallback to Web Speech API
 * }
 */ 