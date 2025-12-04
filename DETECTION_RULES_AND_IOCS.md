# Storm Worker: Detection Rules, Indicators of Compromise (IOCs), and Hunting Queries

## Part 1: Indicators of Compromise (IOCs)

### 1.1 Network IOCs

#### API Endpoint Patterns

```
Protocol: HTTP/HTTPS
Domain: [attacker-controlled domain]

Critical Endpoints:
- POST /api/login (hardcoded admin/admin)
- GET /api/templates (returns 5 templates)
- POST /api/collect (data exfiltration)
- GET /api/results (monitoring)
- POST /api/meetings (WebRTC management)
- POST /api/meetings/end (stream termination)
- GET /r2/{key} (file access)
```

#### Request Signatures

**Authentication Request:**
```
POST /api/login HTTP/1.1
Content-Type: application/json

{"username":"admin","password":"admin"}

Response: {"success":true,"token":"dummy-token"}
```

**Template List:**
```
GET /api/templates HTTP/1.1
Accept: application/json

Response: ["camera_temp","microphone","nearyou","normal_data","weather"]
```

**Microphone Collection (Every 7 seconds):**
```
POST /api/collect HTTP/1.1
Content-Type: application/json
Content-Length: 50000-80000

{"template":"microphone","data":{"audio":"data:audio/wav;base64,[50KB base64]"}}
```

**Image Collection (Continuous):**
```
POST /api/collect HTTP/1.1
Content-Type: application/json
Content-Length: 50000-100000

{"template":"camera_temp","data":{"imageUrl":"/r2/image-1704067200000.png"}}
```

**Location Collection:**
```
POST /api/collect HTTP/1.1
Content-Type: application/json

{"template":"nearyou","data":{"latitude":37.7749,"longitude":-122.4194,"map_url":"https://google.com/maps/place/37.7749+-122.4194"}}
```

**Device Fingerprint:**
```
POST /api/collect HTTP/1.1
Content-Type: application/json

{"template":"normal_data","data":{"os":"Windows 10","browser":"Chrome 120","screen":"1920x1080","ip":"203.0.113.42"}}
```

**Results Polling (Every 2 seconds):**
```
GET /api/results HTTP/1.1
Accept: application/json

Response: [{"id":1,"timestamp":"2024-01-01T12:00:00","template":"microphone","data":"..."}]
```

#### File Storage Patterns

```
R2 Bucket Storage:
image-{unix_timestamp_milliseconds}.png
audio-{unix_timestamp_milliseconds}.wav

Example:
image-1704067200000.png
image-1704067260000.png
image-1704067320000.png

audio-1704067200000.wav
audio-1704067207000.wav
audio-1704067214000.wav
```

#### RealtimeKit Infrastructure

```
External API Calls:
- RealtimeKit API endpoints (domain varies, check credentials)
- cdn.jsdelivr.net (RealtimeKit client libraries)
- ipify.org (external IP lookup for device fingerprinting)

WebRTC Indicators:
- STUN packets to RealtimeKit TURN servers
- DTLS/SRTP encrypted WebRTC traffic
- Unusual audio/video codec usage
```

### 1.2 File & Directory IOCs

#### R2 Storage Contents
```
storm-bucket/
├── image-1704067200000.png
├── image-1704067260000.png
├── image-1704067320000.png
├── audio-1704067200000.wav
├── audio-1704067207000.wav
├── audio-1704067214000.wav
└── [continuing in patterns]

Characteristics:
- Only PNG and WAV files
- Millisecond timestamps in filenames
- Regular intervals (images every ~60 seconds, audio every ~7 seconds)
- Sizes: 50-100KB for images, 40-80KB for audio
```

#### Browser Cache Artifacts
```
localStorage:
- Key: "token"
- Value: "dummy-token" (if compromised)

Browser Cache:
- login.html
- panel.html
- script.js (dashboard logic)
- JSON responses from /api/ endpoints
```

### 1.3 Database IOCs

