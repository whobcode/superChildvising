(function () {
    class SdpExchangeError extends Error {
        constructor(status, message) {
            super(message);
            this.name = 'SdpExchangeError';
            this.status = status;
        }
    }

    function toAbsoluteUrl(baseUrl, maybeRelativeUrl) {
        try {
            return new URL(maybeRelativeUrl, baseUrl).toString();
        } catch {
            return null;
        }
    }

    function waitForIceGatheringComplete(pc, timeoutMs) {
        if (pc.iceGatheringState === 'complete') return Promise.resolve();

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error('Timed out waiting for ICE gathering.'));
            }, timeoutMs);

            function onStateChange() {
                if (pc.iceGatheringState === 'complete') {
                    cleanup();
                    resolve();
                }
            }

            function cleanup() {
                clearTimeout(timeout);
                pc.removeEventListener('icegatheringstatechange', onStateChange);
            }

            pc.addEventListener('icegatheringstatechange', onStateChange);
        });
    }

    async function postSdp({ url, sdp, signal }) {
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/sdp' },
            body: sdp,
            signal,
        });

        if (!resp.ok) {
            const body = await resp.text().catch(() => '');
            throw new SdpExchangeError(resp.status, `SDP exchange failed: HTTP ${resp.status} ${body}`.trim());
        }

        const answerSdp = await resp.text();
        const location = resp.headers.get('Location');
        const sessionUrl = location ? toAbsoluteUrl(url, location) : null;
        return { answerSdp, sessionUrl };
    }

    async function deleteSession(sessionUrl) {
        if (!sessionUrl) return;
        try {
            await fetch(sessionUrl, { method: 'DELETE' });
        } catch {
            // ignore
        }
    }

    class CloudflareStreamWHIPClient {
        constructor({ url, stream, videoEl, rtcConfig, iceGatheringTimeoutMs }) {
            this.url = url;
            this.stream = stream;
            this.videoEl = videoEl;
            this.rtcConfig = rtcConfig;
            this.iceGatheringTimeoutMs = iceGatheringTimeoutMs ?? 5000;
            this.pc = null;
            this.sessionUrl = null;
            this.abortController = null;
        }

        async start() {
            if (!this.url) throw new Error('Missing WHIP url.');
            if (!this.stream) throw new Error('Missing MediaStream.');

            const pc = new RTCPeerConnection(this.rtcConfig);
            this.pc = pc;
            this.abortController = new AbortController();

            for (const track of this.stream.getTracks()) {
                pc.addTrack(track, this.stream);
            }

            if (this.videoEl) {
                this.videoEl.srcObject = this.stream;
                this.videoEl.muted = true;
                this.videoEl.playsInline = true;
                await this.videoEl.play().catch(() => {});
            }

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            await waitForIceGatheringComplete(pc, this.iceGatheringTimeoutMs);

            const { answerSdp, sessionUrl } = await postSdp({
                url: this.url,
                sdp: pc.localDescription.sdp,
                signal: this.abortController.signal,
            });
            this.sessionUrl = sessionUrl;

            await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
        }

        async stop({ stopTracks } = {}) {
            if (this.abortController) this.abortController.abort();
            await deleteSession(this.sessionUrl);

            if (this.pc) {
                try {
                    this.pc.close();
                } catch {
                    // ignore
                }
            }

            if (stopTracks && this.stream) {
                for (const track of this.stream.getTracks()) {
                    track.stop();
                }
            }

            this.pc = null;
            this.sessionUrl = null;
            this.abortController = null;
        }
    }

    class CloudflareStreamWHEPClient {
        constructor({ url, videoEl, rtcConfig, iceGatheringTimeoutMs }) {
            this.url = url;
            this.videoEl = videoEl;
            this.rtcConfig = rtcConfig;
            this.iceGatheringTimeoutMs = iceGatheringTimeoutMs ?? 5000;
            this.pc = null;
            this.sessionUrl = null;
            this.abortController = null;
            this.remoteStream = null;
        }

        async start() {
            if (!this.url) throw new Error('Missing WHEP url.');
            if (!this.videoEl) throw new Error('Missing video element.');

            const pc = new RTCPeerConnection(this.rtcConfig);
            this.pc = pc;
            this.abortController = new AbortController();

            this.remoteStream = new MediaStream();
            this.videoEl.srcObject = this.remoteStream;
            this.videoEl.playsInline = true;
            this.videoEl.muted = true;
            await this.videoEl.play().catch(() => {});

            pc.addTransceiver('video', { direction: 'recvonly' });
            pc.addTransceiver('audio', { direction: 'recvonly' });

            pc.addEventListener('track', (event) => {
                const track = event.track;
                if (track) this.remoteStream.addTrack(track);
            });

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            await waitForIceGatheringComplete(pc, this.iceGatheringTimeoutMs);

            const { answerSdp, sessionUrl } = await postSdp({
                url: this.url,
                sdp: pc.localDescription.sdp,
                signal: this.abortController.signal,
            });
            this.sessionUrl = sessionUrl;

            await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
        }

        async stop() {
            if (this.abortController) this.abortController.abort();
            await deleteSession(this.sessionUrl);

            if (this.pc) {
                try {
                    this.pc.close();
                } catch {
                    // ignore
                }
            }

            if (this.videoEl) {
                try {
                    this.videoEl.pause();
                } catch {
                    // ignore
                }
                this.videoEl.srcObject = null;
            }

            this.pc = null;
            this.sessionUrl = null;
            this.abortController = null;
            this.remoteStream = null;
        }
    }

    window.CloudflareStreamWHIPClient = CloudflareStreamWHIPClient;
    window.CloudflareStreamWHEPClient = CloudflareStreamWHEPClient;
    window.SdpExchangeError = SdpExchangeError;
})();
