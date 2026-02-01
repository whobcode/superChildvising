import { Hono } from "hono";
import { OpenAPIRoute, fromHono, getSwaggerUI } from "chanfana";
import { OpenAPIRegistry, OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";

extendZodWithOpenApi(z);

const app = new Hono();
const registry = new OpenAPIRegistry();

const ACTIVE_STREAM_KEY = 'active_stream_live_input';
const MEVID_STREAM_SOURCE = 'superchildvising';

function getRequiredStreamEnv(env) {
    const accountId = env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = env.CLOUDFLARE_API_TOKEN;
    if (!accountId || !apiToken) {
        throw new Error('Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN.');
    }
    return { accountId, apiToken };
}

async function callStreamApi(env, path, init) {
    const { accountId, apiToken } = getRequiredStreamEnv(env);
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream${path}`;
    const resp = await fetch(url, {
        ...init,
        headers: {
            Authorization: `Bearer ${apiToken}`,
            ...(init?.headers ?? {}),
        },
    });

    const json = await resp.json().catch(() => null);
    if (!resp.ok || !json?.success) {
        const errors = json?.errors ? JSON.stringify(json.errors) : `HTTP ${resp.status}`;
        throw new Error(`Cloudflare Stream API error: ${errors}`);
    }
    return json;
}

function getMevidStreamConfig(env) {
    const ingestUrl = env.MEVID_STREAM_INGEST_URL;
    const token = env.MEVID_STREAM_TOKEN;
    if (!ingestUrl || !token) return null;
    return { ingestUrl, token };
}

async function notifyMevidStream(env, payload) {
    const config = getMevidStreamConfig(env);
    if (!config) return false;

    try {
        const resp = await fetch(config.ingestUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            console.error('Failed to notify mevid stream ingest:', resp.status, text);
            return false;
        }
        return true;
    } catch (error) {
        console.error('Failed to notify mevid stream ingest:', error);
        return false;
    }
}

function normalizeLiveInput(result) {
    const liveInputId = result?.uid;
    const whipUrl = result?.webRTC?.url;
    const whepUrl = result?.webRTCPlayback?.url;
    if (!liveInputId || !whipUrl || !whepUrl) {
        throw new Error('Unexpected Cloudflare Stream live input response shape.');
    }
    return { liveInputId, whipUrl, whepUrl };
}

async function createLiveInput(env) {
    const json = await callStreamApi(env, '/live_inputs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            meta: { name: 'storm-worker-live-input' },
        }),
    });
    return normalizeLiveInput(json.result);
}

async function ensureLiveInput(env) {
    const storedRaw = await env.KV.get(ACTIVE_STREAM_KEY);
    if (storedRaw) {
        try {
            const stored = JSON.parse(storedRaw);
            if (stored?.liveInputId && stored?.whipUrl && stored?.whepUrl) return stored;
        } catch {
            // Ignore and recreate
        }
    }

    const created = await createLiveInput(env);
    await env.KV.put(ACTIVE_STREAM_KEY, JSON.stringify(created));
    return created;
}

async function deleteLiveInput(env, liveInputId) {
    try {
        await callStreamApi(env, `/live_inputs/${liveInputId}`, { method: 'DELETE' });
    } catch (e) {
        console.error(e);
    }
}

function base64ToArrayBuffer(value) {
    if (typeof value !== 'string') {
        throw new Error('Expected base64 string.');
    }

    const base64 = value.includes(',') ? value.split(',')[1] : value;
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

// --- Schemas ---
const LoginSchema = z.object({
  username: z.string().openapi({ example: 'admin' }),
  password: z.string().openapi({ example: 'admin' }),
});

const CollectSchema = z.object({
    template: z.string().openapi({ example: 'normal_data' }),
    data: z.any().openapi({ example: { "key": "value" } }),
});

const StreamPublishResponseSchema = z.object({
    liveInputId: z.string().openapi({ example: '9a7806061c88ada191ed06f989cc3dac' }),
    whipUrl: z.string().openapi({ example: 'https://.../whip/9a7806061c88ada191ed06f989cc3dac' }),
});

const StreamPlaybackResponseSchema = z.object({
    liveInputId: z.string().openapi({ example: '9a7806061c88ada191ed06f989cc3dac' }),
    whepUrl: z.string().openapi({ example: 'https://.../whep/9a7806061c88ada191ed06f989cc3dac' }),
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
                const body = base64ToArrayBuffer(data.image);
                await c.env.BUCKET.put(key, body, { httpMetadata: { contentType: 'image/png' } });
                fileUrl = `/r2/${key}`;
                logData = { ...data, imageUrl: fileUrl, image: undefined };
            } else if (template === 'microphone' && data.audio) {
                const key = `audio-${Date.now()}.wav`;
                const body = base64ToArrayBuffer(data.audio);
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

class GetStreamPublishRoute extends OpenAPIRoute {
    schema = {
        tags: ["Stream"],
        summary: "Get Stream WHIP publish endpoint",
        responses: {
            "200": {
                description: "WHIP endpoint for publishing",
                content: {
                    "application/json": {
                        schema: StreamPublishResponseSchema,
                    },
                },
            },
            "500": {
                description: "Failed to get WHIP endpoint",
            }
        }
    }

    async handle(c) {
        try {
            const stream = await ensureLiveInput(c.env);
            c.executionCtx.waitUntil(
                notifyMevidStream(c.env, {
                    source: MEVID_STREAM_SOURCE,
                    status: 'live',
                    liveInputId: stream.liveInputId,
                    whipUrl: stream.whipUrl,
                    whepUrl: stream.whepUrl,
                    startedAt: new Date().toISOString(),
                })
            );
            return c.json({ liveInputId: stream.liveInputId, whipUrl: stream.whipUrl });
        } catch (error) {
            console.error(error);
            return c.json({ success: false, error: 'Failed to get WHIP endpoint' }, 500);
        }
    }
}

class GetStreamPlaybackRoute extends OpenAPIRoute {
    schema = {
        tags: ["Stream"],
        summary: "Get Stream WHEP playback endpoint",
        responses: {
            "200": {
                description: "WHEP endpoint for playback",
                content: {
                    "application/json": {
                        schema: StreamPlaybackResponseSchema,
                    },
                },
            },
            "500": {
                description: "Failed to get WHEP endpoint",
            }
        }
    }

    async handle(c) {
        try {
            const stream = await ensureLiveInput(c.env);
            return c.json({ liveInputId: stream.liveInputId, whepUrl: stream.whepUrl });
        } catch (error) {
            console.error(error);
            return c.json({ success: false, error: 'Failed to get WHEP endpoint' }, 500);
        }
    }
}

class EndStreamRoute extends OpenAPIRoute {
    schema = {
        tags: ["Stream"],
        summary: "End the active Stream live input",
        responses: {
            "200": {
                description: "Stream ended",
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
        const storedRaw = await c.env.KV.get(ACTIVE_STREAM_KEY);
        let stored = null;
        if (storedRaw) {
            try {
                stored = JSON.parse(storedRaw);
                if (stored?.liveInputId) {
                    await deleteLiveInput(c.env, stored.liveInputId);
                }
            } catch {
                // ignore
            }
        }

        await c.env.KV.delete(ACTIVE_STREAM_KEY);
        if (stored?.liveInputId) {
            c.executionCtx.waitUntil(
                notifyMevidStream(c.env, {
                    source: MEVID_STREAM_SOURCE,
                    status: 'ended',
                    liveInputId: stored.liveInputId,
                    whepUrl: stored.whepUrl ?? null,
                    endedAt: new Date().toISOString(),
                })
            );
        }
        return c.json({ success: true, message: 'Active stream ended.' });
    }
}


// --- Register Routes ---
app.get("/ping", (c) => new PingRoute().handle(c));
app.post('/api/login', (c) => new LoginRoute().handle(c));
app.get('/api/results', (c) => new GetResultsRoute().handle(c));
app.post('/api/clear', (c) => new ClearRoute().handle(c));
app.post('/api/collect', (c) => new CollectRoute().handle(c));
app.get('/api/templates', (c) => new ListTemplatesRoute().handle(c));
app.post('/api/stream/publish', (c) => new GetStreamPublishRoute().handle(c));
app.get('/api/stream/play', (c) => new GetStreamPlaybackRoute().handle(c));
app.post('/api/stream/end', (c) => new EndStreamRoute().handle(c));


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
        description: "Cloudflare Worker with Stream WHIP/WHEP integration",
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
