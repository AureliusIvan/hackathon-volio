# Project Plan: NaraNetra MVP (TypeScript Edition)

## 1. High-Level Objective

To develop a Progressive Web App (PWA) that provides real-time, audible descriptions of the user's surroundings for visually impaired individuals. The Minimum Viable Product (MVP) will focus exclusively on a single, reliable core feature: **"Tap-to-Describe"**.

- **Project Name:** NaraNetra
- **Core Feature:** User taps the screen, the app captures an image, sends it to an AI for analysis, and speaks the resulting description aloud.
- **Primary Technology Stack:** Next.js 15, React, TypeScript, Tailwind CSS, Google Gemini API (`gemini-1.5-flash`), Web Speech API.

---

## 2. Phase 1: Frontend - Camera Interface & Capture

**Goal:** Create a full-screen, interactive camera view that captures a high-quality image frame upon user tap.

**File Structure:**
- `app/page.tsx`: Main component for the camera view.
- `components/LoadingSpinner.tsx`: A reusable loading indicator.
- `public/sounds/`: Directory for audio cues (`capture.mp3`, `error.mp3`).

**Component: `CameraView` (`app/page.tsx`)**

- **Type:** Client Component (`'use client'`).
- **State Management (`useState`):**
  - `isLoading (boolean)`: `useState<boolean>(false)`
  - `error (string | null)`: `useState<string | null>(null)`
- **DOM References (`useRef`):**
  - `videoRef`: `useRef<HTMLVideoElement | null>(null)`
  - `canvasRef`: `useRef<HTMLCanvasElement | null>(null)`

**Implementation Steps:**

1.  **UI Layout:**
    - A root `div` element will act as the main tap target, styled to cover the viewport (`w-screen h-screen`).
    - A `<video>` element, auto-playing and muted, will display the camera feed. Style with `object-cover` to ensure it fills the screen without distortion.
    - A hidden `<canvas>` element for capturing frames.
    - A conditional `LoadingSpinner` component that overlays the screen when `isLoading` is `true`.

2.  **Camera Activation Logic (`useEffect`):**
    - On component mount, request access to the device's rear camera using `navigator.mediaDevices.getUserMedia`.
    - **Constraint Specificity:** `{ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } }`. Requesting a higher resolution provides the AI with better data.
    - **Error Handling:** If permissions are denied or the camera is unavailable, update the `error` state and provide audible feedback.
    - On success, assign the media stream (`MediaStream`) to `videoRef.current.srcObject`.

3.  **Capture Function (`handleCapture`):**
    - This function is triggered by the `onClick` event on the root `div`.
    - **Pre-condition Check:** If `isLoading` is true, return immediately to prevent duplicate requests.
    - Set `isLoading` to `true`.
    - Play a "capture" audio cue to provide immediate feedback.
    - Get the canvas context: `const context = canvasRef.current?.getContext('2d');`.
    - Draw the current video frame onto the canvas: `context.drawImage(videoRef.current, 0, 0, canvasWidth, canvasHeight);`.
    - Convert the canvas image to a Base64 encoded JPEG string: `canvasRef.current?.toDataURL('image/jpeg', 0.9)`. The 0.9 quality setting is a good balance between file size and detail.
    - This Base64 string is the payload for the backend API call.

---

## 3. Phase 2: Backend - Secure AI Analysis Endpoint

**Goal:** Create a secure Next.js API route to process the image with Gemini and return a description.

**File Structure:**
- `app/api/describe/route.ts`: The backend endpoint.
- `.env.local`: To store the `GOOGLE_API_KEY`.

**API Endpoint: `/api/describe`**

1.  **Environment Setup:**
    - Install the Google AI SDK: `npm install @google/generative-ai`.
    - Add `GOOGLE_API_KEY="YOUR_API_KEY_HERE"` to `.env.local`.

2.  **`POST` Handler Logic (in `route.ts`):**
    - **Type Imports:** `import { NextRequest, NextResponse } from 'next/server';`
    - **Request Parsing:** Read the request body and extract the Base64 image string: `const { image }: { image: string } = await req.json();`.
    - **Input Validation:** Check if the `image` string exists and is properly formatted.
    - **API Key Security:** The API key is only accessed on the server, never exposed to the client.
    - **Gemini Initialization:**
      ```typescript
      const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY as string);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      ```
    - **Prompt Engineering (Critical):**
      ```typescript
      const prompt = "You are NaraNetra, an assistant for the visually impaired. In one short, direct sentence, describe the primary subject of this image. Be objective and clear. Example: 'A person is walking a dog on a sidewalk.'";
      ```
    - **Image Preparation:** The Base64 string must be stripped of its prefix (`data:image/jpeg;base64,`).
    - **API Call:**
      ```typescript
      const imagePart = { inlineData: { data: base64ImageData, mimeType: 'image/jpeg' } };
      const result = await model.generateContent([prompt, imagePart]);
      const response = result.response;
      const text = response.text();
      ```
    - **Response Handling:**
      - On success, return a 200 OK with the description: `return NextResponse.json({ description: text });`.
      - Use a `try...catch` block to handle API errors from Google, returning a 500 Internal Server Error with a generic error message.

---

## 4. Phase 3: Integration & Audible Feedback

**Goal:** Connect the frontend capture to the backend analysis and deliver the result to the user via speech synthesis.

**File Structure:**
- `utils/speech.ts`: A helper module for text-to-speech.
- `app/page.tsx`: (Updated)

**Implementation Steps:**

1.  **Speech Synthesis Utility (`utils/speech.ts`):**
    - Create an exported function `speak(text: string): void`.
    - Inside, it must first cancel any currently speaking utterance to prevent overlap: `window.speechSynthesis.cancel();`.
    - Create a new utterance instance: `const utterance = new SpeechSynthesisUtterance(text);`.
    - Set language for better pronunciation: `utterance.lang = 'en-US';`.
    - Execute the speech: `window.speechSynthesis.speak(utterance);`.

2.  **Frontend API Call (in `handleCapture`):**
    - After generating the Base64 string, make a `fetch` call to `/api/describe`.
    - **Network Check:** Before fetching, check `navigator.onLine`. If offline, call `speak("No internet connection.")` and exit the function.
    - In a `try...catch...finally` block:
      - `try`: `await` the fetch, parse the JSON, and call `speak(data.description)`. Define the expected response type: `const data: { description: string } = await response.json();`.
      - `catch`: Handle network or API errors. Call `speak("Sorry, an error occurred. Please try again.")` and play an error sound.
      - `finally`: Set `isLoading` to `false`.

---

## 5. Phase 4: PWA Conversion & Final Polish

**Goal:** Make the app installable on mobile devices and ensure it is robust.

**Implementation Steps:**

1.  **PWA Configuration:**
    - Use a library like `@ducanh2912/next-pwa` to automate the generation of a service worker and manifest file for the Next.js App Router.
    - Configure `manifest.json` with the app's name, description, icons, and `display: 'standalone'`.

2.  **Service Worker Strategy:**
    - Cache the main application shell (HTML, CSS, JS) for fast loading and offline access.
    - The core functionality (image analysis) will still require an internet connection, which has been handled in the API call logic.

3.  **Accessibility (A11y) Review:**
    - Use tools like Lighthouse to audit for accessibility.
    - Ensure the loading indicator has appropriate ARIA roles for screen readers.
    - Set the document title and language (`<html lang="en">`).
