interface TTSResponse {
  text?: string;
  fallback?: boolean;
  message?: string;
  error?: string;
  errorType?: string;
}

// Enhanced speak function with Gemini TTS support
export async function speak(text: string, options: { 
  voice?: string; 
  speed?: string; 
  forceWebTTS?: boolean;
} = {}): Promise<void> {
  const { voice = 'default', speed = 'fast', forceWebTTS = false } = options;
  
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
            URL.revokeObjectURL(audioUrl);
            resolve();
          };
          
          audio.onerror = (error) => {
            console.error('Audio playback error:', error);
            URL.revokeObjectURL(audioUrl);
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
            // Fallback to Web TTS
            speakWithWebTTS(text, speed).then(resolve).catch(reject);
          });
        });
      } else {
        // If we got a JSON response (fallback indicated)
        const data: TTSResponse = await response.json();
        if (data.fallback) {
          console.log('Gemini TTS fallback:', data.message);
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
      
      return speakWithWebTTS(text, speed);
    }
  } catch (error) {
    console.error('Gemini TTS request failed:', error);
    return speakWithWebTTS(text, speed);
  }
  
  // Default fallback
  return speakWithWebTTS(text, speed);
}

// Original Web Speech API implementation as fallback
function speakWithWebTTS(text: string, speed: string = 'fast'): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!window.speechSynthesis) {
      console.error('Speech synthesis not supported');
      reject(new Error('Speech synthesis not supported'));
      return;
    }
    
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
    utterance.onend = () => resolve();
    utterance.onerror = (error) => {
      console.error('Web TTS error:', error);
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
      const data = await response.json();
      return !data.fallback;
    }
    
    return false;
  } catch {
    // Removed unused error parameter
    return false;
  }
}

// Legacy function for backward compatibility
export { speak as default };

// Speech Recognition functionality for AI conversation
export class SpeechRecognition {
  private recognition: any = null;
  private isRecording = false;
  private onResultCallback: ((transcript: string) => void) | null = null;
  private onErrorCallback: ((error: string) => void) | null = null;

  constructor() {
    // Check for browser support
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (SpeechRecognition) {
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = 'en-US';
      
      this.recognition.onresult = (event: any) => {
        let finalTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript;
          }
        }
        
        if (finalTranscript && this.onResultCallback) {
          this.onResultCallback(finalTranscript.trim());
        }
      };
      
      this.recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        if (this.onErrorCallback) {
          this.onErrorCallback(event.error);
        }
      };
      
      this.recognition.onend = () => {
        this.isRecording = false;
      };
    }
  }

  public isSupported(): boolean {
    return this.recognition !== null;
  }

  public startRecording(
    onResult: (transcript: string) => void,
    onError: (error: string) => void
  ): boolean {
    if (!this.recognition || this.isRecording) {
      return false;
    }

    this.onResultCallback = onResult;
    this.onErrorCallback = onError;
    
    try {
      this.recognition.start();
      this.isRecording = true;
      return true;
    } catch (error) {
      console.error('Failed to start speech recognition:', error);
      return false;
    }
  }

  public stopRecording(): void {
    if (this.recognition && this.isRecording) {
      this.recognition.stop();
      this.isRecording = false;
    }
  }

  public getRecordingState(): boolean {
    return this.isRecording;
  }
}

// Utility function to create a speech recognition instance
export function createSpeechRecognition(): SpeechRecognition {
  return new SpeechRecognition();
}

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