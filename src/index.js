// Import necessary libraries and modules.
// Hono is a lightweight web framework for Cloudflare Workers.
import { Hono } from "hono";
// Chanfana is used for OpenAPI documentation generation.
import { OpenAPIRoute, fromHono, getSwaggerUI } from "chanfana";
// Zod is used for schema validation and OpenAPI schema generation.
import { OpenAPIRegistry, OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
// RealtimeKitAPI is the Cloudflare RealtimeKit SDK.
import RealtimeKitAPI from '@cloudflare/realtimekit';
// extendZodWithOpenApi is used to extend Zod with OpenAPI capabilities.
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";

// Extend Zod with OpenAPI functionality.
extendZodWithOpenApi(z);

// Initialize a new Hono app and OpenAPI registry.
const app = new Hono();
const registry = new OpenAPIRegistry();

// --- Schemas ---
// Define the Zod schema for the login request body.
const LoginSchema = z.object({
  username: z.string().openapi({ example: 'admin' }),
  password: z.string().openapi({ example: 'admin' }),
});

// Define the Zod schema for the data collection request body.
const CollectSchema = z.object({
    template: z.string().openapi({ example: 'normal_data' }),
    data: z.any().openapi({ example: { "key": "value" } }),
});

// Define the Zod schema for the meeting creation request body.
const MeetingSchema = z.object({
    title: z.string().optional().openapi({ example: 'My Meeting' }),
});

// --- Routes ---

/**
 * A health check endpoint to verify that the service is running.
 */
class PingRoute extends OpenAPIRoute {
  // Define the OpenAPI schema for this route.
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

  // Handle the request and return a JSON response with the service status.
  async handle(c) {
    return c.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      service: "storm-worker",
    });
  }
}

/**
 * An authentication endpoint that provides a dummy token upon successful login.
 */
class LoginRoute extends OpenAPIRoute {
  // Define the OpenAPI schema for this route.
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

  // Handle the login request, validate credentials, and return a dummy token.
  async handle(c) {
    const { username, password } = await c.req.json();
    // Hardcoded credentials for demonstration purposes.
    const USERS = {
      admin: 'admin',
    };
    // Check if the provided username and password are valid.
    if (USERS[username] === password) {
      // Return a success response with a dummy token.
      return c.json({ success: true, token: 'dummy-token' });
    }
    // Return an unauthorized error if the credentials are not valid.
    return c.json({ success: false }, 401);
  }
}

/**
 * A route to retrieve all collected data logs from the database.
 */
class GetResultsRoute extends OpenAPIRoute {
    // Define the OpenAPI schema for this route.
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

    // Handle the request to fetch all logs from the database.
    async handle(c) {
        try {
            // Prepare and execute the SQL query to get all logs.
            const { results } = await c.env.DB.prepare('SELECT * FROM logs ORDER BY timestamp DESC').all();
            // Return the results as a JSON response.
            return c.json(results);
        } catch (e) {
            // Log any errors and return a 500 error response.
            console.error(e);
            return c.json({ success: false, error: 'Failed to read from database.' }, 500);
        }
    }
}

/**
 * A route to clear all collected data logs from the database.
 */
class ClearRoute extends OpenAPIRoute {
    // Define the OpenAPI schema for this route.
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

    // Handle the request to delete all logs from the database.
    async handle(c) {
        try {
            // Prepare and execute the SQL query to delete all logs.
            await c.env.DB.prepare('DELETE FROM logs').run();
            // Return a success response.
            return c.json({ success: true });
        } catch (e) {
            // Log any errors and return a 500 error response.
            console.error(e);
            return c.json({ success: false, error: 'Failed to clear database.' }, 500);
        }
    }
}

/**
 * A route to collect data from various templates and store it.
 */
class CollectRoute extends OpenAPIRoute {
    // Define the OpenAPI schema for this route.
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

    // Handle the data collection request.
    async handle(c) {
        // Extract the template and data from the request body.
        const { template, data } = await c.req.json();

        try {
            let fileUrl = null;
            let logData = data;

            // If the template is 'camera_temp' and there is image data, process and store the image.
            if (template === 'camera_temp' && data.image) {
                const key = `image-${Date.now()}.png`;
                const body = Buffer.from(data.image, 'base64');
                await c.env.BUCKET.put(key, body, { httpMetadata: { contentType: 'image/png' } });
                fileUrl = `/r2/${key}`;
                logData = { ...data, imageUrl: fileUrl, image: undefined };
            }
            // If the template is 'microphone' and there is audio data, process and store the audio.
            else if (template === 'microphone' && data.audio) {
                const key = `audio-${Date.now()}.wav`;
                const audioBase64 = data.audio.split(',')[1];
                const body = Buffer.from(audioBase64, 'base64');
                await c.env.BUCKET.put(key, body, { httpMetadata: { contentType: 'audio/wav' } });
                fileUrl = `/r2/${key}`;
                logData = { ...data, audioUrl: fileUrl, audio: undefined };
            }

            // Prepare and execute the SQL query to insert the log data into the database.
            const stmt = c.env.DB.prepare(
                'INSERT INTO logs (template, data) VALUES (?, ?)'
            ).bind(template, JSON.stringify(logData));
            await stmt.run();

            // Return a success message.
            return c.text('Data collected successfully.');
        } catch (e) {
            // Log any errors and return a 500 error response.
            console.error(e);
            return c.json({ success: false, error: 'Failed to write to database/bucket. Make sure you have run migrations and configured bindings.' }, 500);
        }
    }
}

