'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import LoadingSpinner from '../components/LoadingSpinner';
import { speak, isGeminiTTSAvailable, createSpeechRecognition, SpeechRecognition } from '../utils/speech';

interface ApiErrorResponse {
  error: string;
  errorType?: string;
  retryAfter?: number;
}

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

  // Helper function to capture image
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

    // Set canvas dimensions to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw current video frame
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Convert to Base64 JPEG
    return canvas.toDataURL('image/jpeg', 0.9);
  }, []);

  // Narration mode capture with detailed analysis
  const handleNarrationCapture = useCallback(async () => {
    if (isLoading || !isCameraReady) return;

    try {
      setIsLoading(true);
      setError(null);
      setFocusTimer(0);

      await speakWithSettings('Analyzing object for detailed information...');

      const imageDataUrl = await captureImage();
      if (!imageDataUrl) return;

      // Call API for detailed narration
      const response = await fetch('/api/describe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image: imageDataUrl,
          mode: 'narration' // Will be used for detailed analysis
        }),
      });

      if (!response.ok) {
        const errorData: ApiErrorResponse = await response.json();
        setError(errorData.error);
        await speakWithSettings(errorData.error);
        return;
      }

      const data: { description: string; mode: string } = await response.json();

      // Create new description object
      const newDescription: Description = {
        text: data.description,
        timestamp: new Date(),
        mode: 'narration'
      };

      // Update current description and add to history
      setCurrentDescription(newDescription);
      setDescriptionHistory(prev => [newDescription, ...prev.slice(0, 4)]);

      // Speak the detailed description
      await speakWithSettings(data.description);

      setRetryCount(0);

    } catch (err) {
      console.error('Narration capture error:', err);
      const errorMessage = 'Sorry, an error occurred during analysis. Please try again.';
      setError(errorMessage);
      await speak(errorMessage, { forceWebTTS: true });
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, isCameraReady, speakWithSettings, captureImage]);

  // Guidance mode update with navigation hints
  const handleGuidanceUpdate = useCallback(async () => {
    if (isLoading || !isCameraReady) return;

    try {
      setIsLoading(true);

      const imageDataUrl = await captureImage();
      if (!imageDataUrl) return;

      // Call API for guidance
      const response = await fetch('/api/describe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image: imageDataUrl,
          mode: 'guidance' // Will be used for navigation guidance
        }),
      });

      if (!response.ok) {
        const errorData: ApiErrorResponse = await response.json();
        setError(errorData.error);
        await speakWithSettings(errorData.error);
        return;
      }

      const data: { description: string; mode: string } = await response.json();

      // Create new description object
      const newDescription: Description = {
        text: data.description,
        timestamp: new Date(),
        mode: 'guidance'
      };

      // Update current description and add to history
      setCurrentDescription(newDescription);
      setDescriptionHistory(prev => [newDescription, ...prev.slice(0, 4)]);

      // Speak the guidance
      await speakWithSettings(data.description);

    } catch (err) {
      console.error('Guidance update error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, isCameraReady, captureImage, speakWithSettings]);

  // Guidance mode periodic updates
  const startGuidanceMode = useCallback(() => {
    guidanceTimerRef.current = setInterval(async () => {
      if (currentMode === 'guidance' && !isLoading) {
        await handleGuidanceUpdate();
      }
    }, 5000); // Every 5 seconds
  }, [currentMode, isLoading, handleGuidanceUpdate]);

  // Mode switching function
  const switchMode = useCallback(async (newMode: AppMode) => {
    if (newMode === currentMode) return;

    setCurrentMode(newMode);

    // Clear any existing timers
    if (focusTimerRef.current) {
      clearTimeout(focusTimerRef.current);
      focusTimerRef.current = null;
    }
    if (guidanceTimerRef.current) {
      clearInterval(guidanceTimerRef.current);
      guidanceTimerRef.current = null;
    }

    // Announce mode switch
    if (newMode === 'narration') {
      await speakWithSettings('Narration Mode is on now. Tap for details, hold to talk with AI.');
      setFocusTimer(0);
    } else {
      await speakWithSettings('Guidance Mode is on now. Navigation assistance every 5 seconds.');
      startGuidanceMode();
    }
  }, [currentMode, speakWithSettings, startGuidanceMode]);

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
        speakWithSettings('Listening... Release when done speaking.');
      } else {
        speakWithSettings('Sorry, speech recognition is not available. Please check your microphone permissions.');
      }
    } else {
      speakWithSettings('Hold to talk to AI. Release when done.');
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

    const holdDuration = (Date.now() - holdStartTimeRef.current) / 1000;

    if (holdDuration < 0.5) {
      // Too short, treat as regular tap
      startFocusTimer();
    } else {
      // Process AI conversation
      if (recordedTranscript.trim()) {
        try {
          setIsLoading(true);
          await speakWithSettings('Processing your message...');

          const imageDataUrl = await captureImage();
          if (!imageDataUrl) return;

          // Call conversation API
          const response = await fetch('/api/conversation', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              image: imageDataUrl,
              userMessage: recordedTranscript.trim()
            }),
          });

          if (!response.ok) {
            const errorData: ApiErrorResponse = await response.json();
            setError(errorData.error);
            await speakWithSettings(errorData.error);
            return;
          }

          const data: { response: string; userMessage: string } = await response.json();

          // Create conversation description for history
          const conversationDescription: Description = {
            text: `You said: "${data.userMessage}" | AI replied: "${data.response}"`,
            timestamp: new Date(),
            mode: 'narration'
          };

          // Update history
          setDescriptionHistory(prev => [conversationDescription, ...prev.slice(0, 4)]);
          setCurrentDescription(conversationDescription);

          // Speak the AI response
          await speakWithSettings(data.response);

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
  }, [isHoldingToTalk, speechRecognition, isRecording, recordedTranscript, startFocusTimer, speakWithSettings, captureImage, handleNarrationCapture]);

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
              <p className="text-xs">Navigation assistance every 5 seconds</p>
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
