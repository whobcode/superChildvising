/**
 * This script handles the functionality of the admin dashboard, including log polling,
 * template link generation, and live stream viewing.
 */

// --- Authentication Check ---
// If there is no token in local storage, redirect the user to the login page.
if (!localStorage.getItem('token')) {
    window.location.href = 'login.html';
}

// --- Log Polling ---
/**
 * Fetches the latest logs from the server and updates the log display.
 */
function Listener() {
    $.get("/api/results", function(data) {
        // Only update the display if the data has changed.
        if ($("#result").val() !== data) {
            $("#result").val(data);
        }
    });
}

// --- Document Ready ---
$(document).ready(function() {
    // Start the log listener to poll for new logs every 2 seconds.
    let logInterval = setInterval(Listener, 2000);

    // --- Template Link Generation ---
    // Fetch the list of available templates from the server.
    $.get("/api/templates", function(get_json) {
        // For each template, create a link and a "Copy" button.
        for (let i = 0; i < get_json.length; i++) {
            $("#links").append('<div class="mt-2 d-flex justify-content-center" ><p id="path" class="form-control m-1 w-50 ptext">' + "http://" + location.host + "/templates/" + get_json[i] + "/index.html" + '</p><span class="input-group-btn m-1 cp-btn"><button class="btn btn-default" type="button" id="copy-button" data-toggle="tooltip" data-placement="button" title="Copy to Clipboard">Copy </button></span></div>')
        }

        // Add a click handler to the "Copy" buttons to copy the link to the clipboard.
        $(".cp-btn").click(function() {
            var node = $(this).parent().get(0).childNodes[0].textContent
            navigator.clipboard.writeText(node);
            // Show a success message to the user.
            Swal.fire({
                icon: 'success',
                title: 'The link was copied!',
                text: node
            })
        });
    });

    // --- Live Stream Viewer ---
    let meeting = null;

    // Handle the "View Live Stream" button click.
    $('#btn-view-stream').click(async function() {
        try {
            // Request a new meeting from the backend.
            const resp = await fetch('/api/meetings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: 'Camera Stream Viewer' }),
            });
            const { authToken } = await resp.json();

            // If no auth token is returned, show an error.
            if (!authToken) {
                alert('Failed to get auth token for viewer');
                return;
            }

            // Initialize the RealtimeKit client for viewing (no audio/video).
            meeting = await RealtimeKitClient.init({
                authToken,
                defaults: {
                    audio: false,
                    video: false,
                },
            });

            // Show the stream container and update the button states.
            $('#stream-container').show();
            $('#btn-view-stream').hide();
            $('#btn-end-stream').show();
            // Mount the meeting UI and join the room.
            document.getElementById('rtk-meeting-viewer').meeting = meeting;
            meeting.joinRoom();

        } catch (e) {
            console.error(e);
            alert('An error occurred while setting up the stream viewer.');
        }
    });

    // Handle the "End Live Stream" button click.
    $('#btn-end-stream').click(async function() {
        // If there is an active meeting, leave the room.
        if (meeting) {
            await meeting.leaveRoom();
        }
        // Tell the backend to end the active meeting.
        await fetch('/api/meetings/end', { method: 'POST' });

        // Hide the stream container, update button states, and reset the meeting UI.
        $('#stream-container').hide();
        $('#btn-view-stream').show();
        $('#btn-end-stream').hide();
        $('#rtk-meeting-viewer').remove();
        $('#stream-container').append('<rtk-meeting id="rtk-meeting-viewer" style="height: 100vh; width: 100vw;"></rtk-meeting>');
    });

    // Handle the "Clear Logs" button click.
    $('#btn-clear-logs').click(function() {
        // Send a request to the backend to clear all logs.
        $.post("/api/clear", function() {
            // Clear the log display.
            $("#result").val("");
        });
    });
});
