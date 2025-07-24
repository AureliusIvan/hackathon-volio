interface TTSResponse {
  text?: string;
  fallback?: boolean;
  message?: string;
  error?: string;
  errorType?: string;
}

// Global speech state management
let isSpeaking = false;
let speechCallbacks: (() => void)[] = [];

// Speech state management functions
export function getIsSpeaking(): boolean {
  return isSpeaking;
}

export function addSpeechEndCallback(callback: () => void): void {
  speechCallbacks.push(callback);
}

export function clearSpeechEndCallbacks(): void {
  speechCallbacks = [];
}

function setSpeechState(speaking: boolean): void {
  console.log(`[Speech] State changed: ${speaking ? 'SPEAKING' : 'IDLE'}`);
  isSpeaking = speaking;
  
  if (!speaking) {
    // Execute all callbacks when speech ends
    const callbacks = [...speechCallbacks];
    speechCallbacks = [];
    callbacks.forEach(callback => {
      try {
        callback();
      } catch (error) {
        console.error('[Speech] Callback error:', error);
      }
    });
  }
}

// Enhanced speak function with Gemini TTS support
export async function speak(text: string, options: { 
  voice?: string; 
  speed?: string; 
  forceWebTTS?: boolean;
  priority?: 'low' | 'normal' | 'high';
} = {}): Promise<void> {
  const { voice = 'zepyhr', speed = 'fast', forceWebTTS = false, priority = 'normal' } = options;
  
  console.log(`[Speech] Starting speech with priority ${priority}: "${text.substring(0, 50)}..."`);
  
  // Set speaking state at the beginning
  setSpeechState(true);
  
  // Cancel any currently speaking utterance
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  
  // Stop any currently playing audio
  const existingAudio = document.getElementById('gemini-tts-audio') as HTMLAudioElement;
  if (existingAudio) {
    existingAudio.pause();
    existingAudio.remove();
  }
  
  // Skip Gemini TTS if forced to use Web TTS or if text is too short
  if (forceWebTTS || text.length < 10) {
    return speakWithWebTTS(text, speed);
  }
  
  try {
    // Try Gemini TTS first
    const response = await fetch('/api/tts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, voice, speed }),
    });
    
    if (response.ok) {
      const contentType = response.headers.get('content-type');
      
      // If we got audio data
      if (contentType?.includes('audio/')) {
        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        
        return new Promise((resolve, reject) => {
          const audio = new Audio(audioUrl);
          audio.id = 'gemini-tts-audio';
          
          audio.onended = () => {
            console.log('[Speech] Gemini TTS audio ended');
            URL.revokeObjectURL(audioUrl);
            setSpeechState(false);
            resolve();
          };
          
          audio.onerror = (error) => {
            console.error('Audio playback error:', error);
            URL.revokeObjectURL(audioUrl);
            setSpeechState(false);
            // Fallback to Web TTS
            speakWithWebTTS(text, speed).then(resolve).catch(reject);
          };
          
          // Add to DOM temporarily to ensure playback
          audio.style.display = 'none';
          document.body.appendChild(audio);
          
          audio.play().catch(error => {
            console.error('Failed to play Gemini TTS audio:', error);
            document.body.removeChild(audio);
            URL.revokeObjectURL(audioUrl);
            setSpeechState(false);
            // Fallback to Web TTS
            speakWithWebTTS(text, speed).then(resolve).catch(reject);
          });
        });
      } else {
        // If we got a JSON response (fallback indicated)
        const data: TTSResponse = await response.json();
        if (data.fallback) {
          console.log('Gemini TTS fallback:', data.message);
          setSpeechState(false);
          return speakWithWebTTS(text, speed);
        }
      }
    } else {
      // Handle error responses
      const errorData: TTSResponse = await response.json();
      console.warn('Gemini TTS error:', errorData.error);
      
      // For rate limits, we might want to show a message
      if (errorData.errorType === 'RATE_LIMIT_EXCEEDED') {
        console.log('TTS rate limit hit, using Web TTS');
      }
      
      setSpeechState(false);
      return speakWithWebTTS(text, speed);
    }
  } catch (error) {
    console.error('Gemini TTS request failed:', error);
    setSpeechState(false);
    return speakWithWebTTS(text, speed);
  }
  
  // Default fallback
  setSpeechState(false);
  return speakWithWebTTS(text, speed);
}

// Original Web Speech API implementation as fallback
function speakWithWebTTS(text: string, speed: string = 'fast'): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!window.speechSynthesis) {
      console.error('Speech synthesis not supported');
      setSpeechState(false);
      reject(new Error('Speech synthesis not supported'));
      return;
    }
    
    console.log('[Speech] Using Web TTS fallback');
    setSpeechState(true);
    
    // Cancel any currently speaking utterance
    window.speechSynthesis.cancel();
    
    // Create a new utterance instance
    const utterance = new SpeechSynthesisUtterance(text);
    
    // Set language for better pronunciation
    utterance.lang = 'en-US';
    
    // Set speech rate based on speed parameter
    switch (speed) {
      case 'slow':
        utterance.rate = 0.7;
        break;
      case 'fast':
        utterance.rate = 1.2;
        break;
      default:
        utterance.rate = 0.9;
    }
    
    utterance.volume = 1.0;
    
    // Handle completion
    utterance.onend = () => {
      console.log('[Speech] Web TTS ended');
      setSpeechState(false);
      resolve();
    };
    utterance.onerror = (error) => {
      console.error('Web TTS error:', error);
      setSpeechState(false);
      reject(error);
    };
    
    // Execute the speech
    window.speechSynthesis.speak(utterance);
  });
}

// Utility function to check if Gemini TTS is available
export async function isGeminiTTSAvailable(): Promise<boolean> {
  try {
    const response = await fetch('/api/tts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: 'test' }),
    });
    
    if (response.ok) {
      const contentType = response.headers.get('content-type');
      
      // If we get audio content, TTS is available
      if (contentType?.includes('audio/')) {
        return true;
      }
      
      // If we get JSON, check fallback flag
      const data = await response.json();
      return !data.fallback;
    }
    
    return false;
  } catch {
    return false;
  }
}

// Function to cancel all ongoing speech
export function cancelAllSpeech(): void {
  console.log('[Speech] Cancelling all speech');
  
  // Cancel Web Speech API
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  
  // Stop Gemini TTS audio
  const existingAudio = document.getElementById('gemini-tts-audio') as HTMLAudioElement;
  if (existingAudio) {
    existingAudio.pause();
    existingAudio.remove();
  }
  
  // Clear speech state and callbacks
  setSpeechState(false);
  clearSpeechEndCallbacks();
}

// Legacy function for backward compatibility
export { speak as default };

// Speech Recognition functionality removed - no longer needed

// Function to play a short ring sound for recording feedback
export function playRingSound(type: 'start' | 'end' = 'start'): void {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    // Create oscillator for the ring sound
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    // Connect nodes
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    // Configure the ring sound
    oscillator.frequency.value = type === 'start' ? 800 : 600; // Higher pitch for start, lower for end
    oscillator.type = 'sine';
    
    // Set volume envelope for a pleasant ring
    gainNode.gain.setValueAtTime(0, audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.3, audioContext.currentTime + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
    
    // Play the sound
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.3);
    
  } catch (error) {
    console.error('Failed to play ring sound:', error);
    // Silent fallback - no sound if Web Audio API fails
  }
} 