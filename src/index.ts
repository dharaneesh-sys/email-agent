// Entry point for the Email Agent server
import app from './server';
import { startSnoozeScheduler } from './scheduler';

const port = parseInt(process.env['PORT'] || '3030', 10);

// Create a handler that wraps the app's fetch method with error handling
const fetchHandler = async (req: Request) => {
  try {
    return await app.fetch(req);
  } catch (err) {
    console.error('Unhandled error:', err);
    return new Response('Internal Server Error', { status: 500 });
  }
};

console.log(`🚀 Email Agent server starting on http://localhost:${port}`);
startSnoozeScheduler();

export default {
  port,
  fetch: fetchHandler
};
