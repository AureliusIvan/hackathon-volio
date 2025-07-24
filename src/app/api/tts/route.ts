import { NextRequest, NextResponse } from 'next/server';
import { ElevenLabsClient, play } from '@elevenlabs/elevenlabs-js';

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
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      console.error('ELEVENLABS_API_KEY not found in environment variables');
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }
    
    // Initialize ElevenLabs client
    const elevenlabs = new ElevenLabsClient({
      apiKey: apiKey
    });
    
    console.log('Using ElevenLabs TTS for:', text.substring(0, 50) + '...');
    console.log('Voice style:', voice, 'Speed:', speed);
    
    // Map voice styles to ElevenLabs voice IDs
    const voiceMap: { [key: string]: string } = {
      'default': 'jqcCZkN6Knx8BJ5TBdYR', // Zara - warm, friendly
      'warm': 'pNInz6obpgDQGcFmaJgB',    // Adam
      'friendly': 'EXAVITQu4vr4xnSDxMaL', // Bella - warm, friendly
      'professional': 'ErXwobaYiN019PkySvjV', // Antoni - well-rounded
      'calm': 'AZnzlk1XvdvUeBnXmlld',    // Domi - comforting
      'zepyhr': 'pNInz6obpgDQGcFmaJgB'   // Fallback to Adam
    };
    
    const voiceId = voiceMap[voice] || voiceMap['default'];
    
    // Generate TTS with ElevenLabs using streaming for faster response
    const audioStream = await elevenlabs.textToSpeech.convertAsStream(voiceId, {
      text: text,
      model_id: "eleven_flash_v2",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.5,
        use_speaker_boost: true
      },
      optimize_streaming_latency: 4, // Maximize streaming latency optimization
      output_format: "mp3_44100_128" // Optimized format for web
    });
    
    // Return streaming response directly
    return new Response(audioStream, {
      headers: { 
        'Content-Type': 'audio/mpeg',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache'
      }
    });
    
  } catch (error: unknown) {
    console.error('Error in ElevenLabs TTS generation:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Handle specific ElevenLabs errors
    if (errorMessage.includes('429') || errorMessage.includes('quota') || errorMessage.includes('rate limit')) {
      return NextResponse.json(
        { 
          error: 'ElevenLabs TTS quota exceeded. Please wait a moment and try again.',
          errorType: 'RATE_LIMIT_EXCEEDED',
          retryAfter: 60,
          fallback: true,
          text: requestText
        },
        { status: 429 }
      );
    }
    
    if (errorMessage.includes('401') || errorMessage.includes('403') || errorMessage.includes('API key')) {
      return NextResponse.json(
        { 
          error: 'Invalid ElevenLabs API key.',
          errorType: 'INVALID_API_KEY',
          fallback: true,
          text: requestText
        },
        { status: 403 }
      );
    }
    
    if (errorMessage.includes('voice_id')) {
      return NextResponse.json(
        { 
          error: 'Invalid voice ID for ElevenLabs TTS.',
          errorType: 'INVALID_VOICE',
          fallback: true,
          text: requestText
        },
        { status: 400 }
      );
    }
    
    // Generic error with fallback
    return NextResponse.json(
      { 
        error: 'ElevenLabs TTS generation failed, using browser fallback.',
        errorType: 'TTS_ERROR',
        fallback: true,
        text: requestText
      },
      { status: 500 }
    );
  }
}
