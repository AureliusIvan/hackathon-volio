export function speak(text: string): void {
  // Cancel any currently speaking utterance to prevent overlap
  window.speechSynthesis.cancel();
  
  // Create a new utterance instance
  const utterance = new SpeechSynthesisUtterance(text);
  
  // Set language for better pronunciation
  utterance.lang = 'en-US';
  
  // Set speech rate and volume for clarity
  utterance.rate = 0.9;
  utterance.volume = 1.0;
  
  // Execute the speech
  window.speechSynthesis.speak(utterance);
} 