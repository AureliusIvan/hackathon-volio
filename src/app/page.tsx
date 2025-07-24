'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import LoadingSpinner from '../components/LoadingSpinner';
import { speak, isGeminiTTSAvailable } from '../utils/speech';

interface ApiErrorResponse {
  error: string;
  errorType?: string;
  retryAfter?: number;
}

interface Description {
  text: string;
  timestamp: Date;
}

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
  
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Memoized speech function to avoid dependency warnings
  const speakWithSettings = useCallback(async (text: string, options: { forceWebTTS?: boolean } = {}) => {
    return speak(text, {
      forceWebTTS: options.forceWebTTS || !ttsSettings.useGeminiTTS,
      voice: ttsSettings.voice,
      speed: ttsSettings.speed
    });
  }, [ttsSettings.useGeminiTTS, ttsSettings.voice, ttsSettings.speed]);

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
            await speakWithSettings('Camera ready. Tap anywhere on the screen to describe your surroundings.');
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

    initializeCamera();
    checkTTSAvailability();

    // Cleanup function with proper ref handling
    return () => {
      const video = videoRef.current;
      if (video?.srcObject) {
        const stream = video.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []); // Empty dependency array is correct here

  const handleApiError = async (response: Response): Promise<void> => {
    const errorData: ApiErrorResponse = await response.json();
    
    switch (errorData.errorType) {
      case 'RATE_LIMIT_EXCEEDED':
        const retryAfter = errorData.retryAfter || 60;
        setError(`API quota exceeded. Please wait ${retryAfter} seconds and try again.`);
        await speakWithSettings(`API quota exceeded. Please wait ${retryAfter} seconds before trying again.`);
        
        // Auto-retry after the specified time for rate limits
        if (retryCount < 2) { // Max 2 retries
          setTimeout(async () => {
            setError(null);
            setRetryCount(prev => prev + 1);
            await speakWithSettings('Retrying image analysis...');
            handleCapture();
          }, retryAfter * 1000);
        }
        break;
        
      case 'INVALID_API_KEY':
        setError('Invalid API key. Please check your configuration.');
        await speak('Invalid API key. Please check your configuration and restart the application.', {
          forceWebTTS: true
        });
        break;
        
      case 'INVALID_IMAGE':
        setError('Invalid image format. Please try again.');
        await speakWithSettings('Invalid image format. Please try taking another photo.');
        break;
        
      default:
        setError(errorData.error);
        await speakWithSettings(errorData.error);
    }
  };

  const handleCapture = async () => {
    // Prevent duplicate requests
    if (isLoading || !isCameraReady) return;
    
    try {
      setIsLoading(true);
      setError(null);
      
      // Reset retry count on new manual capture
      if (retryCount > 0) {
        setRetryCount(0);
      }
      
      // Play capture feedback
      await speakWithSettings('Capturing image...');
      
      // Get canvas context and capture frame
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
      const imageDataUrl = canvas.toDataURL('image/jpeg', 0.9);
      
      // Check internet connection
      if (!navigator.onLine) {
        await speak('No internet connection. Please check your connection and try again.', {
          forceWebTTS: true
        });
        return;
      }
      
      // Call API for analysis
      const response = await fetch('/api/describe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image: imageDataUrl }),
      });
      
      if (!response.ok) {
        await handleApiError(response);
        return;
      }
      
      const data: { description: string } = await response.json();
      
      // Create new description object
      const newDescription: Description = {
        text: data.description,
        timestamp: new Date()
      };
      
      // Update current description and add to history
      setCurrentDescription(newDescription);
      setDescriptionHistory(prev => [newDescription, ...prev.slice(0, 4)]); // Keep last 5 descriptions
      
      // Speak the description with current TTS settings
      await speakWithSettings(data.description);
      
      // Reset retry count on success
      setRetryCount(0);
      
    } catch (err) {
      console.error('Capture error:', err);
      const errorMessage = 'Sorry, an error occurred. Please try again.';
      setError(errorMessage);
      await speak(errorMessage, {
        forceWebTTS: true
      });
    } finally {
      setIsLoading(false);
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
      onClick={handleCapture}
      role="button"
      tabIndex={0}
      aria-label="Tap to capture and describe surroundings"
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleCapture();
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
      
      {/* Loading overlay */}
      {isLoading && <LoadingSpinner />}
      
      {/* Current Description Display */}
      {currentDescription && !isLoading && (
        <div className="absolute top-4 left-4 right-4 bg-black bg-opacity-80 text-white p-4 rounded-lg border border-gray-600">
          <div className="flex justify-between items-start mb-2">
            <h3 className="text-sm font-semibold text-blue-300">
              AI Description {ttsSettings.useGeminiTTS && geminiTTSAvailable && (
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
        className="absolute top-4 left-4 bg-gray-800 bg-opacity-80 text-white p-2 rounded-full border border-gray-600 hover:bg-gray-700 transition-colors"
        aria-label="TTS Settings"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
        </svg>
      </button>
      
      {/* TTS Controls Panel */}
      {showTTSControls && (
        <div className="absolute top-16 left-4 bg-black bg-opacity-90 text-white p-4 rounded-lg border border-gray-600">
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
          className="absolute top-4 right-4 bg-gray-800 bg-opacity-80 text-white p-2 rounded-full border border-gray-600 hover:bg-gray-700 transition-colors"
          aria-label="Toggle description history"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
      )}
      
      {/* Description History */}
      {showHistory && descriptionHistory.length > 1 && (
        <div className="absolute left-4 right-4 top-20 bottom-24 bg-black bg-opacity-90 text-white p-4 rounded-lg border border-gray-600 overflow-y-auto">
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
              <div key={index} className="p-3 bg-gray-800 bg-opacity-60 rounded border border-gray-700">
                <div className="flex justify-between items-start mb-1">
                  <span className="text-xs text-gray-400">
                    {index === 0 ? 'Latest' : `${index + 1} ago`}
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
        <div className="absolute bottom-24 left-4 right-4 bg-red-600 text-white p-4 rounded-lg">
          <p className="text-sm font-medium">{error}</p>
          {retryCount > 0 && (
            <p className="text-xs mt-2 opacity-90">Auto-retry attempt {retryCount}/2</p>
          )}
        </div>
      )}
      
      {/* Status indicator */}
      {!isCameraReady && !error && (
        <div className="absolute inset-0 bg-black flex items-center justify-center">
          <div className="text-white text-center p-6">
            <div className="animate-pulse text-lg mb-2">📷</div>
            <p className="text-lg">Initializing camera...</p>
          </div>
        </div>
      )}
      
      {/* Instruction overlay for first-time users */}
      {isCameraReady && !isLoading && !currentDescription && (
        <div className="absolute bottom-4 left-4 right-4 bg-black bg-opacity-70 text-white p-4 rounded-lg">
          <p className="text-center text-sm">
            Tap anywhere on the screen to get an audio description of what the camera sees
            {geminiTTSAvailable && ttsSettings.useGeminiTTS && (
              <span className="block text-xs text-green-300 mt-1">✨ Enhanced with Gemini TTS</span>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
