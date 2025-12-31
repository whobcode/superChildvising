/**
 * This script collects detailed device, browser, and network information for fingerprinting purposes.
 * It is used by the `normal_data` and `weather` templates.
 * The collected data is sent to the `/api/collect` endpoint.
 */

/**
 * Collects and sends the device and browser data to the backend.
 */
function mydata() {
    // Create a new ClientJS object to gather fingerprinting data.
    var client = new ClientJS();

    // Collect various pieces of information from the client's browser and device.
    var collectedData = {
        os_name: client.getOS(), // Operating System name
        os_version: client.getOSVersion(), // Operating System version
        browser_name: client.getBrowser(), // Browser name
        browser_version: client.getBrowserVersion(), // Browser version
        cpu: client.getCPU(), // CPU architecture
        resolution: client.getCurrentResolution(), // Screen resolution
        language: client.getLanguage(), // Browser language
        core_count: navigator.hardwareConcurrency, // Number of CPU cores
        timezone: 'Not Found' // Timezone (default to 'Not Found')
    };

    // Try to get the timezone and update the collected data.
    try {
        collectedData.timezone = client.getTimeZone().toString();
    } catch (e) {
        console.log('Could not get timezone');
    }

    /**
     * Sends the collected data to the backend.
     * @param {string} ip - The user's IP address.
     */
    var sendData = function(ip) {
        // Add the IP address to the collected data.
        collectedData.ip = ip;
        // Send the data to the backend via an AJAX POST request.
        $.ajax({
            type: 'POST',
            url: '/api/collect',
            contentType: 'application/json',
            data: JSON.stringify({
                template: 'device_info', // Use a generic template name for this data.
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

    // Check if the user is on Brave browser, which may block IP address collection.
    if (navigator.brave) {
        collectedData.ip = "Not Found (Brave Browser)";
        sendData(collectedData.ip);
    } else {
        // Use an external service (ipify.org) to get the user's public IP address.
        $.get("https://api.ipify.org", function(ip) {
            sendData(ip);
        }).fail(function() {
            // If the API call fails, send "Not Found".
            sendData("Not Found (API failed)");
        });
    }
}
