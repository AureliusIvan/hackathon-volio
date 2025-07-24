// Simple perceptual hash for image similarity detection
export function generateImageHash(imageData: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Create a smaller canvas for hashing
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
      reject(new Error('Cannot create canvas context for hashing'));
      return;
    }
    
    // Set small dimensions for hash comparison
    const hashSize = 8;
    canvas.width = hashSize;
    canvas.height = hashSize;
    
    const img = new Image();
    img.onload = () => {
      try {
        // Draw scaled down image
        ctx.drawImage(img, 0, 0, hashSize, hashSize);
        
        // Get image data
        const imgData = ctx.getImageData(0, 0, hashSize, hashSize);
        const data = imgData.data;
        
        // Calculate average brightness
        let total = 0;
        for (let i = 0; i < data.length; i += 4) {
          // Use RGB average (skip alpha channel)
          total += (data[i] + data[i + 1] + data[i + 2]) / 3;
        }
        const average = total / (hashSize * hashSize);
        
        // Generate hash string based on whether each pixel is above/below average
        let hash = '';
        for (let i = 0; i < data.length; i += 4) {
          const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
          hash += brightness > average ? '1' : '0';
        }
        
        resolve(hash);
      } catch (error) {
        reject(error);
      }
    };
    
    img.onerror = () => reject(new Error('Failed to load image for hashing'));
    img.src = imageData;
  });
}

// Calculate Hamming distance between two hashes
export function calculateHashDistance(hash1: string, hash2: string): number {
  if (hash1.length !== hash2.length) {
    return Infinity;
  }
  
  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] !== hash2[i]) {
      distance++;
    }
  }
  
  return distance;
}

// Check if two images are similar (distance threshold of 10% different pixels)
export function areImagesSimilar(hash1: string, hash2: string, threshold: number = 6): boolean {
  const distance = calculateHashDistance(hash1, hash2);
  return distance <= threshold;
}