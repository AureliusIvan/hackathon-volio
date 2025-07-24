import Exa from 'exa-js';

interface ExaSearchResult {
  title: string;
  url: string;
  text?: string;
  summary?: string;
  publishedDate?: string;
  author?: string;
  score: number;
}

interface ExaSearchResponse {
  results: ExaSearchResult[];
  searchQuery: string;
  totalResults: number;
}

// Initialize Exa client
function getExaClient(): Exa | null {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    console.warn('EXA_API_KEY not found in environment variables');
    return null;
  }
  return new Exa(apiKey);
}

// Extract searchable entities and topics from image description
export function extractSearchableTopics(description: string): string[] {
  const topics: string[] = [];
  
  // Common patterns to extract
  const patterns = [
    // Products and brands
    /(?:I can see|showing|displaying|features?)\s+(?:a|an|the)?\s*([A-Z][a-zA-Z\s]+(?:brand|product|device|tool|equipment|machine))/gi,
    // Locations and places
    /(?:in|at|near|from)\s+([A-Z][a-zA-Z\s]+(?:city|country|place|location|building|landmark))/gi,
    // Objects and items
    /(?:a|an|the)\s+([a-zA-Z\s]+)(?:\s+(?:appears|looks|seems|is))/gi,
    // Specific nouns (capitalized)
    /\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)\b/g,
  ];

  patterns.forEach(pattern => {
    const matches = description.matchAll(pattern);
    for (const match of matches) {
      if (match[1] && match[1].length > 2) {
        topics.push(match[1].trim());
      }
    }
  });

  // Remove duplicates and filter out common words
  const commonWords = ['image', 'photo', 'picture', 'view', 'scene', 'area', 'part', 'section', 'people', 'person', 'man', 'woman', 'thing', 'item'];
  const uniqueTopics = [...new Set(topics)]
    .filter(topic => !commonWords.includes(topic.toLowerCase()))
    .filter(topic => topic.length > 2)
    .slice(0, 5); // Limit to top 5 topics

  return uniqueTopics;
}

// Generate search queries from image description
export function generateSearchQueries(description: string, mode: 'narration' | 'guidance'): string[] {
  const topics = extractSearchableTopics(description);
  const queries: string[] = [];

  if (mode === 'narration') {
    // For narration, search for general information about objects/topics
    topics.forEach(topic => {
      queries.push(`what is ${topic}`);
      queries.push(`${topic} information facts`);
      queries.push(`${topic} uses applications`);
    });
  } else {
    // For guidance, search for navigation and practical information
    topics.forEach(topic => {
      queries.push(`${topic} directions navigation`);
      queries.push(`how to use ${topic}`);
      queries.push(`${topic} location finder`);
    });
  }

  return queries.slice(0, 3); // Limit to 3 most relevant queries
}

// Search for information about topics found in the image
export async function searchImageTopics(description: string, mode: 'narration' | 'guidance' = 'narration'): Promise<ExaSearchResponse | null> {
  const exa = getExaClient();
  if (!exa) {
    return null;
  }

  try {
    const queries = generateSearchQueries(description, mode);
    
    if (queries.length === 0) {
      return null;
    }

    // Use the most relevant query
    const primaryQuery = queries[0];
    
    const response = await exa.searchAndContents(primaryQuery, {
      type: 'auto',
      numResults: 3,
      text: true,
      summary: {
        query: mode === 'narration' ? 'key facts and information' : 'practical usage and navigation'
      }
    });

    const results: ExaSearchResult[] = response.results.map((result: any) => ({
      title: result.title,
      url: result.url,
      text: result.text,
      summary: result.summary,
      publishedDate: result.publishedDate,
      author: result.author,
      score: result.score
    }));

    return {
      results,
      searchQuery: primaryQuery,
      totalResults: results.length
    };

  } catch (error) {
    console.error('Exa search error:', error);
    return null;
  }
}

// Search for specific information about an object or topic
export async function searchSpecificTopic(topic: string, context?: string): Promise<ExaSearchResponse | null> {
  const exa = getExaClient();
  if (!exa) {
    return null;
  }

  try {
    const query = context ? `${topic} ${context}` : `${topic} information facts`;
    
    const response = await exa.searchAndContents(query, {
      type: 'auto',
      numResults: 4,
      text: true,
      summary: {
        query: 'key information and facts'
      }
    });

    const results: ExaSearchResult[] = response.results.map((result: any) => ({
      title: result.title,
      url: result.url,
      text: result.text,
      summary: result.summary,
      publishedDate: result.publishedDate,
      author: result.author,
      score: result.score
    }));

    return {
      results,
      searchQuery: query,
      totalResults: results.length
    };

  } catch (error) {
    console.error('Exa specific search error:', error);
    return null;
  }
}

// Answer a specific question about what's shown in the image
export async function answerImageQuestion(question: string, imageDescription: string): Promise<string | null> {
  const exa = getExaClient();
  if (!exa) {
    return null;
  }

  try {
    // Combine the question with image context for better search
    const contextualQuery = `${question} ${imageDescription}`;
    
    const response = await exa.searchAndContents(contextualQuery, {
      type: 'auto',
      numResults: 3,
      text: true,
      summary: {
        query: question
      }
    });

    if (response.results.length === 0) {
      return null;
    }

    // Combine summaries from top results
    const summaries = response.results
      .filter((result: any) => result.summary)
      .map((result: any) => result.summary)
      .join(' ');

    return summaries || null;

  } catch (error) {
    console.error('Exa answer error:', error);
    return null;
  }
}

// Check if Exa is available and configured
export function isExaAvailable(): boolean {
  return !!process.env.EXA_API_KEY;
} 