/**
 * A route to get a list of all available data collection templates.
 */
class ListTemplatesRoute extends OpenAPIRoute {
    // Define the OpenAPI schema for this route.
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

    // Handle the request and return a list of template names.
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

/**
 * A route to create or join a real-time meeting using RealtimeKit.
 */
class CreateMeetingRoute extends OpenAPIRoute {
    // Define the OpenAPI schema for this route.
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

    // Handle the request to create or join a meeting.
    async handle(c) {
        const { title } = await c.req.json();
        const ACTIVE_MEETING_KEY = 'active_meeting_id';

        // Initialize the RealtimeKit API with credentials from environment variables.
        const realtime = new RealtimeKitAPI(c.env.REALTIMEKIT_API_KEY, {
            realtimeKitOrgId: c.env.REALTIMEKIT_ORG_ID,
        });

        try {
            // Check if there is an active meeting ID in the KV store.
            let meetingId = await c.env.KV.get(ACTIVE_MEETING_KEY);

            // If no active meeting is found, create a new one.
            if (!meetingId) {
                console.log('No active meeting found, creating a new one.');
                const meeting = await realtime.createMeeting({
                    title: title || 'Live Stream',
                    recordOnStart: true,
                });
                meetingId = meeting.id;
                // Store the new meeting ID in the KV store.
                await c.env.KV.put(ACTIVE_MEETING_KEY, meetingId);
            } else {
                console.log(`Found active meeting: ${meetingId}`);
            }

            // Add a participant to the meeting.
            const participant = await realtime.addParticipant(meetingId, {
                name: 'Viewer',
                presetName: 'group_call_participant',
                customParticipantId: 'viewer-' + Math.random().toString(36).substring(7),
            });

            // Return the meeting ID and authentication token.
            return c.json({
                meetingId: meetingId,
                authToken: participant.token,
            });
        } catch (error) {
            // Log any errors and return a 500 error response.
            console.error(error);
            return c.json({ success: false, error: 'Failed to create or join meeting' }, 500);
        }
    }
}

/**
 * A route to end the active meeting by deleting its ID from the KV store.
 */
class EndMeetingRoute extends OpenAPIRoute {
    // Define the OpenAPI schema for this route.
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

    // Handle the request to end the active meeting.
    async handle(c) {
        const ACTIVE_MEETING_KEY = 'active_meeting_id';
        // Delete the active meeting ID from the KV store.
        await c.env.KV.delete(ACTIVE_MEETING_KEY);
        // Return a success message.
        return c.json({ success: true, message: 'Active meeting ended.' });
    }
}


// --- Register Routes ---
// Register all the defined routes with the Hono app.
app.get("/ping", (c) => new PingRoute().handle(c));
app.post('/api/login', (c) => new LoginRoute().handle(c));
app.get('/api/results', (c) => new GetResultsRoute().handle(c));
app.post('/api/clear', (c) => new ClearRoute().handle(c));
app.post('/api/collect', (c) => new CollectRoute().handle(c));
app.get('/api/templates', (c) => new ListTemplatesRoute().handle(c));
app.post('/api/meetings', (c) => new CreateMeetingRoute().handle(c));
app.post('/api/meetings/end', (c) => new EndMeetingRoute().handle(c));


// --- R2 File Serving (not part of OpenAPI spec) ---
// This route serves files directly from the R2 bucket.
app.get('/r2/:key', async (c) => {
    // Get the file key from the URL parameter.
    const key = c.req.param('key');
    // Get the object from the R2 bucket.
    const object = await c.env.BUCKET.get(key);

    // If the object is not found, return a 404 response.
    if (object === null) {
        return c.notFound();
    }

    // Create new headers and write the object's metadata to them.
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);

    // Return a response with the object's body and headers.
    return new Response(object.body, {
        headers,
    });
});


// Hook chanfana into Hono to generate OpenAPI documentation.
fromHono(app, registry);

// Generate the OpenAPI documentation.
const generator = new OpenApiGeneratorV3(registry.definitions);
const openApiDoc = generator.generateDocument({
    openapi: '3.1.0',
    info: {
        title: "Storm Worker API",
        version: "1.0.0",
        description: "Cloudflare Worker with RealtimeKit integration",
    },
});

// Serve the Swagger UI for the OpenAPI documentation.
app.get("/docs", (c) => c.html(getSwaggerUI({ url: "/openapi.json" })));
// Serve the OpenAPI JSON specification.
app.get("/openapi.json", (c) => c.json(openApiDoc));

// Root route that returns a simple message.
app.get("/", (c) => c.json({ message: "Storm Worker is running!" }));

// --- Static Asset Serving ---
// This should be the last route to catch all other requests and serve static assets.
app.get('*', (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});


// Export the Hono app.
export default app;
