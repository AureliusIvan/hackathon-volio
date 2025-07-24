import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function POST(req: NextRequest) {
  try {
    // Parse the request body
    const { image, userMessage }: { image: string; userMessage: string } = await req.json();
    
    // Input validation
    if (!image || typeof image !== 'string') {
      return NextResponse.json(
        { error: 'Invalid image data provided' },
        { status: 400 }
      );
    }
    
    if (!userMessage || typeof userMessage !== 'string') {
      return NextResponse.json(
        { error: 'Invalid user message provided' },
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
    
    // Create conversation prompt
    const prompt = `You are NaraNetra, an AI assistant for the visually impaired. You are in CONVERSATION MODE.

The user has spoken to you and said: "${userMessage}"

You can see what they're looking at through their camera. Based on both their question/comment and what you can see in the image, provide a helpful, conversational response.

Guidelines:
1. Respond naturally to their spoken message
2. Reference what you can see in the image when relevant
3. Be helpful, friendly, and conversational
4. If they're asking about something specific in the image, provide detailed information
5. If they're asking for help with navigation or tasks, use the visual context to assist
6. Keep responses concise but informative
7. If you can't see something they're asking about, let them know and suggest alternatives

Remember: You're having a conversation, not just describing an image. Respond to what they said while using the visual context to be more helpful.`;
    
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
    
    // Return the conversation response
    return NextResponse.json({ 
      response: text.trim(),
      userMessage: userMessage,
      timestamp: new Date().toISOString()
    });
    
  } catch (error: unknown) {
    console.error('Error in conversation:', error);
    
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
          error: 'Invalid input format. Please try again.',
          errorType: 'INVALID_INPUT'
        },
        { status: 400 }
      );
    }
    
    // Generic error
    return NextResponse.json(
      { 
        error: 'Failed to process conversation. Please try again.',
        errorType: 'UNKNOWN_ERROR'
      },
      { status: 500 }
    );
  }
} 