<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1FkRfxEIn0thb-iosCtlyVhrCkaPyYSzh

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`

2. Set up your API key:
   - Copy `.env.example` to `.env.local`:
     ```bash
     cp .env.example .env.local
     ```
   - Edit `.env.local` and replace `YOUR_API_KEY_HERE` with your actual Gemini API key
   - Get your API key from: https://aistudio.google.com/app/apikey

3. Run the app:
   `npm run dev`

## Troubleshooting API Key Issues

If you encounter API key errors:

1. **Verify your `.env.local` file exists** in the project root directory
2. **Check the format** - it should contain: `GEMINI_API_KEY=your_actual_key`
3. **No quotes needed** around the API key value
4. **Restart the dev server** after changing the `.env.local` file
5. **Ensure billing is enabled** - Visit https://ai.google.dev/gemini-api/docs/billing for details
