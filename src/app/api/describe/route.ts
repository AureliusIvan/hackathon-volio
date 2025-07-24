import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function POST(req: NextRequest) {
  try {
    // Parse the request body
    const { image, mode = 'narration' }: { image: string; mode?: 'narration' | 'guidance' } = await req.json();
    
    // Input validation
    if (!image || typeof image !== 'string') {
      return NextResponse.json(
        { error: 'Invalid image data provided' },
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
    
    // Initialize Gemini
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    
    // Prepare mode-specific prompts
    let prompt: string;
    
    if (mode === 'narration') {
      prompt = `You are NaraNetra, an assistant for the visually impaired. You are in NARRATION MODE.

Analyze this image and provide a comprehensive, detailed description that includes:
1. The main object or subject in the image
2. Cultural significance, historical context, or interesting facts about what you see
3. Visual details like colors, textures, materials, and design elements
4. Any text, logos, or writing visible
5. The setting or environment where this is located

Be educational and informative. If you recognize specific objects, brands, landmarks, or cultural items, share relevant knowledge about them. Make it engaging and informative for someone who cannot see the image.

Format your response as a flowing, conversational explanation that would help someone understand both what they're looking at and learn something interesting about it.`;
    } else {
      prompt = `You are NaraNetra, an assistant for the visually impaired. You are in GUIDANCE MODE.

Analyze this image for navigation and spatial awareness. Provide a brief, practical description that includes:
1. What's directly ahead or in the path
2. Any obstacles, steps, or changes in terrain
3. Doorways, passages, or directional guidance
4. Safety considerations (wet floors, stairs, etc.)
5. Orientation hints (walls, corners, open spaces)

Keep your response SHORT and focused on immediate navigation needs. Be direct and actionable for someone moving through this space.

Example format: "Clear path ahead with a doorway on the right. Steps begin in 3 feet. Wall continues on your left."`;
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
    
    // Make the API call to Gemini
    const result = await model.generateContent([prompt, imagePart]);
    const response = result.response;
    const text = response.text();
    
    // For future EXA integration in narration mode
    if (mode === 'narration') {
      // TODO: Add EXA search for additional context
      // This is where we would search for more detailed information
      // about objects, landmarks, or cultural items identified in the image
      
      // Placeholder for enhanced description
      console.log('Narration mode - detailed analysis requested');
    }
    
    // Return the description with mode information
    return NextResponse.json({ 
      description: text.trim(),
      mode: mode,
      timestamp: new Date().toISOString()
    });
    
  } catch (error: unknown) {
    console.error('Error in image analysis:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Handle specific Google AI API errors
    if (errorMessage.includes('429') || errorMessage.includes('Quota exceeded')) {
      return NextResponse.json(
        { 
          error: 'API quota exceeded. Please wait a moment and try again.',
          errorType: 'RATE_LIMIT_EXCEEDED',
          retryAfter: 60 // seconds
        },
        { status: 429 }
      );
    }
    
    if (errorMessage.includes('403') || errorMessage.includes('API key')) {
      return NextResponse.json(
        { 
          error: 'Invalid API key. Please check your configuration.',
          errorType: 'INVALID_API_KEY'
        },
        { status: 403 }
      );
    }
    
    if (errorMessage.includes('400') || errorMessage.includes('Bad Request')) {
      return NextResponse.json(
        { 
          error: 'Invalid image format. Please try again.',
          errorType: 'INVALID_IMAGE'
        },
        { status: 400 }
      );
    }
    
    // Generic error
    return NextResponse.json(
      { 
        error: 'Failed to analyze image. Please try again.',
        errorType: 'UNKNOWN_ERROR'
      },
      { status: 500 }
    );
  }
} 