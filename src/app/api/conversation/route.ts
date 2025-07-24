import { NextRequest } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { answerImageQuestion, searchSpecificTopic, isExaAvailable } from '../../../utils/exa';

export async function POST(req: NextRequest) {
  try {
    // Parse the request body
    const { image, userMessage }: { image: string; userMessage: string } = await req.json();
    
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
    
    if (!userMessage || typeof userMessage !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Invalid user message provided' }),
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
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    
    // Determine if web search might be helpful
    const needsWebSearch = isExaAvailable() && (
      userMessage.toLowerCase().includes('what is') ||
      userMessage.toLowerCase().includes('tell me about') ||
      userMessage.toLowerCase().includes('information about') ||
      userMessage.toLowerCase().includes('how does') ||
      userMessage.toLowerCase().includes('how to') ||
      userMessage.toLowerCase().includes('where can i') ||
      userMessage.toLowerCase().includes('when was') ||
      userMessage.toLowerCase().includes('who made') ||
      userMessage.toLowerCase().includes('latest') ||
      userMessage.toLowerCase().includes('current') ||
      userMessage.toLowerCase().includes('recent')
    );

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
    
    // Create streaming response
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Send initial metadata
          const initialData = {
            type: 'start',
            userMessage: userMessage,
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
                userMessage: userMessage
              };
              controller.enqueue(`data: ${JSON.stringify(chunkData)}\n\n`);
            }
          }
          
          // Enhanced response with web search if needed
          if (needsWebSearch) {
            try {
              // Send web search status
              const searchStatusData = {
                type: 'web_search_start',
                message: 'Searching for additional information...'
              };
              controller.enqueue(`data: ${JSON.stringify(searchStatusData)}\n\n`);

              // Try to get specific information based on the question
              let webInfo = null;
              
              // First, try to answer the question directly
              webInfo = await answerImageQuestion(userMessage, fullText);
              
              // If that doesn't work, try searching for specific topics
              if (!webInfo) {
                // Extract key terms from the user message for search
                const searchTerms = userMessage
                  .toLowerCase()
                  .replace(/what is|tell me about|information about|how does|how to/g, '')
                  .trim();
                
                if (searchTerms.length > 2) {
                  const searchResults = await searchSpecificTopic(searchTerms, 'current information');
                  if (searchResults && searchResults.results.length > 0) {
                    webInfo = searchResults.results[0].summary || 
                             searchResults.results[0].text?.substring(0, 300);
                  }
                }
              }

              if (webInfo) {
                // Send web search results
                const webSearchData = {
                  type: 'web_search_results',
                  searchQuery: userMessage,
                  webInfo: webInfo
                };
                controller.enqueue(`data: ${JSON.stringify(webSearchData)}\n\n`);

                // Create enhanced response
                const enhancedResponse = `${fullText}\n\nLatest Information: ${webInfo}`;
                
                // Send enhanced completion data
                const enhancedCompleteData = {
                  type: 'complete',
                  response: enhancedResponse,
                  originalResponse: fullText,
                  webInfo: webInfo,
                  userMessage: userMessage,
                  timestamp: new Date().toISOString(),
                  hasWebSearch: true
                };
                controller.enqueue(`data: ${JSON.stringify(enhancedCompleteData)}\n\n`);
              } else {
                // Send regular completion if no useful web info
                const completeData = {
                  type: 'complete',
                  response: fullText,
                  userMessage: userMessage,
                  timestamp: new Date().toISOString(),
                  hasWebSearch: false
                };
                controller.enqueue(`data: ${JSON.stringify(completeData)}\n\n`);
              }
            } catch (searchError) {
              console.error('Conversation web search error:', searchError);
              // Send regular completion on search error
              const completeData = {
                type: 'complete',
                response: fullText,
                userMessage: userMessage,
                timestamp: new Date().toISOString(),
                hasWebSearch: false
              };
              controller.enqueue(`data: ${JSON.stringify(completeData)}\n\n`);
            }
          } else {
            // Send regular completion when web search not needed
            const completeData = {
              type: 'complete',
              response: fullText,
              userMessage: userMessage,
              timestamp: new Date().toISOString(),
              hasWebSearch: false
            };
            controller.enqueue(`data: ${JSON.stringify(completeData)}\n\n`);
          }
          
        } catch (error: unknown) {
          console.error('Error in streaming conversation:', error);
          
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
            errorType = 'INVALID_INPUT';
          }
          
          const errorData = {
            type: 'error',
            error: errorMessage.includes('429') ? 'API quota exceeded. Please wait a moment and try again.' :
                   errorMessage.includes('403') ? 'Invalid API key. Please check your configuration.' :
                   errorMessage.includes('400') ? 'Invalid input format. Please try again.' :
                   'Failed to process conversation. Please try again.',
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
    console.error('Error in conversation setup:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return new Response(
      JSON.stringify({ 
        error: 'Failed to process conversation request. Please try again.',
        errorType: 'SETUP_ERROR'
      }),
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
} 