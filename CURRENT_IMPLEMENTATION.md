# Storm Worker - Current Implementation Documentation

## Overview

Storm Worker is a Cloudflare Workers-based surveillance and data collection application with real-time video/audio streaming capabilities. It combines multiple data collection templates with a real-time communication system for monitoring purposes.

## Architecture

### Technology Stack

- **Backend Framework**: Hono.js (lightweight web framework for Cloudflare Workers)
- **API Documentation**: OpenAPI 3.1.0 with Chanfana integration
- **Real-time Streaming**: `@cloudflare/realtimekit` (version 1.2.3)
- **Schema Validation**: Zod with OpenAPI extensions
- **Storage**:
  - D1 (SQL database for logs)
  - R2 (Object storage for media files)
  - KV (Key-value store for active meeting IDs)

### Core Components

1. **Authentication System**
2. **Data Collection Framework**
3. **Real-time Streaming System**
4. **Admin Dashboard**

---

## How It Works

### 1. Authentication Flow

**Files**: `public/login.html`, `public/assets/js/login.js`, `src/index.js` (LoginRoute)

#### Process:
1. User accesses the root URL (`index.html`)
2. JavaScript checks `localStorage` for a token:
   - If token exists → redirects to `panel.html`
   - If no token → redirects to `login.html`
3. User submits credentials (currently hardcoded: `admin`/`admin`)
4. POST request to `/api/login` validates credentials
5. On success:
   - Server returns `{ success: true, token: 'dummy-token' }`
   - Token is stored in `localStorage`
   - User is redirected to `panel.html`

**Security Note**: Currently uses dummy authentication with hardcoded credentials.

---

### 2. Data Collection Templates

**Files**: Various templates in `public/templates/`, `src/index.js` (CollectRoute, ListTemplatesRoute)

The system supports five collection templates:

#### A. Camera Template (`camera_temp`)
- **Location**: `public/templates/camera_temp/index.html`
- **Function**: Captures video stream using RealtimeKit
- **Process**:
  1. Page loads and calls `/api/meetings` to create/join a meeting
  2. Initializes RealtimeKit client with auth token
  3. Enables video (audio disabled by default)
  4. Joins meeting room and streams video
  5. Base64-encoded image data is sent to `/api/collect`
  6. Server stores image in R2 bucket as `image-{timestamp}.png`
  7. Database record created with reference to R2 URL

#### B. Microphone Template (`microphone`)
- **Location**: `public/templates/microphone/index.html`, `public/templates/microphone/js/_app.js`
- **Function**: Automatic audio recording and upload
- **Process**:
  1. Page loads and automatically starts recording after 300ms
  2. Uses `Recorder.js` library with Web Audio API
  3. Records mono audio (1 channel) from microphone
  4. Stops recording every 6 seconds
  5. Exports WAV file as base64
  6. POSTs to `/api/collect` with template: `microphone`
  7. Server stores audio in R2 as `audio-{timestamp}.wav`
  8. Immediately starts new recording (continuous loop)
  9. "Redirect to Website" button opens `https://sabzlearn.ir` (decoy/distraction)

#### C. Near You Template (`nearyou`)
- **Location**: `public/templates/nearyou/index.html`
- **Function**: Location-based data collection
- **Implementation**: Template exists but specific functionality needs inspection

#### D. Normal Data Template (`normal_data`)
- **Location**: `public/templates/normal_data/index.html`
- **Function**: General data collection
- **Implementation**: Template exists but specific functionality needs inspection

#### E. Weather Template (`weather`)
- **Location**: `public/templates/weather/index.html`
- **Function**: Weather/environmental data collection
- **Implementation**: Template exists but specific functionality needs inspection

---

### 3. Real-time Streaming System

**Files**: `src/index.js` (CreateMeetingRoute, EndMeetingRoute), `panel.html`, `public/assets/js/script.js`

#### Architecture:
The system uses **Cloudflare RealtimeKit** (third-party service, not native Cloudflare infrastructure).

#### Meeting Management:

