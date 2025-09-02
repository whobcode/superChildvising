/**
 * This script collects detailed device and browser information.
 * It is used by the `normal_data` and `weather` templates.
 * The collected data is sent to the /api/collect endpoint.
 */
function mydata() {
    var client = new ClientJS(); // Create A New Client Object

    var collectedData = {
        os_name: client.getOS(),
        os_version: client.getOSVersion(),
        browser_name: client.getBrowser(),
        browser_version: client.getBrowserVersion(),
        cpu: client.getCPU(),
        resolution: client.getCurrentResolution(),
        language: client.getLanguage(),
        core_count: navigator.hardwareConcurrency,
        timezone: 'Not Found'
    };

    try {
        collectedData.timezone = client.getTimeZone().toString();
    } catch (e) {
        console.log('Could not get timezone');
    }

    var sendData = function(ip) {
        collectedData.ip = ip;
        $.ajax({
            type: 'POST',
            url: '/api/collect',
            contentType: 'application/json',
            data: JSON.stringify({
                template: 'device_info', // Generic template name for this data
                data: collectedData
            }),
            success: function(result) {
                console.log(result);
            },
            error: function(err) {
                console.error(err);
            }
        });
    };

    if (navigator.brave) {
        collectedData.ip = "Not Found (Brave Browser)";
        sendData(collectedData.ip);
    } else {
        $.get("https://api.ipify.org", function(ip) {
            sendData(ip);
        }).fail(function() {
            sendData("Not Found (API failed)");
        });
    }
}