#### D1 Database Schema
```sql
SELECT * FROM logs;

id | timestamp | template | data
---|-----------|----------|------
1  | 2024-01-01 12:00:00 | microphone | {"audioUrl": "/r2/audio-1704067200000.wav"}
2  | 2024-01-01 12:00:07 | microphone | {"audioUrl": "/r2/audio-1704067207000.wav"}
3  | 2024-01-01 12:00:15 | camera_temp | {"imageUrl": "/r2/image-1704067200000.png"}
4  | 2024-01-01 12:00:30 | nearyou | {"latitude": 37.7749, "longitude": -122.4194, "map_url": "..."}
5  | 2024-01-01 12:00:45 | normal_data | {"os": "Windows 10", "browser": "Chrome", "ip": "203.0.113.42"}
```

**Detection Pattern:**
- Timestamps in regular intervals (7 seconds for audio, 60 seconds for images)
- Multiple templates from same timestamp range
- GPS coordinates with Google Maps URLs
- Exact hardcoded strings: "nearyou", "microphone", "camera_temp", "normal_data", "weather"

---

## Part 2: Detection Rules

### 2.1 Snort/Suricata Rules

#### Rule 1: API Login Detection
```
alert http any any -> any any (
    msg:"Storm Worker - Login Attempt to /api/login";
    flow:to_server,established;
    content:"POST";
    http_method;
    content:"/api/login";
    http_uri;
    content:"application/json";
    http_header;
    content:"username";
    http_client_body;
    content:"password";
    http_client_body;
    classtype:attempted-admin;
    sid:1000001;
    rev:1;
    priority:1;
)
```

#### Rule 2: Microphone Data Exfiltration (Pattern)
```
alert http any any -> any any (
    msg:"Storm Worker - Audio Collection Endpoint";
    flow:to_server,established;
    content:"POST";
    http_method;
    content:"/api/collect";
    http_uri;
    content:"microphone";
    http_client_body;
    content:"audio/wav|3b|base64";
    http_client_body;
    threshold:type threshold,track by_src,count 1,seconds 1;
    classtype:suspicious-data-exfiltration;
    sid:1000002;
    rev:1;
    priority:2;
)
```

#### Rule 3: Location Data Collection
```
alert http any any -> any any (
    msg:"Storm Worker - GPS Location Collection";
    flow:to_server,established;
    content:"POST";
    http_method;
    content:"/api/collect";
    http_uri;
    content:"latitude";
    http_client_body;
    content:"longitude";
    http_client_body;
    content:"nearyou";
    http_client_body;
    classtype:suspicious-data-exfiltration;
    sid:1000003;
    rev:1;
    priority:2;
)
```

#### Rule 4: Dashboard Polling Pattern
```
alert http any any -> any any (
    msg:"Storm Worker - Admin Dashboard Polling";
    flow:to_server,established;
    content:"GET";
    http_method;
    content:"/api/results";
    http_uri;
    threshold:type threshold,track by_src,count 10,seconds 30;
    classtype:command-and-control;
    sid:1000004;
    rev:1;
    priority:3;
)
```

#### Rule 5: WebRTC Meeting Creation
```
alert http any any -> any any (
    msg:"Storm Worker - WebRTC Meeting Endpoint";
    flow:to_server,established;
    content:"POST";
    http_method;
    content:"/api/meetings";
    http_uri;
    content:"application/json";
    http_header;
    classtype:command-and-control;
    sid:1000005;
    rev:1;
    priority:2;
)
```

#### Rule 6: File Enumeration (R2 Storage)
```
alert http any any -> any any (
    msg:"Storm Worker - R2 Storage Access";
    flow:to_server,established;
    content:"GET";
    http_method;
    content:"/r2/";
    http_uri;
    content:"image-";
    http_uri;
    OR;
    content:"audio-";
    http_uri;
    classtype:web-application-activity;
    sid:1000006;
    rev:1;
    priority:3;
)
```

#### Rule 7: Template List Enumeration
```
alert http any any -> any any (
    msg:"Storm Worker - Template List Fetch";
    flow:to_server,established;
    content:"GET";
    http_method;
    content:"/api/templates";
    http_uri;
    content:"application/json";
    http_header;
    classtype:web-application-activity;
    sid:1000007;
    rev:1;
    priority:3;
)
```