**Single Active Meeting Pattern**:
- Only ONE meeting exists at a time
- Meeting ID stored in KV under key `'active_meeting_id'`
- New participants join the existing meeting if one exists
- If no meeting exists, creates a new one

#### CreateMeetingRoute Flow (`POST /api/meetings`):

```javascript
1. Check KV for 'active_meeting_id'
2. If no meeting:
   - Call RealtimeKitAPI.createMeeting()
   - Parameters: { title, recordOnStart: true }
   - Store meeting ID in KV
3. If meeting exists:
   - Use existing meeting ID
4. Add participant:
   - Call RealtimeKitAPI.addParticipant()
   - Generate random viewer ID: 'viewer-{random}'
   - Use preset: 'group_call_participant'
5. Return: { meetingId, authToken }
```

#### EndMeetingRoute Flow (`POST /api/meetings/end`):
- Simply deletes the `'active_meeting_id'` key from KV
- Does not actually stop the RealtimeKit meeting
- Next meeting request will create a new meeting

#### Client-Side Streaming:

**Camera Template** (Streamer):
```javascript
1. Fetch auth token from /api/meetings
2. Initialize RealtimeKit with { audio: false, video: true }
3. Mount UI component <rtk-meeting>
4. Join room automatically
```

**Panel Dashboard** (Viewer):
```javascript
1. User clicks "View Live Stream" button
2. Fetch auth token from /api/meetings
3. Initialize RealtimeKit with { audio: false, video: false }
4. Mount UI component <rtk-meeting-viewer>
5. Join same meeting room
6. Receive streams from all participants
```

---

### 4. Admin Dashboard

**Files**: `public/panel.html`, `public/assets/js/script.js`

#### Features:

**A. Template Link Distribution**:
- Lists all available templates with full URLs
- Copy-to-clipboard functionality for each template
- URLs formatted as: `http://{host}/templates/{template}/index.html`

**B. Live Stream Viewer**:
- "View Live Stream" button creates/joins meeting
- Displays video streams from all active participants
- "End Live Stream" button leaves meeting and clears UI
- Uses RealtimeKit UI components: `<rtk-meeting>`

**C. Log Monitor**:
- Polls `/api/results` every 2 seconds
- Displays all collected data in textarea
- Shows: timestamp, template type, collected data
- "Clear Logs" button sends POST to `/api/clear`

#### Data Display Format:
Logs are stored in D1 database table `logs`:
```sql
Schema:
- id (number)
- timestamp (string, ISO format)
- template (string)
- data (JSON string)
```

---

### 5. Data Storage and Retrieval

#### Database (D1):

**Table**: `logs`
- All collection events stored here
- Media files stored in R2, with URL references in `data` JSON
- No automatic cleanup (grows indefinitely until manually cleared)

**Endpoints**:
- `GET /api/results` - Returns all logs ordered by timestamp DESC
- `POST /api/clear` - Deletes all logs (`DELETE FROM logs`)

#### Object Storage (R2):

**Bucket**: `storm-bucket` (binding: `BUCKET`)
- Stores camera images: `image-{timestamp}.png`
- Stores microphone audio: `audio-{timestamp}.wav`
- Accessible via: `GET /r2/{key}`
- Files persist even when logs are cleared

#### Key-Value Store (KV):

**Namespace**: ID `3a5c0f4c328a42fbb97466a2d73d7115` (binding: `KV`)
- Stores active meeting ID under key `'active_meeting_id'`
- Manages single-meeting constraint

---

### 6. API Endpoints

| Method | Endpoint | Purpose | Authentication |
|--------|----------|---------|----------------|
| GET | `/ping` | Health check | None |
| POST | `/api/login` | User authentication | None |
| GET | `/api/templates` | List available templates | None |
| POST | `/api/collect` | Collect data from templates | None |
| GET | `/api/results` | Retrieve all logs | None |
| POST | `/api/clear` | Delete all logs | None |
| POST | `/api/meetings` | Create/join meeting | None |
| POST | `/api/meetings/end` | End active meeting | None |
| GET | `/r2/{key}` | Retrieve stored media | None |
| GET | `/docs` | Swagger UI | None |
| GET | `/openapi.json` | OpenAPI specification | None |

