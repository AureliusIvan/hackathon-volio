# NaraNetra - Visual Assistant MVP

A Progressive Web App that provides real-time, audible descriptions of surroundings for visually impaired individuals.

## Features

- **Tap-to-Describe**: Tap anywhere on the screen to capture and analyze what the camera sees
- **Real-time Camera Feed**: Full-screen camera interface optimized for mobile devices
- **Audio Feedback**: Speaks descriptions aloud using Web Speech API
- **Offline-Ready**: PWA with service worker for app installation and caching
- **Accessibility**: Designed with screen readers and keyboard navigation in mind

## Tech Stack

- **Frontend**: Next.js 15, React, TypeScript, Tailwind CSS
- **AI**: Google Gemini API (`gemini-1.5-flash`)
- **Audio**: Web Speech API
- **PWA**: Service worker for offline functionality

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
2. **Tap to Capture**: Tap anywhere on the screen to take a photo
3. **Listen**: The app will speak a description of what it sees
4. **Install as PWA**: Use your browser's "Add to Home Screen" option

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
- **Audio Feedback**: All interactions provide audio responses
- **High Contrast**: Optimized for low vision users

## Browser Requirements

- **Camera Access**: Required for image capture
- **Internet Connection**: Required for AI analysis
- **Speech Synthesis**: Built into modern browsers
- **PWA Support**: Available in all modern browsers

## Privacy & Security

- Images are processed via Google's Gemini API
- No images are stored on the device or server
- API key is secured server-side only
- Camera access is used only when actively capturing

## Development

- **Build**: `npm run build`
- **Lint**: `npm run lint`
- **Type Check**: Built-in TypeScript checking

---

*NaraNetra means "eye of knowledge" - empowering independence through AI-powered vision assistance.*
