'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import LoadingSpinner from '../components/LoadingSpinner';
import { speak, isGeminiTTSAvailable, playRingSound, getIsSpeaking, addSpeechEndCallback, cancelAllSpeech } from '../utils/speech';
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
    speed: 'fast'
  });
  const [geminiTTSAvailable, setGeminiTTSAvailable] = useState<boolean>(false);
  const [isWebSearching, setIsWebSearching] = useState<boolean>(false);
  const [hasWebResults, setHasWebResults] = useState<boolean>(false);

  // New mode system states
  const [currentMode, setCurrentMode] = useState<AppMode>('narration');
  const [focusTimer, setFocusTimer] = useState<number>(0);
  // Removed hold-to-talk functionality for narration mode
  
  // Guidance mode health tracking
  const [lastGuidanceUpdate, setLastGuidanceUpdate] = useState<Date | null>(null);
  const [guidanceRetryCount, setGuidanceRetryCount] = useState<number>(0);
  
  // Speech recognition removed for narration mode

  // Image similarity and caching states
  const [lastImageHash, setLastImageHash] = useState<string>('');
  const [imageCache, setImageCache] = useState<Map<string, Description>>(new Map());
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const focusTimerRef = useRef<NodeJS.Timeout | null>(null);
  const guidanceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const guidanceHealthCheckRef = useRef<NodeJS.Timeout | null>(null);
  // Removed hold-to-talk timer refs
  const tapStartTimeRef = useRef<number>(0);

  // Memoized speech function to avoid dependency warnings
  const speakWithSettings = useCallback(async (text: string, options: { forceWebTTS?: boolean; priority?: 'low' | 'normal' | 'high' } = {}) => {
    return speak(text, {
      forceWebTTS: options.forceWebTTS || !ttsSettings.useGeminiTTS,
      voice: ttsSettings.voice,
      speed: ttsSettings.speed,
      priority: options.priority || 'normal'
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
    mode: 'narration' | 'guidance',
    singleTap: boolean = false
  ): Promise<Description> => {
    return new Promise((resolve, reject) => {
      let fullText = '';
      let currentDescription: Description | null = null;

      // Send the request data via POST (we'll modify this approach)
      fetch('/api/describe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image: imageDataUrl,
          mode: mode,
          singleTap: singleTap
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
                      
                      // Note: Wait for complete response before speaking to avoid interruption
                      
                      // Update current description for live display
                      currentDescription = {
                        text: fullText,
                        timestamp: new Date(),
                        mode: mode
                      };
                      setCurrentDescription(currentDescription);
                      
                    } else if (data.type === 'web_search_start') {
                      // Web search started - show loading indicator
                      setIsWebSearching(true);
                      console.log('Web search started:', data.message);
                    } else if (data.type === 'web_search_results') {
                      // Web search results received
                      setIsWebSearching(false);
                      setHasWebResults(true);
                      console.log('Web search results:', data);
                    } else if (data.type === 'complete') {
                      // Analysis complete
                      const finalDescription: Description = {
                        text: data.fullText,
                        timestamp: new Date(),
                        mode: mode
                      };
                      
                      // Start speaking the complete final text (non-blocking)
                      speakWithSettings(data.fullText);
                      
                      resolve(finalDescription);
                      return;
                    } else if (data.type === 'error') {
                      setError(data.error);
                      await speakWithSettings(data.error, { priority: 'high' });
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

  // Conversation functionality removed for narration mode

  // Enhanced single tap object detection with TTS narration
  const handleSingleTapDetection = useCallback(async (): Promise<void> => {
    if (isLoading || !isCameraReady) return;

    try {
      setIsLoading(true);
      setError(null);
      setIsWebSearching(false);
      setHasWebResults(false);

      // Immediate feedback
      playRingSound('start');

      const imageDataUrl = await captureImage();
      if (!imageDataUrl) return;

      // Use streaming analysis with single tap mode (includes TTS narration)
      const newDescription = await streamAnalysis(imageDataUrl, 'narration', true);
      
      if (newDescription) {
        setCurrentDescription(newDescription);
        setDescriptionHistory(prev => [newDescription, ...prev.slice(0, 4)]);
        
        // Success feedback
        playRingSound('end');
      }

    } catch (err) {
      console.error('Single tap detection error:', err);
      const errorMessage = 'Object detection failed. Please try again.';
      setError(errorMessage);
      // Error feedback
      playRingSound('start');
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, isCameraReady, captureImage, streamAnalysis]);

  // Optimized analysis with similarity detection and caching
  const optimizedAnalysis = useCallback(async (imageDataUrl: string, mode: 'narration' | 'guidance'): Promise<Description | null> => {
    try {
      // Generate image hash for similarity detection
      const currentHash = await generateImageHash(imageDataUrl);
      
      // Check if image is similar to last analyzed image (less strict for guidance mode)
      const similarityThreshold = mode === 'guidance' ? 4 : 6; // More sensitive for guidance (lower = more similar required)
      if (lastImageHash && areImagesSimilar(currentHash, lastImageHash, similarityThreshold)) {
        // For guidance mode, allow updates every 15 seconds even if similar
        if (mode === 'guidance' && lastGuidanceUpdate && 
            (Date.now() - lastGuidanceUpdate.getTime()) < 15000) {
          console.log('Similar guidance image detected, skipping analysis');
          return null;
        }
        // For narration mode, skip similar images
        if (mode === 'narration') {
          console.log('Similar narration image detected, skipping analysis');
          return null;
        }
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
      
      // Update guidance timestamp if in guidance mode
      if (mode === 'guidance') {
        setLastGuidanceUpdate(new Date());
        setGuidanceRetryCount(0); // Reset retry count on successful update
      }
      
      return newDescription;
      
    } catch (error) {
      console.error('Optimized analysis error:', error);
      
      // For guidance mode, increment retry count
      if (mode === 'guidance') {
        setGuidanceRetryCount(prev => prev + 1);
      }
      
      // Fallback to regular analysis
      return await streamAnalysis(imageDataUrl, mode);
    }
  }, [lastImageHash, imageCache, lastGuidanceUpdate]);

  // Mode switching function
  const switchMode = useCallback(async (newMode: AppMode) => {
    if (newMode === currentMode) return;

    // Cancel any ongoing speech before switching modes
    cancelAllSpeech();

    // Clear any existing timers
    if (focusTimerRef.current) {
      clearTimeout(focusTimerRef.current);
      focusTimerRef.current = null;
    }
    if (guidanceTimerRef.current) {
      clearInterval(guidanceTimerRef.current);
      guidanceTimerRef.current = null;
    }
    if (guidanceHealthCheckRef.current) {
      clearInterval(guidanceHealthCheckRef.current);
      guidanceHealthCheckRef.current = null;
    }

    setCurrentMode(newMode);

    // Add small delay before mode announcement to ensure clean transition
    setTimeout(async () => {
      // Announce mode switch with high priority
      if (newMode === 'narration') {
        await speakWithSettings('Narration Mode is on now. Tap for analyze object .', { priority: 'high' });
        setFocusTimer(0);
      } else {
        await speakWithSettings('Guidance Mode is on now. Navigation assistance every 4 seconds.', { priority: 'high' });
      }
    }, 200);
  }, [currentMode, speakWithSettings]);

  // Guidance mode management with useEffect
  useEffect(() => {
    if (currentMode === 'guidance') {
      // Initialize guidance tracking
      setLastGuidanceUpdate(new Date());
      setGuidanceRetryCount(0);
      
      // Use setInterval for more reliable updates
      const performGuidanceUpdate = async () => {
        // Skip if currently loading, camera not ready, or speech is active
        if (isLoading || !isCameraReady || getIsSpeaking()) {
          console.log(`[Guidance] Update skipped - Loading: ${isLoading}, Camera: ${isCameraReady}, Speech: ${getIsSpeaking()}`);
          return;
        }
        
        try {
          setIsLoading(true);
          
          const imageDataUrl = await captureImage();
          if (imageDataUrl) {
            // Use optimized analysis with similarity detection and caching
            const newDescription = await optimizedAnalysis(imageDataUrl, 'guidance');

            // Only update if we got a new description (not skipped due to similarity)
            if (newDescription) {
              setDescriptionHistory(prev => [newDescription, ...prev.slice(0, 4)]);
              setCurrentDescription(newDescription);
            }
          }
          
        } catch (err) {
          console.error('Guidance update error:', err);
          setGuidanceRetryCount(prev => prev + 1);
        } finally {
          setIsLoading(false);
        }
      };
      
      // Start immediate first update
      performGuidanceUpdate();
      
      // Set up regular updates
      guidanceTimerRef.current = setInterval(performGuidanceUpdate, 4000); // Every 4 seconds
      
      // Add speech end callback to trigger guidance updates when speech completes
      const speechEndCallback = () => {
        if (currentMode === 'guidance') {
          console.log('[Guidance] Speech ended, queuing guidance update in 500ms');
          setTimeout(() => {
            console.log('[Guidance] Executing queued guidance update');
            performGuidanceUpdate();
          }, 500); // Small delay to avoid immediate overlap
        }
      };
      addSpeechEndCallback(speechEndCallback);
      
      // Set up health check that runs every 10 seconds
      guidanceHealthCheckRef.current = setInterval(() => {
        if (currentMode === 'guidance') {
          const now = Date.now();
          const lastUpdate = lastGuidanceUpdate?.getTime() || 0;
          const timeSinceLastUpdate = now - lastUpdate;
          
          // If no update in 12 seconds and retry count is reasonable, force an update
          if (timeSinceLastUpdate > 12000 && guidanceRetryCount < 3) {
            console.log(`[Guidance] Health check: stuck for ${timeSinceLastUpdate}ms, forcing update`);
            performGuidanceUpdate();
          } else {
            console.log(`[Guidance] Health check: OK - last update ${timeSinceLastUpdate}ms ago, retry count: ${guidanceRetryCount}`);
          }
        }
      }, 10000); // Health check every 10 seconds
      
      return () => {
        if (guidanceTimerRef.current) {
          clearInterval(guidanceTimerRef.current);
          guidanceTimerRef.current = null;
        }
        if (guidanceHealthCheckRef.current) {
          clearInterval(guidanceHealthCheckRef.current);
          guidanceHealthCheckRef.current = null;
        }
      };
    }
  }, [currentMode, isCameraReady]); // Depend on currentMode and camera readiness

  // Auto-capture functionality removed for simplified tap-only narration mode

  // Hold-to-talk functionality removed for narration mode

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
            await speakWithSettings('Camera ready. Narration Mode is on now. Tap top for object detection. Tap bottom for navigation guidance.');
          };
        }
      } catch (err) {
        console.error('Camera access error:', err);
        setError('Camera access denied. Please enable camera permissions.');
        await speak('Camera access denied. Please enable camera permissions and reload the page.', {
          forceWebTTS: true,
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

      // Clear timers
      if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
      if (guidanceTimerRef.current) clearInterval(guidanceTimerRef.current);
      if (guidanceHealthCheckRef.current) clearInterval(guidanceHealthCheckRef.current);
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
    tapStartTimeRef.current = Date.now();
    
    const rect = event.currentTarget.getBoundingClientRect();
    const clickY = event.clientY - rect.top;
    const screenHeight = rect.height;
    const isTopHalf = clickY < screenHeight / 2;

    if (isTopHalf && currentMode !== 'narration') {
      await switchMode('narration');
    } else if (!isTopHalf && currentMode !== 'guidance') {
      await switchMode('guidance');
    }
    // Removed hold-to-talk for narration mode - now only supports tap
  };

  const handleMouseUp = async (event: React.MouseEvent) => {
    if (currentMode === 'narration') {
      // Any tap in narration mode triggers single tap object detection
      const rect = event.currentTarget.getBoundingClientRect();
      const clickY = event.clientY - rect.top;
      const screenHeight = rect.height;
      const isTopHalf = clickY < screenHeight / 2;
      
      if (isTopHalf) {
        await handleSingleTapDetection();
      }
    }
  };

  // Handle touch events for mobile
  const handleTouchStart = async (event: React.TouchEvent) => {
    tapStartTimeRef.current = Date.now();
    
    const rect = event.currentTarget.getBoundingClientRect();
    const touch = event.touches[0];
    const touchY = touch.clientY - rect.top;
    const screenHeight = rect.height;
    const isTopHalf = touchY < screenHeight / 2;

    if (isTopHalf && currentMode !== 'narration') {
      await switchMode('narration');
    } else if (!isTopHalf && currentMode !== 'guidance') {
      await switchMode('guidance');
    }
    // Removed hold-to-talk for narration mode - now only supports tap
  };

  const handleTouchEnd = async (event: React.TouchEvent) => {
    if (currentMode === 'narration') {
      // Any tap in narration mode triggers single tap object detection
      const rect = event.currentTarget.getBoundingClientRect();
      const touch = event.changedTouches[0];
      const touchY = touch.clientY - rect.top;
      const screenHeight = rect.height;
      const isTopHalf = touchY < screenHeight / 2;
      
      if (isTopHalf) {
        await handleSingleTapDetection();
      }
    }
  };

  const handleRepeatDescription = async () => {
    if (currentDescription && !getIsSpeaking()) {
      await speakWithSettings(currentDescription.text, { priority: 'normal' });
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
      aria-label="Tap top for object detection. Tap bottom for guidance mode."
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (currentMode === 'narration') {
            handleSingleTapDetection();
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
              <p className="text-xs">Tap for analze object</p>
              {currentMode === 'narration' && focusTimer > 0 && (
                <p className="text-xs mt-1">Capturing in {focusTimer.toFixed(1)}s...</p>
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
              {currentMode === 'guidance' && (
                <div className="text-xs mt-1">
                  {lastGuidanceUpdate && (
                    <p className="text-green-200">
                      Last update: {Math.round((Date.now() - lastGuidanceUpdate.getTime()) / 1000)}s ago
                    </p>
                  )}
                  {guidanceRetryCount > 0 && (
                    <p className="text-yellow-300">
                      Retry attempts: {guidanceRetryCount}/3
                    </p>
                  )}
                  {guidanceRetryCount >= 3 && (
                    <div className="text-red-300">
                      <p className="animate-pulse">⚠️ Guidance may be stuck</p>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            setGuidanceRetryCount(0);
                            setIsLoading(true);
                            const imageDataUrl = await captureImage();
                            if (imageDataUrl) {
                              const newDescription = await optimizedAnalysis(imageDataUrl, 'guidance');
                              if (newDescription) {
                                setDescriptionHistory(prev => [newDescription, ...prev.slice(0, 4)]);
                                setCurrentDescription(newDescription);
                              }
                            }
                          } catch (err) {
                            console.error('Manual guidance refresh error:', err);
                          } finally {
                            setIsLoading(false);
                          }
                        }}
                        className="mt-1 px-2 py-1 bg-red-600 hover:bg-red-700 rounded text-xs"
                      >
                        🔄 Refresh Now
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Center divider line */}
        <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-white bg-opacity-50"></div>
      </div>

      {/* Loading overlay */}
      {isLoading && <LoadingSpinner />}

      {/* Current Description Display - Fixed Size Scrolling Container */}
      {currentDescription && !isLoading && (
        <div className={`absolute bottom-20 left-4 right-4 h-32 ${currentDescription.mode === 'narration' ? 'bg-blue-900' : 'bg-green-900'
          } bg-opacity-90 text-white rounded-lg border border-gray-600 z-40 flex flex-col`}>
          <div className="flex justify-between items-start p-3 pb-2 border-b border-gray-600">
            <h3 className="text-sm font-semibold text-white">
              {currentDescription.mode === 'narration' ? '📖' : '🧭'} {currentDescription.mode.toUpperCase()}
              {ttsSettings.useGeminiTTS && geminiTTSAvailable && (
                <span className="text-xs bg-green-600 px-2 py-1 rounded ml-2">Gemini TTS</span>
              )}
              {isWebSearching && (
                <span className="text-xs bg-blue-600 px-2 py-1 rounded ml-2 animate-pulse">🔍 Searching Web...</span>
              )}
              {hasWebResults && !isWebSearching && (
                <span className="text-xs bg-purple-600 px-2 py-1 rounded ml-2">🌐 Enhanced</span>
              )}
            </h3>
            <div className="flex space-x-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRepeatDescription();
                }}
                disabled={getIsSpeaking()}
                className={`text-xs px-2 py-1 rounded ${getIsSpeaking() 
                  ? 'bg-gray-600 cursor-not-allowed opacity-50' 
                  : 'bg-blue-600 hover:bg-blue-700'}`}
                aria-label="Repeat description"
              >
                🔊 {getIsSpeaking() ? 'Speaking...' : 'Repeat'}
              </button>
              <span className="text-xs text-gray-300">{formatTime(currentDescription.timestamp)}</span>
            </div>
          </div>
          <div className="flex-1 overflow-hidden relative px-3 py-2">
            <div className="animate-scroll-up text-base font-medium leading-relaxed whitespace-pre-wrap">
              {currentDescription.text}
            </div>
          </div>
        </div>
      )}

      {/* TTS Controls Button */}
      {/* <button
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
      </button> */}

      {/* TTS Controls Panel */}
      {/* {showTTSControls && (
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
      )} */}

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
      {/* {showHistory && descriptionHistory.length > 1 && (
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
                        if (!getIsSpeaking()) {
                          await speakWithSettings(desc.text, { priority: 'normal' });
                        }
                      }}
                      disabled={getIsSpeaking()}
                      className={`text-xs px-2 py-1 rounded ${getIsSpeaking() 
                        ? 'bg-gray-600 cursor-not-allowed opacity-50' 
                        : 'bg-blue-600 hover:bg-blue-700'}`}
                    >
                      {getIsSpeaking() ? '⏸️' : '🔊'}
                    </button>
                    <span className="text-xs text-gray-400">{formatTime(desc.timestamp)}</span>
                  </div>
                </div>
                <p className="text-sm leading-relaxed">{desc.text}</p>
              </div>
            ))}
          </div>
        </div>
      )} */}

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
