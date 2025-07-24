import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

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
    
    // Initialize Gemini with TTS model
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash-preview-tts",
    });
    
    console.log('Using Gemini 2.5 Flash Preview TTS for:', text.substring(0, 50) + '...');
    console.log('Voice style:', voice, 'Speed:', speed);
    
    // Generate TTS with Gemini
    const voicePrompt = voice === 'default' ? 'warm and friendly' : voice;
    const speedPrompt = speed === 'fast' ? 'at a slightly faster pace' : 
                       speed === 'slow' ? 'at a slower, more deliberate pace' : 
                       'at a normal speaking pace';
    
    const prompt = `Generate natural speech audio with a ${voicePrompt} voice ${speedPrompt} for the following text: "${text}"`;
    const result = await model.generateContent(prompt);
    
    // Check if we got audio data back
    if (result.response && result.response.candidates && result.response.candidates[0]) {
      const candidate = result.response.candidates[0];
      
      // If audio data is available, return it
      if (candidate.content && candidate.content.parts) {
        for (const part of candidate.content.parts) {
          if (part.inlineData && part.inlineData.mimeType?.startsWith('audio/')) {
            const audioBuffer = Buffer.from(part.inlineData.data, 'base64');
            return new Response(audioBuffer, {
              headers: { 
                'Content-Type': part.inlineData.mimeType,
                'Content-Length': audioBuffer.length.toString()
              }
            });
          }
        }
      }
    }
    
    // If no audio data, fallback to Web Speech API
    return NextResponse.json({ 
      text: text,
      fallback: true,
      message: 'Gemini TTS response received but no audio data - using Web Speech API',
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