---

### 2.2 Splunk Detection Queries

#### Query 1: Detect Login Attempts
```spl
index=web_logs
  method=POST
  uri="/api/login"
  | stats count by src_ip, username
  | where count > 5
```

#### Query 2: Find Audio Exfiltration Pattern
```spl
index=web_logs
  method=POST
  uri="/api/collect"
  body="*microphone*"
  body="*audio/wav;base64*"
  | stats count by src_ip, user_agent
  | eval expected=count/7  # Expected one request every 7 seconds
  | where count > 10
```

#### Query 3: Continuous Location Collection
```spl
index=web_logs
  method=POST
  uri="/api/collect"
  body="*nearyou*"
  body="*latitude*"
  body="*longitude*"
  | stats count by src_ip, client_lat, client_lon
  | search count >= 1
```

#### Query 4: Admin Panel Polling
```spl
index=web_logs
  method=GET
  uri="/api/results"
  | stats count, avg(response_time), latest(_time) by src_ip
  | where count > 100  # More than 100 requests (>3 minutes of polling)
```

#### Query 5: Multiple Data Collection in Sequence
```spl
index=web_logs
  uri="/api/collect"
  | stats count by src_ip, body
  | eval templates=mvcount(body)
  | where templates > 3  # Multiple different templates from one IP
```

#### Query 6: Camera Stream Session
```spl
index=web_logs
  (method=POST uri="/api/meetings" body="*Camera*")
  OR (method=GET uri="/api/results" earliest=-30m)
  | stats count, latest(_time) by src_ip
  | where count > 1
```

---

### 2.3 Zeek (formerly Bro) Detection

#### Zeek Script: API Endpoint Detection
```zeek
@load base/frameworks/notice

module StormWorker;

export {
    redef enum Notice::Type += {
        StormWorker::APILogin,
        StormWorker::DataCollection,
        StormWorker::ResultsPolling,
    };
}

event http_request(c: connection, method: string, uri: string, version: string, headers: http_message_headers, body: string) {
    if (/\/api\/login/ in uri && method == "POST") {
        NOTICE([$note=StormWorker::APILogin,
                $conn=c,
                $msg=fmt("Storm Worker login attempt to %s", uri)]);
    }

    if (/\/api\/collect/ in uri && method == "POST") {
        if (/microphone|latitude|longitude|nearyou|normal_data/ in body) {
            NOTICE([$note=StormWorker::DataCollection,
                    $conn=c,
                    $msg=fmt("Storm Worker data collection detected")]);
        }
    }

    if (/\/api\/results/ in uri && method == "GET") {
        NOTICE([$note=StormWorker::ResultsPolling,
                $conn=c,
                $msg=fmt("Storm Worker admin polling detected")]);
    }
}
```

---

### 2.4 Yara Rules

#### Rule: Detect Storm Worker JavaScript Patterns
```yara
rule StormWorker_JavaScript {
    meta:
        description = "Detects Storm Worker client-side JavaScript patterns"
        author = "Security Team"
        date = "2024-01-01"

    strings:
        $api1 = "/api/collect" ascii
        $api2 = "/api/meetings" ascii
        $api3 = "/api/results" ascii
        $template1 = "microphone" ascii
        $template2 = "camera_temp" ascii
        $template3 = "nearyou" ascii
        $realtime = "RealtimeKitClient" ascii
        $getUserMedia = "getUserMedia" ascii
        $geolocation = "getCurrentPosition" ascii

        // 6-second interval pattern
        $interval = "6000" ascii

        // Data URI encoding
        $datauri = "data:audio/wav;base64" ascii nocase
        $base64prefix = "data:image" ascii

    condition:
        (any of ($api*)) and (any of ($template*)) and
        ((4 of them) or ($realtime and $getUserMedia and $geolocation))
}

rule StormWorker_Backend {
    meta:
        description = "Detects Storm Worker backend code patterns"
        author = "Security Team"

    strings:
        $hono = "Hono" ascii
        $realtimekit = "RealtimeKitAPI" ascii
        $d1 = "D1Database" ascii
        $kv = "ACTIVE_MEETING_KEY" ascii
        $bucket = "BUCKET.put" ascii
        $login = "dummy-token" ascii

    condition:
        4 of them
}
```

