var ipAddressOnePage = "https://secure.oceanpayment.com";
var Oceanpayment = {
	init : function($isSandBox,$cssUrl,$language,$configuration) {
		if($isSandBox){
			ipAddressOnePage = "https://test-secure.oceanpayment.com";
		}
		document.getElementById("oceanpayment-element").innerHTML = '<iframe id="oceanpayment-iframe-card" name="oceanpayment-iframe-card" width="100%" style="overflow-x : hidden;overflow-y : hidden;" src="' + ipAddressOnePage + '/gateway/direct/checkpage?language=' +$language+ '" frameborder="0" height="131" seamless></iframe>';
        //获取iframe元素
        var iframe = document.getElementById("oceanpayment-iframe-card");
        //iframe网页IP:PORT
        var childDomain = ipAddressOnePage;
		var showCardName = false;
		if ($configuration && $configuration.showCardName) {
			showCardName = true;
		}
		iframe.onload = function(){
			//发送消息到iframe网页
			iframe.contentWindow.postMessage({'methodType':'init','cssUrl':$cssUrl,'language':$language,'backUrl':window.parent.location.href,'showCardName':showCardName}, childDomain);
		};
	},
	checkout : function($data){
        //获取iframe元素
        var iframe = document.getElementById("oceanpayment-iframe-card");
        //iframe网页IP:PORT
        var childDomain = ipAddressOnePage;
        //发送消息到iframe网页
        iframe.contentWindow.postMessage($data, childDomain);
	}
}
window.addEventListener('message',function(e) {
	if (e.origin == "https://secure.oceanpayment.com" || e.origin == "https://test-secure.oceanpayment.com") {
		let code = e.data.code;
		let method = e.data.method;
		try {
			var parser=new DOMParser();
			var xmldoc = parser.parseFromString(e.data,'text/xml');
			if(xmldoc.getElementsByTagName("methods").length > 0){
				method = xmldoc.getElementsByTagName("methods")[0].textContent;
			}
			if (method == 'Credit Card') {
				//自适应高度
				reinitIframeCard(e.data.height);
			}
			let terminalIndex = e.data.toString().indexOf("terminal");
			if (code != undefined || terminalIndex != -1) {
				//只有code不为1 时才会给商户发送消息
				if (code != 1 && method == 'Credit Card') {
					delete e.data.height;
					oceanpaymentCallBack(e.data);
				}
			}
		} catch (ex) {
			//只有code不为1 时才会给商户发送消息
			if (code != 1 && method == 'Credit Card') {
				delete e.data.height;
				oceanpaymentCallBack(e.data);
			}
		}
	}
});


function reinitIframeCard(heightData) {
	var iframe = document.getElementById("oceanpayment-iframe-card");
	try {
		if (heightData != undefined && heightData != '') {
			iframe.height = heightData;
		}
	} catch (ex) {
		console.log(ex);
		iframe.height = 200;
	}
}
