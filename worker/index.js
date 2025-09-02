import { Hono } from 'hono'

const app = new Hono()

// TODO: Replace with a more secure way to store credentials
const USERS = {
  admin: 'admin',
}

app.post('/api/login', async (c) => {
  const { username, password } = await c.req.json()
  if (USERS[username] === password) {
    // In a real app, you'd issue a JWT or a session token
    return c.json({ success: true, token: 'dummy-token' })
  }
  return c.json({ success: false }, 401)
})

app.get('/api/results', async (c) => {
  const results = await c.env.KV.get('results')
  return c.text(results || '')
})

app.post('/api/clear', async (c) => {
  await c.env.KV.put('results', '')
  return c.json({ success: true })
})

app.post('/api/collect', async (c) => {
  const { template, data } = await c.req.json()
  const key = `results`
  const existingData = await c.env.KV.get(key)
  const newData = `${existingData || ''}\n[${template}] ${JSON.stringify(data)}`
  await c.env.KV.put(key, newData)
  return c.text('Data collected')
})

app.get('/api/templates', (c) => {
    // In a real application, you might want to fetch this from a dynamic source
    // or have a build step that generates this list.
    // For now, we'll hardcode it based on the `public/templates` directory.
    const templates = [
        "camera_temp",
        "microphone",
        "nearyou",
        "normal_data",
        "weather"
    ];
    return c.json(templates);
});


export default app