---

## Part 3: Hunting Queries & Threat Hunting Playbooks

### 3.1 Network Hunting Queries

#### Hunt 1: Find Command & Control Servers
```
Goal: Identify domain(s) hosting Storm Worker

Query:
  Find all HTTP requests with pattern:
  - POST /api/login
  - GET /api/templates
  - POST /api/collect (with base64 payload)

Filter by:
  - Status code 200 (successful responses)
  - Content-Type: application/json
  - Presence of "microphone", "camera_temp", "nearyou" in response

Result: Suspicious domain(s)
```

#### Hunt 2: Identify Victim Endpoints
```
Goal: Find compromised user devices

Indicators:
  1. Outbound POST /api/collect requests (frequency: every 6-7 seconds)
  2. Outbound GET /api/results requests (frequency: every 2 seconds)
  3. WebRTC STUN/TURN traffic to unusual infrastructure
  4. Base64-encoded media in POST bodies (50-100KB)
  5. Geolocation API calls with enableHighAccuracy=true

Query Pattern:
  - Track internal IPs initiating these connections
  - Correlate multiple indicators (audio + geolocation + camera)
  - Look for persistence (hours/days of collection)

Result: List of compromised endpoints
```

#### Hunt 3: Identify Attacker Control Points
```
Goal: Find attacker admin panel usage

Indicators:
  1. Regular GET /api/results requests (every 2 seconds)
  2. POST /api/meetings with "Camera Stream Viewer" title
  3. High volume of data retrieval
  4. Long session duration (hours/days)

Query Pattern:
  SELECT src_ip, COUNT(*) as request_count, AVG(response_size) as avg_response
  FROM http_logs
  WHERE uri="/api/results"
  GROUP BY src_ip
  HAVING COUNT(*) > 100

Result: Attacker IP address(es)
```

---

### 3.2 Endpoint Detection & Response (EDR) Hunting

#### Hunt 1: Microphone Activity Baseline Deviation
```
Goal: Find abnormal microphone usage

Baseline:
- Microphone used during: Teams calls, Zoom meetings, voice typing
- Typical duration: Minutes (meetings), not continuous
- Typical pattern: User-initiated

Anomaly Indicators:
- Continuous microphone access (hours without interruption)
- No corresponding application (browser only)
- No user interaction required (auto-start)
- Regular interval pattern (every 6 seconds)
- Audio data exfiltration (base64 encoding)

Hunting:
1. Monitor AudioDeviceMonitor logs
2. Alert on continuous microphone access without expected application
3. Correlate with network traffic (POST to /api/collect)
4. Check browser localStorage for auth tokens

Action:
- Kill browser process
- Revoke microphone permissions
- Isolate endpoint
```

#### Hunt 2: Camera Activity Without User Awareness
```
Goal: Find webcam surveillance

Indicators:
- Camera LED activation without user action
- WebRTC connection initialization to unknown infrastructure
- RealtimeKit library loading (check browser cache)
- High-frequency image capture (frames every second)

Hunting:
1. Review camera access logs (Windows: Settings → Camera)
2. Check for RealtimeKit DLL/JS libraries in cache
3. Monitor for WebRTC peer connections
4. Network traffic analysis (WebRTC to RealtimeKit)

Timeline Analysis:
0:00 - camera_temp page loaded
0:05 - Camera permission granted
0:06 - /api/meetings called (WebRTC starts)
0:07 - WebRTC connection established
0:08+ - Continuous video stream

Action:
- Disable camera hardware
- Block domain at firewall
- Clear browser cache
```

