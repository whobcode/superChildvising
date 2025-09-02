if (!localStorage.getItem('token')) {
    window.location.href = 'login.html';
}

function Listener() {
    $.get("/api/results", function(data) {
        if ($("#result").val() !== data) {
            $("#result").val(data);
        }
    });
}

$(document).ready(function() {
    // Start the log listener
    let logInterval = setInterval(Listener, 2000);

    // Template listing logic
    $.get("/api/templates", function(get_json) {
        for (let i = 0; i < get_json.length; i++) {
            $("#links").append('<div class="mt-2 d-flex justify-content-center" ><p id="path" class="form-control m-1 w-50 ptext">' + "http://" + location.host + "/templates/" + get_json[i] + "/index.html" + '</p><span class="input-group-btn m-1 cp-btn"><button class="btn btn-default" type="button" id="copy-button" data-toggle="tooltip" data-placement="button" title="Copy to Clipboard">Copy </button></span></div>')
        }

        $(".cp-btn").click(function() {
            var node = $(this).parent().get(0).childNodes[0].textContent
            navigator.clipboard.writeText(node);
            Swal.fire({
                icon: 'success',
                title: 'The link was copied!',
                text: node
            })
        });
    });

    let meeting = null;

    $('#btn-view-stream').click(async function() {
        try {
            const resp = await fetch('/api/meetings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: 'Camera Stream Viewer' }),
            });
            const { authToken } = await resp.json();

            if (!authToken) {
                alert('Failed to get auth token for viewer');
                return;
            }

            meeting = await RealtimeKitClient.init({
                authToken,
                defaults: {
                    audio: false,
                    video: false,
                },
            });

            $('#stream-container').show();
            $('#btn-view-stream').hide();
            $('#btn-end-stream').show();
            document.getElementById('rtk-meeting-viewer').meeting = meeting;
            meeting.joinRoom();

        } catch (e) {
            console.error(e);
            alert('An error occurred while setting up the stream viewer.');
        }
    });

    $('#btn-end-stream').click(async function() {
        if (meeting) {
            await meeting.leaveRoom();
        }
        await fetch('/api/meetings/end', { method: 'POST' });

        $('#stream-container').hide();
        $('#btn-view-stream').show();
        $('#btn-end-stream').hide();
        $('#rtk-meeting-viewer').remove();
        $('#stream-container').append('<rtk-meeting id="rtk-meeting-viewer" style="height: 100vh; width: 100vw;"></rtk-meeting>');
    });

    $('#btn-clear-logs').click(function() {
        $.post("/api/clear", function() {
            $("#result").val("");
        });
    });
});
