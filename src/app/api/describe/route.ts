import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function POST(req: NextRequest) {
  try {
    // Parse the request body
    const { image }: { image: string } = await req.json();
    
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
    
    // Prepare the prompt
    const prompt = "You are NaraNetra, an assistant for the visually impaired. In one short, direct sentence, describe the primary subject of this image. Be objective and clear. Example: 'A person is walking a dog on a sidewalk.'";
    
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
    
    // Return the description
    return NextResponse.json({ description: text.trim() });
    
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