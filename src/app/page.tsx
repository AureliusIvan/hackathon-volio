'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import LoadingSpinner from '../components/LoadingSpinner';
import { speak, isGeminiTTSAvailable, createSpeechRecognition, SpeechRecognition, playRingSound } from '../utils/speech';
import { generateImageHash, areImagesSimilar } from '../utils/imageHash';

interface Description {
  text: string;
  timestamp: Date;
  mode: 'narration' | 'guidance';
}

type AppMode = 'narration' | 'guidance';

export default function CameraView() {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isCameraReady, setIsCameraReady] = useState<boolean>(false);
  const [retryCount, setRetryCount] = useState<number>(0);
  const [currentDescription, setCurrentDescription] = useState<Description | null>(null);
  const [descriptionHistory, setDescriptionHistory] = useState<Description[]>([]);
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [showTTSControls, setShowTTSControls] = useState<boolean>(false);
  const [ttsSettings, setTtsSettings] = useState({
    useGeminiTTS: true,
    voice: 'default',
    speed: 'normal'
  });
  const [geminiTTSAvailable, setGeminiTTSAvailable] = useState<boolean>(false);

  // New mode system states
  const [currentMode, setCurrentMode] = useState<AppMode>('narration');
  const [focusTimer, setFocusTimer] = useState<number>(0);
  const [isHoldingToTalk, setIsHoldingToTalk] = useState<boolean>(false);
  const [holdTimer, setHoldTimer] = useState<number>(0);
  
  // Speech recognition states
  const [speechRecognition, setSpeechRecognition] = useState<SpeechRecognition | null>(null);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordedTranscript, setRecordedTranscript] = useState<string>('');

  // Image similarity and caching states
  const [lastImageHash, setLastImageHash] = useState<string>('');
  const [imageCache, setImageCache] = useState<Map<string, Description>>(new Map());
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const focusTimerRef = useRef<NodeJS.Timeout | null>(null);
  const guidanceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const holdTimerRef = useRef<NodeJS.Timeout | null>(null);
  const holdStartTimeRef = useRef<number>(0);

  // Memoized speech function to avoid dependency warnings
  const speakWithSettings = useCallback(async (text: string, options: { forceWebTTS?: boolean } = {}) => {
    return speak(text, {
      forceWebTTS: options.forceWebTTS || !ttsSettings.useGeminiTTS,
      voice: ttsSettings.voice,
      speed: ttsSettings.speed
    });
  }, [ttsSettings.useGeminiTTS, ttsSettings.voice, ttsSettings.speed]);


  // Helper function to capture image (optimized for speed)
  const captureImage = useCallback(async (): Promise<string | null> => {
    const canvas = canvasRef.current;
    const video = videoRef.current;

    if (!canvas || !video) {
      throw new Error('Camera components not ready');
    }

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Cannot get canvas context');
    }

    // Optimize dimensions for faster processing (max 400x300)
    const maxWidth = 400;
    const maxHeight = 300;
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    
    // Calculate scaled dimensions maintaining aspect ratio
    let targetWidth = videoWidth;
    let targetHeight = videoHeight;
    
    if (videoWidth > maxWidth || videoHeight > maxHeight) {
      const aspectRatio = videoWidth / videoHeight;
      
      if (videoWidth > videoHeight) {
        targetWidth = maxWidth;
        targetHeight = maxWidth / aspectRatio;
      } else {
        targetHeight = maxHeight;
        targetWidth = maxHeight * aspectRatio;
      }
    }

    // Set optimized canvas dimensions
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    // Draw current video frame with scaling
    context.drawImage(video, 0, 0, targetWidth, targetHeight);

    // Convert to Base64 JPEG with optimized quality for speed
    return canvas.toDataURL('image/jpeg', 0.5);
  }, []);

  // Helper function for streaming analysis
  const streamAnalysis = useCallback(async (
    imageDataUrl: string, 
    mode: 'narration' | 'guidance'
  ): Promise<Description> => {
    return new Promise((resolve, reject) => {
      const eventSource = new EventSource('/api/describe');
      let fullText = '';
      let hasStartedSpeaking = false;
      let firstChunk = '';
      let currentDescription: Description | null = null;

      // Send the request data via POST (we'll modify this approach)
      fetch('/api/describe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image: imageDataUrl,
          mode: mode
        }),
      }).then(response => {
        if (!response.ok) {
          throw new Error('Network response was not ok');
        }
        return response.body;
      }).then(body => {
        if (!body) {
          throw new Error('No response body');
        }

        const reader = body.getReader();
        const decoder = new TextDecoder();

        const readStream = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              
              if (done) break;
              
              const chunk = decoder.decode(value);
              const lines = chunk.split('\n');
              
              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  try {
                    const data = JSON.parse(line.slice(6));
                    
                    if (data.type === 'start') {
                      // Analysis started - no announcement needed
                    } else if (data.type === 'chunk') {
                      fullText = data.fullText;
                      
                      // Start speaking after we have a meaningful chunk (≥30 chars)
                      if (!hasStartedSpeaking && fullText.length >= 30) {
                        hasStartedSpeaking = true;
                        // Start speaking the first chunk
                        speakWithSettings(fullText);
                      }
                      
                      // Update current description for live display
                      currentDescription = {
                        text: fullText,
                        timestamp: new Date(),
                        mode: mode
                      };
                      setCurrentDescription(currentDescription);
                      
                    } else if (data.type === 'complete') {
                      // Analysis complete
                      const finalDescription: Description = {
                        text: data.fullText,
                        timestamp: new Date(),
                        mode: mode
                      };
                      
                      // If we haven't started speaking yet, speak the full text
                      if (!hasStartedSpeaking) {
                        await speakWithSettings(data.fullText);
                      }
                      
                      resolve(finalDescription);
                      return;
                    } else if (data.type === 'error') {
                      setError(data.error);
                      await speakWithSettings(data.error);
                      reject(new Error(data.error));
                      return;
                    }
                  } catch (parseError) {
                    console.error('Error parsing SSE data:', parseError);
                  }
                }
              }
            }
          } catch (error) {
            console.error('Error reading stream:', error);
            reject(error);
          }
        };

        readStream();
      }).catch(error => {
        console.error('Streaming error:', error);
        reject(error);
      });
    });
  }, [speakWithSettings]);

  // Helper function for streaming conversation
  const streamConversation = useCallback(async (
    imageDataUrl: string, 
    userMessage: string
  ): Promise<{response: string; userMessage: string}> => {
    return new Promise((resolve, reject) => {
      let fullText = '';
      let hasStartedSpeaking = false;

      fetch('/api/conversation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image: imageDataUrl,
          userMessage: userMessage
        }),
      }).then(response => {
        if (!response.ok) {
          throw new Error('Network response was not ok');
        }
        return response.body;
      }).then(body => {
        if (!body) {
          throw new Error('No response body');
        }

        const reader = body.getReader();
        const decoder = new TextDecoder();

        const readStream = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              
              if (done) break;
              
              const chunk = decoder.decode(value);
              const lines = chunk.split('\n');
              
              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  try {
                    const data = JSON.parse(line.slice(6));
                    
                    if (data.type === 'start') {
                      // Conversation started
                      await speakWithSettings('Processing your message...');
                    } else if (data.type === 'chunk') {
                      fullText = data.fullText;
                      
                      // Start speaking after we have a meaningful chunk (≥20 chars for conversations)
                      if (!hasStartedSpeaking && fullText.length >= 20) {
                        hasStartedSpeaking = true;
                        // Start speaking the AI response
                        speakWithSettings(fullText);
                      }
                      
                    } else if (data.type === 'complete') {
                      // Conversation complete
                      
                      // If we haven't started speaking yet, speak the full response
                      if (!hasStartedSpeaking) {
                        await speakWithSettings(data.response);
                      }
                      
                      resolve({
                        response: data.response,
                        userMessage: data.userMessage
                      });
                      return;
                    } else if (data.type === 'error') {
                      setError(data.error);
                      await speakWithSettings(data.error);
                      reject(new Error(data.error));
                      return;
                    }
                  } catch (parseError) {
                    console.error('Error parsing conversation SSE data:', parseError);
                  }
                }
              }
            }
          } catch (error) {
            console.error('Error reading conversation stream:', error);
            reject(error);
          }
        };

        readStream();
      }).catch(error => {
        console.error('Conversation streaming error:', error);
        reject(error);
      });
    });
  }, [speakWithSettings]);

  // Optimized analysis with similarity detection and caching
  const optimizedAnalysis = useCallback(async (imageDataUrl: string, mode: 'narration' | 'guidance'): Promise<Description | null> => {
    try {
      // Generate image hash for similarity detection
      const currentHash = await generateImageHash(imageDataUrl);
      
      // Check if image is similar to last analyzed image
      if (lastImageHash && areImagesSimilar(currentHash, lastImageHash)) {
        console.log('Similar image detected, skipping analysis');
        return null;
      }
      
      // Check cache for exact match
      const cacheKey = `${currentHash}-${mode}`;
      const cachedResult = imageCache.get(cacheKey);
      if (cachedResult) {
        console.log('Using cached analysis result');
        setLastImageHash(currentHash);
        return cachedResult;
      }
      
      // Perform new analysis
      const newDescription = await streamAnalysis(imageDataUrl, mode);
      
      // Update cache and hash
      setImageCache(prev => {
        const newCache = new Map(prev);
        newCache.set(cacheKey, newDescription);
        
        // Limit cache size to 10 entries
        if (newCache.size > 10) {
          const firstKey = newCache.keys().next().value;
          if (firstKey) {
            newCache.delete(firstKey);
          }
        }
        
        return newCache;
      });
      
      setLastImageHash(currentHash);
      return newDescription;
      
    } catch (error) {
      console.error('Optimized analysis error:', error);
      // Fallback to regular analysis
      return await streamAnalysis(imageDataUrl, mode);
    }
  }, [lastImageHash, imageCache, streamAnalysis]);

  // Optimized narration mode capture with debouncing and similarity detection
  const handleNarrationCapture = useCallback(async () => {
    if (isLoading || !isCameraReady) return;

    // Clear existing debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Debounce the analysis by 500ms
    debounceTimerRef.current = setTimeout(async () => {
      try {
        setIsLoading(true);
        setError(null);
        setFocusTimer(0);

        const imageDataUrl = await captureImage();
        if (!imageDataUrl) return;

        // Use optimized analysis with similarity detection and caching
        const newDescription = await optimizedAnalysis(imageDataUrl, 'narration');
        
        // Only update if we got a new description (not skipped due to similarity)
        if (newDescription) {
          setDescriptionHistory(prev => [newDescription, ...prev.slice(0, 4)]);
        }

        setRetryCount(0);

      } catch (err) {
        console.error('Narration capture error:', err);
        const errorMessage = 'Sorry, an error occurred during analysis. Please try again.';
        setError(errorMessage);
        await speakWithSettings(errorMessage, { forceWebTTS: true });
      } finally {
        setIsLoading(false);
      }
    }, 500);
  }, [isLoading, isCameraReady, captureImage, optimizedAnalysis, speakWithSettings]);



  // Mode switching function
  const switchMode = useCallback(async (newMode: AppMode) => {
    if (newMode === currentMode) return;

    // Clear any existing timers
    if (focusTimerRef.current) {
      clearTimeout(focusTimerRef.current);
      focusTimerRef.current = null;
    }
    if (guidanceTimerRef.current) {
      clearInterval(guidanceTimerRef.current);
      guidanceTimerRef.current = null;
    }

    setCurrentMode(newMode);

    // Announce mode switch
    if (newMode === 'narration') {
      await speakWithSettings('Narration Mode is on now. Tap for details, hold to talk with AI.');
      setFocusTimer(0);
    } else {
      await speakWithSettings('Guidance Mode is on now. Navigation assistance every 4 seconds.');
    }
  }, [currentMode, speakWithSettings]);

  // Guidance mode management with useEffect
  useEffect(() => {
    if (currentMode === 'guidance') {
      const scheduleNextGuidanceUpdate = () => {
        guidanceTimerRef.current = setTimeout(async () => {
          // Check if still in guidance mode and ready
          if (currentMode === 'guidance' && !isLoading && isCameraReady) {
            try {
              setIsLoading(true);

              const imageDataUrl = await captureImage();
              if (imageDataUrl) {
                // Use optimized analysis with similarity detection and caching
                const newDescription = await optimizedAnalysis(imageDataUrl, 'guidance');

                // Only update if we got a new description (not skipped due to similarity)
                if (newDescription) {
                  setDescriptionHistory(prev => [newDescription, ...prev.slice(0, 4)]);
                }
              }

            } catch (err) {
              console.error('Guidance update error:', err);
            } finally {
              setIsLoading(false);
            }
          }

          // Schedule next update only after current one completes
          if (currentMode === 'guidance') {
            scheduleNextGuidanceUpdate();
          }
                  }, 4000); // Wait 4 seconds before next update
      };

      // Start the first update
      scheduleNextGuidanceUpdate();

      return () => {
        if (guidanceTimerRef.current) {
          clearTimeout(guidanceTimerRef.current);
          guidanceTimerRef.current = null;
        }
      };
    }
  }, [currentMode]); // Only depend on currentMode

  // Auto-capture for narration mode
  const startFocusTimer = useCallback(() => {
    if (currentMode !== 'narration' || isLoading || isHoldingToTalk) return;

    setFocusTimer(2);

    focusTimerRef.current = setTimeout(async () => {
      if (currentMode === 'narration') {
        await handleNarrationCapture();
      }
    }, 2000);

    // Update countdown every 100ms
    const countdown = setInterval(() => {
      setFocusTimer(prev => {
        const newTime = prev - 0.1;
        if (newTime <= 0) {
          clearInterval(countdown);
          return 0;
        }
        return newTime;
      });
    }, 100);
  }, [currentMode, isLoading, isHoldingToTalk, handleNarrationCapture]);

  // Hold-to-talk functionality
  const startHoldToTalk = useCallback(() => {
    if (currentMode !== 'narration' || isLoading) return;

    setIsHoldingToTalk(true);
    setHoldTimer(0);
    setRecordedTranscript('');
    holdStartTimeRef.current = Date.now();

    // Clear any existing focus timer
    if (focusTimerRef.current) {
      clearTimeout(focusTimerRef.current);
      focusTimerRef.current = null;
      setFocusTimer(0);
    }

    // Update hold timer display
    holdTimerRef.current = setInterval(() => {
      const elapsed = (Date.now() - holdStartTimeRef.current) / 1000;
      setHoldTimer(elapsed);
    }, 100);

    // Start speech recognition if available
    if (speechRecognition && speechRecognition.isSupported()) {
      const started = speechRecognition.startRecording(
        (transcript) => {
          setRecordedTranscript(transcript);
        },
        (error) => {
          console.error('Speech recognition error:', error);
          speakWithSettings('Sorry, I had trouble hearing you. Please try again.');
        }
      );
      
      if (started) {
        setIsRecording(true);
        playRingSound('start'); // Play ring sound instead of TTS
      } else {
        speakWithSettings('Sorry, speech recognition is not available. Please check your microphone permissions.');
      }
    } else {
      playRingSound('start'); // Play ring sound for non-speech recognition mode
    }
  }, [currentMode, isLoading, speechRecognition, speakWithSettings]);

  const endHoldToTalk = useCallback(async () => {
    if (!isHoldingToTalk) return;

    setIsHoldingToTalk(false);
    setHoldTimer(0);

    // Stop speech recognition
    if (speechRecognition && isRecording) {
      speechRecognition.stopRecording();
      setIsRecording(false);
    }

    if (holdTimerRef.current) {
      clearInterval(holdTimerRef.current);
      holdTimerRef.current = null;
    }

    // Play ring sound to indicate recording has ended
    playRingSound('end');

    const holdDuration = (Date.now() - holdStartTimeRef.current) / 1000;

    if (holdDuration < 0.5) {
      // Too short, treat as regular tap
      startFocusTimer();
    } else {
      // Process AI conversation (streaming)
      if (recordedTranscript.trim()) {
        try {
          setIsLoading(true);

          const imageDataUrl = await captureImage();
          if (!imageDataUrl) return;

          // Use streaming conversation for faster response
          const data = await streamConversation(imageDataUrl, recordedTranscript.trim());

          // Create conversation description for history
          const conversationDescription: Description = {
            text: `You said: "${data.userMessage}" | AI replied: "${data.response}"`,
            timestamp: new Date(),
            mode: 'narration'
          };

          // Update history
          setDescriptionHistory(prev => [conversationDescription, ...prev.slice(0, 4)]);
          setCurrentDescription(conversationDescription);

        } catch (err) {
          console.error('Conversation error:', err);
          await speakWithSettings('Sorry, I had trouble processing your message. Please try again.');
        } finally {
          setIsLoading(false);
        }
      } else {
        // No speech detected, fall back to regular narration
        await speakWithSettings('I didn\'t hear anything. Let me describe what I see instead.');
        await handleNarrationCapture();
      }
    }
  }, [isHoldingToTalk, speechRecognition, isRecording, recordedTranscript, startFocusTimer, speakWithSettings, captureImage, handleNarrationCapture, streamConversation]);

  // Camera activation on component mount
  useEffect(() => {
    const initializeCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment',
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          }
        });

        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.onloadedmetadata = async () => {
            setIsCameraReady(true);
            await speakWithSettings('Camera ready. Narration Mode is on now. Tap top half for detailed descriptions, bottom half for navigation guidance. Hold top area to talk with AI.');
          };
        }
      } catch (err) {
        console.error('Camera access error:', err);
        setError('Camera access denied. Please enable camera permissions.');
        await speak('Camera access denied. Please enable camera permissions and reload the page.', {
          forceWebTTS: true
        });
      }
    };

    // Check Gemini TTS availability
    const checkTTSAvailability = async () => {
      const available = await isGeminiTTSAvailable();
      setGeminiTTSAvailable(available);
      if (!available) {
        setTtsSettings(prev => ({ ...prev, useGeminiTTS: false }));
      }
    };

    // Initialize speech recognition
    const initializeSpeechRecognition = () => {
      const recognition = createSpeechRecognition();
      setSpeechRecognition(recognition);
      if (!recognition.isSupported()) {
        console.warn('Speech recognition not supported in this browser');
      }
    };

    initializeCamera();
    checkTTSAvailability();
    initializeSpeechRecognition();

    // Cleanup function with proper ref handling
    return () => {
      const video = videoRef.current;
      if (video?.srcObject) {
        const stream = video.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }

      // Clear timers
      if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
      if (guidanceTimerRef.current) clearInterval(guidanceTimerRef.current);
      if (holdTimerRef.current) clearInterval(holdTimerRef.current);
    };
  }, [speakWithSettings]); // Only depend on speakWithSettings

  // Cleanup effect for debounce timer
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Handle screen area mouse/touch events
  const handleMouseDown = async (event: React.MouseEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const clickY = event.clientY - rect.top;
    const screenHeight = rect.height;
    const isTopHalf = clickY < screenHeight / 2;

    if (isTopHalf && currentMode !== 'narration') {
      await switchMode('narration');
    } else if (!isTopHalf && currentMode !== 'guidance') {
      await switchMode('guidance');
    } else if (isTopHalf && currentMode === 'narration') {
      // Start hold timer for narration mode
      startHoldToTalk();
    }
  };

  const handleMouseUp = async () => {
    if (isHoldingToTalk && currentMode === 'narration') {
      await endHoldToTalk();
    }
  };

  // Handle touch events for mobile
  const handleTouchStart = async (event: React.TouchEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const touch = event.touches[0];
    const touchY = touch.clientY - rect.top;
    const screenHeight = rect.height;
    const isTopHalf = touchY < screenHeight / 2;

    if (isTopHalf && currentMode !== 'narration') {
      await switchMode('narration');
    } else if (!isTopHalf && currentMode !== 'guidance') {
      await switchMode('guidance');
    } else if (isTopHalf && currentMode === 'narration') {
      startHoldToTalk();
    }
  };

  const handleTouchEnd = async () => {
    if (isHoldingToTalk && currentMode === 'narration') {
      await endHoldToTalk();
    }
  };

  const handleRepeatDescription = async () => {
    if (currentDescription) {
      await speakWithSettings(currentDescription.text);
    }
  };

  const formatTime = (date: Date): string => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div
      className="w-screen h-screen relative bg-black cursor-pointer select-none"
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      role="button"
      tabIndex={0}
      aria-label="Tap top for narration mode, bottom for guidance mode. Hold top area to talk to AI."
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (currentMode === 'narration') {
            startFocusTimer();
          }
        }
      }}
    >
      {/* Video element for camera feed */}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="w-full h-full object-cover"
        aria-hidden="true"
      />

      {/* Hidden canvas for image capture */}
      <canvas
        ref={canvasRef}
        className="hidden"
        aria-hidden="true"
      />

      {/* Mode Split Visual Indicators */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Top Half - Narration Mode */}
        <div className={`absolute top-0 left-0 right-0 h-1/2 border-2 ${currentMode === 'narration' ? 'border-blue-500 bg-red-500' : 'border-blue-300 bg-blue-300'
          } bg-opacity-30`}
          style={{
            backgroundColor: "rgb(255, 0, 0, 0.5)"
          }}
        >
          <div className="absolute top-4 left-4 right-4">
            <div className={`text-center p-2 rounded-lg ${currentMode === 'narration' ? 'bg-blue-600' : 'bg-blue-400'
              } bg-opacity-80 text-white`}>
              <h3 className="text-sm font-semibold">📖 NARRATION MODE</h3>
              <p className="text-xs">Tap for details • Hold to talk to AI</p>
              {currentMode === 'narration' && focusTimer > 0 && (
                <p className="text-xs mt-1">Capturing in {focusTimer.toFixed(1)}s...</p>
              )}
              {isHoldingToTalk && (
                <div className="text-xs mt-1 text-yellow-300">
                  <p>🎤 {isRecording ? 'Recording' : 'Holding to talk'} ({holdTimer.toFixed(1)}s)</p>
                  {isRecording && recordedTranscript && (
                    <p className="text-xs mt-1 text-green-300">"{recordedTranscript}"</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom Half - Guidance Mode */}
        <div className={`absolute bottom-0 left-0 right-0 h-1/2 border-2 ${currentMode === 'guidance' ? 'border-green-500 bg-green-500' : 'border-green-300 bg-green-300'
          } bg-opacity-30`}
          style={{
            backgroundColor: "rgb(0, 255, 0, 0.5)"
          }}
        >
          <div className="absolute bottom-4 left-4 right-4">
            <div className={`text-center p-2 rounded-lg ${currentMode === 'guidance' ? 'bg-green-600' : 'bg-green-400'
              } bg-opacity-80 text-white`}>
              <h3 className="text-sm font-semibold">🧭 GUIDANCE MODE</h3>
              <p className="text-xs">Navigation assistance every 4 seconds</p>
            </div>
          </div>
        </div>

        {/* Center divider line */}
        <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-white bg-opacity-50"></div>
      </div>

      {/* Loading overlay */}
      {isLoading && <LoadingSpinner />}

      {/* Current Description Display */}
      {currentDescription && !isLoading && (
        <div className={`absolute top-1/2 left-4 right-4 transform -translate-y-1/2 ${currentDescription.mode === 'narration' ? 'bg-blue-900' : 'bg-green-900'
          } bg-opacity-90 text-white p-4 rounded-lg border border-gray-600 z-40`}>
          <div className="flex justify-between items-start mb-2">
            <h3 className="text-sm font-semibold text-white">
              {currentDescription.mode === 'narration' ? '📖' : '🧭'} {currentDescription.mode.toUpperCase()}
              {ttsSettings.useGeminiTTS && geminiTTSAvailable && (
                <span className="text-xs bg-green-600 px-2 py-1 rounded ml-2">Gemini TTS</span>
              )}:
            </h3>
            <div className="flex space-x-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRepeatDescription();
                }}
                className="text-xs bg-blue-600 px-2 py-1 rounded hover:bg-blue-700"
                aria-label="Repeat description"
              >
                🔊 Repeat
              </button>
              <span className="text-xs text-gray-300">{formatTime(currentDescription.timestamp)}</span>
            </div>
          </div>
          <p className="text-lg font-medium leading-relaxed">{currentDescription.text}</p>
        </div>
      )}

      {/* TTS Controls Button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setShowTTSControls(!showTTSControls);
        }}
        className="absolute top-4 left-4 bg-gray-800 bg-opacity-80 text-white p-2 rounded-full border border-gray-600 hover:bg-gray-700 transition-colors z-50"
        aria-label="TTS Settings"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
        </svg>
      </button>

      {/* TTS Controls Panel */}
      {showTTSControls && (
        <div className="absolute top-16 left-4 bg-black bg-opacity-90 text-white p-4 rounded-lg border border-gray-600 z-50">
          <h3 className="text-sm font-semibold mb-3">Voice Settings</h3>

          <div className="space-y-3">
            <div>
              <label className="flex items-center text-sm">
                <input
                  type="checkbox"
                  checked={ttsSettings.useGeminiTTS && geminiTTSAvailable}
                  disabled={!geminiTTSAvailable}
                  onChange={(e) => setTtsSettings(prev => ({ ...prev, useGeminiTTS: e.target.checked }))}
                  className="mr-2"
                />
                Use Gemini TTS {!geminiTTSAvailable && '(Unavailable)'}
              </label>
            </div>

            <div>
              <label className="block text-sm mb-1">Speed:</label>
              <select
                value={ttsSettings.speed}
                onChange={(e) => setTtsSettings(prev => ({ ...prev, speed: e.target.value }))}
                className="w-full bg-gray-700 text-white p-2 rounded text-sm"
              >
                <option value="slow">Slow</option>
                <option value="normal">Normal</option>
                <option value="fast">Fast</option>
              </select>
            </div>

            {ttsSettings.useGeminiTTS && (
              <div>
                <label className="block text-sm mb-1">Voice Style:</label>
                <select
                  value={ttsSettings.voice}
                  onChange={(e) => setTtsSettings(prev => ({ ...prev, voice: e.target.value }))}
                  className="w-full bg-gray-700 text-white p-2 rounded text-sm"
                >
                  <option value="default">Default</option>
                  <option value="calm">Calm</option>
                  <option value="warm">Warm</option>
                  <option value="professional">Professional</option>
                </select>
              </div>
            )}

            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowTTSControls(false);
              }}
              className="w-full bg-gray-700 hover:bg-gray-600 text-white p-2 rounded text-sm"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* History Toggle Button */}
      {descriptionHistory.length > 1 && !isLoading && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowHistory(!showHistory);
          }}
          className="absolute top-4 right-4 bg-gray-800 bg-opacity-80 text-white p-2 rounded-full border border-gray-600 hover:bg-gray-700 transition-colors z-50"
          aria-label="Toggle description history"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
      )}

      {/* Description History */}
      {showHistory && descriptionHistory.length > 1 && (
        <div className="absolute left-4 right-4 top-20 bottom-24 bg-black bg-opacity-90 text-white p-4 rounded-lg border border-gray-600 overflow-y-auto z-40">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-blue-300">Description History</h3>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowHistory(false);
              }}
              className="text-gray-400 hover:text-white"
              aria-label="Close history"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="space-y-3">
            {descriptionHistory.map((desc, index) => (
              <div key={index} className={`p-3 rounded border ${desc.mode === 'narration' ? 'bg-blue-800 border-blue-600' : 'bg-green-800 border-green-600'
                } bg-opacity-60`}>
                <div className="flex justify-between items-start mb-1">
                  <span className="text-xs text-gray-400">
                    {desc.mode === 'narration' ? '📖' : '🧭'} {index === 0 ? 'Latest' : `${index + 1} ago`}
                  </span>
                  <div className="flex space-x-2">
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        await speakWithSettings(desc.text);
                      }}
                      className="text-xs bg-blue-600 px-2 py-1 rounded hover:bg-blue-700"
                    >
                      🔊
                    </button>
                    <span className="text-xs text-gray-400">{formatTime(desc.timestamp)}</span>
                  </div>
                </div>
                <p className="text-sm leading-relaxed">{desc.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="absolute bottom-24 left-4 right-4 bg-red-600 text-white p-4 rounded-lg z-40">
          <p className="text-sm font-medium">{error}</p>
          {retryCount > 0 && (
            <p className="text-xs mt-2 opacity-90">Auto-retry attempt {retryCount}/2</p>
          )}
        </div>
      )}

      {/* Status indicator */}
      {!isCameraReady && !error && (
        <div className="absolute inset-0 bg-black flex items-center justify-center z-50">
          <div className="text-white text-center p-6">
            <div className="animate-pulse text-lg mb-2">📷</div>
            <p className="text-lg">Initializing camera...</p>
          </div>
        </div>
      )}
    </div>
  );
}
