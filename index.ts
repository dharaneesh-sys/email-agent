import app from './src/server';

const port = parseInt(process.env['PORT'] || '3030', 10);

console.log(`🚀 Email Agent server starting on http://localhost:${port}`);
console.log(`📧 Dashboard: http://localhost:${port}/`);

export default {
  port,
  fetch: app.fetch
};