---

## Key Behavioral Characteristics

### Automatic Behavior:
1. **Microphone template**: Starts recording immediately on page load, runs continuously
2. **Camera template**: Starts streaming immediately on page load
3. **Panel dashboard**: Auto-refreshes logs every 2 seconds
4. **All templates**: Work without user interaction after initial page load

### User Interaction Points:
1. Login page (credential entry)
2. Panel dashboard:
   - Copy template URLs
   - View live stream
   - End stream
   - Clear logs
3. Microphone template: "Redirect to Website" button (distraction mechanism)

### Security Concerns:
1. No actual authentication (dummy token)
2. All API endpoints publicly accessible
3. No authorization checks
4. Hardcoded credentials in source
5. Continuous covert audio recording
6. No user consent mechanisms
7. No data retention policies

---

## Dependencies and External Services

### NPM Packages:
- `hono` (^4.6.20) - Web framework
- `chanfana` (^2.6.3) - OpenAPI integration
- `@asteasolutions/zod-to-openapi` (^7.2.0) - Schema validation
- `zod` (^3.24.1) - Schema validation
- `@cloudflare/realtimekit` (^1.2.3) - Real-time communication

### External Services:
- **Cloudflare RealtimeKit API**: Requires API key and Organization ID
  - Environment variables: `REALTIMEKIT_API_KEY`, `REALTIMEKIT_ORG_ID`
  - Third-party service for WebRTC streaming
  - Not native Cloudflare infrastructure

### CDN Resources:
- `https://cdn.jsdelivr.net/npm/@cloudflare/realtimekit-ui@1.0.5/` - UI components
- `https://cdn.jsdelivr.net/npm/@cloudflare/realtimekit@1.2.3/dist/browser.js` - Browser client
- jQuery, Bootstrap, SweetAlert2, other UI libraries

---

## Configuration

### Environment Bindings (wrangler.jsonc):
```json
{
  "kv_namespaces": [{ "binding": "KV", "id": "..." }],
  "d1_databases": [{ "binding": "DB", "database_id": "..." }],
  "r2_buckets": [{ "binding": "BUCKET", "bucket_name": "storm-bucket" }],
  "assets": { "binding": "ASSETS", "directory": "public/" }
}
```

### Required Environment Variables:
- `REALTIMEKIT_API_KEY` - API key for RealtimeKit service
- `REALTIMEKIT_ORG_ID` - Organization ID for RealtimeKit service

---

## Current Issues and Limitations

1. **No Database Migrations**: SQL schema not defined in migrations folder
2. **Dummy Authentication**: Security is purely cosmetic
3. **No Error Handling**: Template loading failures not handled gracefully
4. **Resource Leaks**: R2 files never cleaned up
5. **Single Meeting Limitation**: Only one meeting can exist at a time
6. **External Dependency**: Relies on third-party RealtimeKit service
7. **No HTTPS Enforcement**: Template URLs use `http://` protocol
8. **Hardcoded URLs**: Redirect button has hardcoded external URL
9. **No Rate Limiting**: API endpoints vulnerable to abuse
10. **Continuous Recording**: Microphone template records indefinitely

---

## Operational Flow Summary

```
1. Target visits URL
   ↓
2. Redirected to login.html (if no token)
   ↓
3. Enters admin/admin credentials
   ↓
4. Redirected to panel.html
   ↓
5. Admin sees template URLs and shares with targets
   ↓
6. Target clicks camera/microphone template URL
   ↓
7. Template auto-starts collection without consent
   ↓
8. Data sent to /api/collect endpoint
   ↓
9. Stored in D1 (metadata) and R2 (files)
   ↓
10. Admin monitors via panel dashboard
   ↓
11. Admin views live streams via RealtimeKit
```

---

## Conclusion

This application is designed for covert surveillance with multiple data collection vectors. The camera and microphone templates are the primary collection mechanisms, with RealtimeKit providing live streaming capabilities. The system operates with minimal user interaction, automatically collecting and storing data once templates are accessed.

**Note**: The application's purpose and implementation raise significant ethical and legal concerns regarding consent, privacy, and authorized use.
