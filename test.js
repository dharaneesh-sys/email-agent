import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'

const app = new Hono()

app.get('/api/hello', (c) => c.json({ message: 'Hello World' }))
app.get('/static/*', serveStatic({ root: './' }))

const port = 3030
console.log(`Server starting on http://localhost:${port}`)

export default {
  port,
  fetch: app.fetch
}