#### Hunt 3: Persistent Permission Grants
```
Goal: Find unusual permission patterns

Indicators:
- Camera, microphone, AND geolocation permissions to same domain
- All granted within 5-30 second window
- No legitimate reason for all three together

Hunting:
1. Check browser permission history
2. Document grant timestamp and type
3. Correlate with page title (camera_temp, microphone, nearyou, weather)
4. Check localStorage for token value
5. Review network traffic timing

Detection Query:
  Find all sites with 3+ permissions granted simultaneously
  Exclude known legitimate apps (Teams, Zoom, Maps)
  Check for /api/collect patterns in subsequent traffic

Action:
- Document domain
- Revoke permissions
- Block domain
- Scan endpoint
```

---

## Part 4: Incident Response Hunting Kit

### 4.1 Quick Response Checklist

#### Discovery Phase (0-15 minutes)
```
☐ 1. Identify affected systems
   - Check with user about suspicious popups/notifications
   - Review browser history for unusual domains
   - Check camera/microphone status/activity

☐ 2. Confirm compromise
   - Open DevTools (F12) → Application → localStorage
   - Look for "token" key with value "dummy-token"
   - Check Network tab for /api/ requests

☐ 3. Preserve evidence
   - Take screenshot of localStorage contents
   - Export browser history (last 24 hours)
   - Capture network traffic (PCAP if possible)
   - Screenshot taskbar/system tray for unusual processes
```

#### Containment Phase (15-30 minutes)
```
☐ 1. Network isolation
   - Disconnect from network (cable if possible)
   - Disable WiFi and Bluetooth
   - Close all browser windows

☐ 2. Hardware isolation
   - Disable/unplug microphone
   - Disable/unplug or cover camera
   - Disable GPS (mobile devices)
   - Disable location services

☐ 3. Browser remediation
   - Clear localStorage: DevTools → Application → LocalStorage → Clear All
   - Clear cookies: Settings → Privacy → Clear browsing data (All time)
   - Disable microphone/camera permissions: Settings → Privacy
   - Disable JavaScript temporarily

☐ 4. System-level actions
   - Kill browser process (if needed)
   - Disable microphone/camera in device manager
   - Disable GPS service
```

#### Investigation Phase (30 minutes - ongoing)
```
☐ 1. Domain identification
   - Browser history → Find suspicious domain
   - Extract domain name and access timestamp
   - Document all pages visited on that domain

☐ 2. Network analysis
   - Export network logs (if available)
   - Identify all POST requests to /api/collect
   - Count requests by template type
   - Calculate data exfiltration volume

☐ 3. Forensic collection
   - Export browser cache (all files from suspicious domain)
   - Dump browser process memory (if authorized)
   - Preserve browser history export
   - Document permission grant times

☐ 4. Timeline reconstruction
   - When did user visit malicious domain?
   - When were permissions granted?
   - How long was collection running?
   - What data types were collected?
```

#### Recovery Phase (ongoing)
```
☐ 1. System cleanup
   - Clear browser cache completely
   - Clear browser history
   - Uninstall any suspicious extensions
   - Update browser to latest version

☐ 2. Security hardening
   - Enable browser security features:
     * Strict Site Isolation
     * Enhanced Safe Browsing
     * HTTPS-Only Mode
   - Enable OS-level protection:
     * Windows Defender (update definitions)
     * Firewall (enable if disabled)
   - Change passwords for affected accounts

☐ 3. Monitoring
   - Watch for re-infection (same domain)
   - Monitor browser logs for 24 hours
   - Check permission settings weekly
   - Review network traffic for similar patterns
```

---

### 4.2 Forensic Analysis Template

#### Evidence Collection Form

