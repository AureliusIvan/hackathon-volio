# NaraNetra - Visual Assistant MVP

A Progressive Web App that provides real-time, audible descriptions of surroundings for visually impaired individuals, now enhanced with Google Gemini's advanced native audio capabilities.

## Features

- **Tap-to-Describe**: Tap anywhere on the screen to capture and analyze what the camera sees
- **Advanced AI TTS**: Powered by [Gemini 2.5's native audio capabilities](https://blog.google/technology/google-deepmind/gemini-2-5-native-audio/) with controllable voice styles
- **Real-time Camera Feed**: Full-screen camera interface optimized for mobile devices
- **Intelligent Audio Feedback**: Advanced TTS with natural expressivity and prosody
- **Voice Control Options**: Multiple voice styles, speeds, and customizable delivery
- **Smart Fallback**: Automatically falls back to Web Speech API when Gemini TTS is unavailable
- **Visual + Audio**: Both see and hear descriptions with history tracking
- **Offline-Ready**: PWA with service worker for app installation and caching
- **Accessibility**: Designed with screen readers and keyboard navigation in mind

## Tech Stack

- **Frontend**: Next.js 15, React, TypeScript, Tailwind CSS
- **AI Vision**: Google Gemini API (`gemini-2.5-flash`)
- **Advanced TTS**: Gemini 2.5 Native Audio (with Web Speech API fallback)
- **PWA**: Service worker for offline functionality

## Enhanced Audio Features

### Gemini TTS Capabilities
Based on [Google's latest Gemini 2.5 native audio features](https://blog.google/technology/google-deepmind/gemini-2-5-native-audio/):

- **Natural Conversation**: High-quality voice interactions with appropriate expressivity
- **Style Control**: Adaptable delivery with specific tones, accents, and expressions
- **Enhanced Pace Control**: Precise control over delivery speed and pronunciation
- **Dynamic Performance**: Expressive readings optimized for accessibility
- **Multilinguality**: Support for 24+ languages

### Voice Settings
- **Voice Styles**: Default, Calm, Warm, Professional
- **Speed Options**: Slow, Normal, Fast
- **Automatic Fallback**: Seamlessly switches to browser TTS if needed
- **Smart Detection**: Automatically detects Gemini TTS availability

## Setup

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Configure API Key**
   - Get a Google AI API key from [Google AI Studio](https://makersuite.google.com/app/apikey)
   - Create a `.env.local` file in the root directory:
     ```
     GOOGLE_API_KEY=your_api_key_here
     ```

3. **Run Development Server**
   ```bash
   npm run dev
   ```

4. **Access the App**
   - Open [http://localhost:3000](http://localhost:3000)
   - Allow camera permissions when prompted
   - Tap anywhere on the screen to capture and describe

## Usage

1. **Camera Access**: Grant camera permissions when prompted
2. **Voice Settings**: Tap the settings icon (top-left) to configure TTS preferences
3. **Tap to Capture**: Tap anywhere on the screen to take a photo
4. **Listen & See**: The app will both speak and display descriptions
5. **Repeat**: Use the "Repeat" button to hear descriptions again
6. **History**: View previous descriptions with the history button
7. **Install as PWA**: Use your browser's "Add to Home Screen" option

## Voice Technology

### Gemini TTS (Primary)
- **Enhanced Quality**: Natural, expressive speech optimized for accessibility
- **Voice Control**: Multiple voice styles and delivery options
- **Smart Processing**: AI-optimized pronunciation and pacing
- **Availability**: Automatically detected and enabled when supported

### Web Speech API (Fallback)
- **Universal Support**: Works in all modern browsers
- **Reliable Backup**: Ensures functionality when Gemini TTS is unavailable
- **Seamless Transition**: Automatic fallback without user intervention

## PWA Installation

### Mobile (iOS/Android)
1. Open the app in your mobile browser
2. Look for "Add to Home Screen" or "Install" option
3. Follow the prompts to install

### Desktop
1. Look for the install icon in your browser's address bar
2. Click to install as a desktop app

## Accessibility Features

- **Screen Reader Support**: ARIA labels and semantic HTML
- **Keyboard Navigation**: Use Space or Enter to capture
- **Advanced Audio**: Gemini TTS optimized for visually impaired users
- **Visual Feedback**: Large, high-contrast text displays
- **Repeat Functions**: Easy access to replay descriptions
- **Voice Customization**: Adjustable speed and style preferences

## Browser Requirements

- **Camera Access**: Required for image capture
- **Internet Connection**: Required for AI analysis and Gemini TTS
- **Audio Support**: HTML5 audio for Gemini TTS playback
- **Speech Synthesis**: Built-in browser support for fallback TTS
- **PWA Support**: Available in all modern browsers

## Privacy & Security

- **No Data Storage**: Images are not stored on device or server
- **Secure Processing**: All data processed via Google's secure APIs
- **API Key Protection**: Server-side only API key storage
- **Temporary Audio**: Generated audio files are automatically cleaned up

## Development

- **Build**: `npm run build`
- **Lint**: `npm run lint`
- **Type Check**: Built-in TypeScript checking

## API Quotas & Limits

- **Free Tier**: Limited requests per minute for both vision and TTS
- **Smart Fallbacks**: Automatic fallback systems for quota management
- **Rate Limiting**: Built-in retry logic with user feedback
- **Upgrade Path**: Billing account enables higher quotas

---

*NaraNetra means "eye of knowledge" - now enhanced with Google's most advanced AI voice technology for natural, expressive audio assistance.*
