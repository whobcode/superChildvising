if (!localStorage.getItem('token')) {
    window.location.href = 'login.html';
}

function safeJsonParse(value) {
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

function formatLogEntry(entry) {
    const timestamp = entry?.timestamp ?? '';
    const template = entry?.template ?? '';
    const id = entry?.id ?? '';

    const parsedData = safeJsonParse(entry?.data);
    let dataString = '';
    if (parsedData === undefined) {
        dataString = '';
    } else if (typeof parsedData === 'string') {
        dataString = parsedData;
    } else {
        dataString = JSON.stringify(parsedData, null, 2);
    }

    return `#${id} ${timestamp} [${template}]\n${dataString}`;
}

function formatLogs(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return '';
    return entries.map(formatLogEntry).join('\n\n');
}

function Listener() {
    $.ajax({
        url: "/api/results",
        method: "GET",
        dataType: "json",
        success: function(data) {
            const formatted = formatLogs(data);
            if ($("#result").val() !== formatted) {
                $("#result").val(formatted);
            }
        },
        error: function(xhr) {
            const msg = `Failed to fetch logs (${xhr.status}).`;
            if ($("#result").val() !== msg) {
                $("#result").val(msg);
            }
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

    let whepClient = null;

    $('#btn-view-stream').click(async function() {
        try {
            const resp = await fetch('/api/stream/play');
            const { whepUrl } = await resp.json();

            if (!whepUrl) {
                alert('Failed to get Stream playback URL');
                return;
            }

            const videoEl = document.getElementById('stream-video');
            whepClient = new CloudflareStreamWHEPClient({ url: whepUrl, videoEl });
            await whepClient.start();

            $('#stream-container').show();
            $('#btn-view-stream').hide();
            $('#btn-end-stream').show();

        } catch (e) {
            console.error(e);
            if (e && e.name === 'SdpExchangeError' && e.status === 409) {
                alert('Live broadcast not started yet. Open /templates/camera_temp/index.html, allow camera access, then try again.');
                return;
            }
            alert('An error occurred while setting up Stream playback.');
        }
    });

    $('#btn-end-stream').click(async function() {
        try {
            if (whepClient) {
                await whepClient.stop();
            }
        } catch (e) {
            console.error(e);
        } finally {
            whepClient = null;
        }

        $('#stream-container').hide();
        $('#btn-view-stream').show();
        $('#btn-end-stream').hide();
    });

    $('#btn-clear-logs').click(function() {
        $.post("/api/clear", function() {
            $("#result").val("");
        });
    });
});