```
INCIDENT REPORT: Storm Worker Compromise
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Incident Date: _______________
Affected System: _____________
Hostname: __________________
IP Address: __________________

DISCOVERY DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Discovery Method: ☐ User Report ☐ Monitoring ☐ Scan ☐ Other: _____
Discovery Time: _______________
Discoverer: __________________

COMPROMISE DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Malicious Domain: __________________
Page Visited: /templates/____________________
Time of Visit: _______________
Estimated Duration: _______________

PERMISSIONS GRANTED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
☐ Camera     Time: _______ Granted: ☐ Yes ☐ No
☐ Microphone Time: _______ Granted: ☐ Yes ☐ No
☐ Location   Time: _______ Granted: ☐ Yes ☐ No

DATA EXFILTRATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Template Type        | Count | Duration | Estimated Data
microphone          | ___   | ___ min  | ___ MB
camera_temp         | ___   | ___ min  | ___ MB
nearyou             | ___   | ___ min  | ___ KB
normal_data         | ___   | ___ min  | ___ KB
weather             | ___   | ___ min  | ___ KB

Total Exfiltration: ___ MB

ARTIFACTS COLLECTED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
☐ Browser cache export: ____________
☐ localStorage dump: ____________
☐ Browser history export: ____________
☐ Network PCAP: ____________
☐ Screenshot(s): ____________
☐ Memory dump: ____________

INVESTIGATION FINDINGS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[Investigation notes, timeline, IOCs found]
```

---

## Part 5: Threat Intelligence Sharing

### 5.1 STIX/MISP Format

#### Domain Indicator
```xml
<indicator type="DOMAIN">
    <pattern>[domain:value = 'attacker-domain.com']</pattern>
    <valid_from>2024-01-01T00:00:00Z</valid_from>
    <title>Storm Worker Command & Control Server</title>
    <description>Malware infrastructure hosting surveillance templates and data collection endpoints</description>
    <labels>Malware, Remote Access Trojan, Surveillance</labels>
    <kill_chain>C2, Initial Access</kill_chain>
</indicator>
```

#### File Hash Indicator
```xml
<indicator type="FILE">
    <pattern>[file:hashes.MD5 = '...']</pattern>
    <title>Storm Worker _app.js Microphone Collector</title>
    <description>Client-side JavaScript for continuous audio recording and exfiltration</description>
    <hash_type>MD5</hash_type>
</indicator>
```

#### Network Traffic Indicator
```xml
<indicator type="URI">
    <pattern>[url:value MATCHES 'http[s]?://[^/]*/api/collect']</pattern>
    <title>Storm Worker Data Collection Endpoint</title>
    <description>POST /api/collect receives base64-encoded media and device fingerprints</description>
</indicator>
```

---

## Part 6: Threat Hunting Dashboard Queries

### For Popular SIEM Platforms

#### Splunk Dashboard Panel
```spl
<dashboard>
  <label>Storm Worker Threat Hunting</label>
  <row>
    <panel>
      <title>API Collection Activity</title>
      <single>
        <search>
          index=web_logs uri="/api/collect" | stats count
        </search>
      </single>
    </panel>
    <panel>
      <title>Data Exfiltration by Type</title>
      <chart>
        <search>
          index=web_logs uri="/api/collect"
          | rex field=body "\"template\":\"(?&lt;template&gt;\w+)\""
          | stats count by template
        </search>
      </chart>
    </panel>
  </row>
  <row>
    <panel>
      <title>Admin Polling Activity</title>
      <table>
        <search>
          index=web_logs uri="/api/results"
          | stats count, latest(_time) by src_ip
          | where count > 100
        </search>
      </table>
    </panel>
  </row>
</dashboard>
```

---

## Conclusion

This detection rules and IOCs document provides:

1. **Network-Level Detection** - API patterns and request signatures
2. **Endpoint Detection** - Process-level, file, and behavioral indicators
3. **Database Detection** - Log patterns and timing analysis
4. **Hunting Queries** - Splunk, Zeek, and YARA rules
5. **Incident Response** - Quick checklists and forensic templates
6. **Threat Intelligence** - Shareable IOCs in STIX/MISP format

**Implementation Priority:**

| Priority | Detection Method | Effort | Impact |
|----------|-----------------|--------|--------|
| CRITICAL | Network signature for /api/collect | Low | High |
| CRITICAL | Permission grant monitoring | Medium | High |
| HIGH | Microphone activity baselining | High | High |
| HIGH | Camera access correlation | High | Medium |
| MEDIUM | LogicalVolume polling detection | Low | Medium |
| MEDIUM | WebRTC traffic analysis | Medium | Low |

---

**Document Version:** 1.0
**Last Updated:** January 2024
**Status:** Active Detection

