# NaraNetra Setup Instructions

## Quick Start

1. **Create Environment File from Template**
   ```bash
   cp env.template .env.local
   ```

2. **Add Your Google AI API Key**
   Open `.env.local` and replace `your_google_ai_api_key_here` with your actual API key:
   ```
   GOOGLE_API_KEY=your_actual_api_key_here
   ```

3. **Get Your API Key**
   - Visit [Google AI Studio](https://makersuite.google.com/app/apikey)
   - Sign in with your Google account
   - Click "Create API Key"
   - Copy the generated key

4. **Test the Application**
   - The development server should already be running at http://localhost:3000
   - Allow camera permissions when prompted
   - Tap the screen to test image description

## Important Notes

- **Camera Permissions**: The app requires camera access to function
- **Internet Connection**: Required for AI analysis via Google Gemini API
- **HTTPS**: For production deployment, HTTPS is required for camera access
- **Browser Support**: Works on all modern browsers with camera support
- **API Quotas**: Free tier has limited requests per minute (see troubleshooting below)

## API Quota Information

**Free Tier Limitations:**
- Google Gemini API free tier has strict rate limits
- Typically 0-15 requests per minute for free accounts
- Quotas reset every minute
- Heavy usage may require paid billing account

**Rate Limit Handling:**
- App automatically retries after quota resets (60 seconds)
- Visual and audio feedback when quotas are exceeded
- Maximum 2 auto-retry attempts per capture

## Troubleshooting

### Common Issues

- **"Camera access denied"**: Check browser permissions and refresh
- **"Server configuration error"**: Verify your API key is correctly set in `.env.local`
- **"No internet connection"**: Check your network connection
- **Build issues**: Make sure all dependencies are installed with `npm install`

### API Quota Issues

**"API quota exceeded" Error:**
1. **Wait and Retry**: Quotas reset every minute - wait 60 seconds
2. **Check Usage**: Avoid rapid successive captures
3. **Upgrade Account**: Consider enabling billing for higher quotas
4. **Alternative**: Use a different Google account for fresh quota

**Getting Higher Quotas:**
1. Visit [Google Cloud Console](https://console.cloud.google.com)
2. Enable billing on your project
3. Request quota increases if needed
4. Monitor usage in the console

### Error Types and Solutions

| Error | Cause | Solution |
|-------|-------|----------|
| Rate Limit Exceeded | Too many requests | Wait 60 seconds, app auto-retries |
| Invalid API Key | Wrong/missing key | Check `.env.local` configuration |
| Camera Access Denied | No permissions | Enable camera in browser settings |
| Server Configuration | Missing API key | Ensure key is in `.env.local` |

## Testing Without API Key

The app will build and run without an API key, but image analysis will fail. You'll see appropriate error messages guiding you to set up the API key.

## Production Deployment

For production deployment:
1. **Enable billing** on your Google Cloud project for higher quotas
2. **Use HTTPS** - Required for camera access in production
3. **Monitor quotas** - Set up alerts for API usage
4. **Consider caching** - Implement intelligent caching for repeated captures

---

*Ready to test? Visit http://localhost:3000 and tap the screen!* 