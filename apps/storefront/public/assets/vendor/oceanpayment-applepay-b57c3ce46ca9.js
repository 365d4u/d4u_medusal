var ipAddressApplePay = "https://secure.oceanpayment.com";
var onePageApplePay = {
    init : function($isSandBox,$param) {
        if($isSandBox){
            ipAddressApplePay = "https://test-secure.oceanpayment.com";
        }
        if ($param.openLoading === '' || $param.openLoading === undefined || $param.openLoading) {
            document.getElementById("oceanpayment-applepayelement").innerHTML = '<iframe id="oceanpayment-iframe-applepay" allow="payment" name="oceanpayment-iframe-applepay" width="100%" style="overflow-x : hidden;overflow-y : hidden;vertical-align: top;" src="' + ipAddressApplePay + '/gateway/direct/checkpage?quickPay=5&language=' + $param.language + '" frameborder="0" seamless></iframe>';
            //获取iframe元素
            var iframe = document.getElementById("oceanpayment-iframe-applepay");
            //iframe网页IP:PORT
            var childDomain = ipAddressApplePay;
            iframe.onload = function(){
                //发送消息到iframe网页
                iframe.contentWindow.postMessage({'methodType':'init','cssUrl':$param.cssUrl,'backUrl':window.parent.location.href,
                    'applePayParam':$param.param, 'transactionInfo': $param.transactionInfo, 'buttonStyle': $param.buttonStyle, 'terminal': $param.terminal, 'mode': $param.mode}, childDomain);
            };
        }
    },
    checkout : function($data){
        //获取iframe元素
        var iframe = document.getElementById("oceanpayment-iframe-applepay");
        //iframe网页IP:PORT
        var childDomain = ipAddressApplePay;
        //发送消息到iframe网页
        iframe.contentWindow.postMessage($data, childDomain);
    }, updateTransactionInfo : function ($data) {
        //获取iframe元素
        var iframe = document.getElementById("oceanpayment-iframe-applepay");
        //iframe网页IP:PORT
        var childDomain = ipAddressApplePay;
        //更新交易信息
        iframe.contentWindow.postMessage({
            'methodType': 'updateTransactionInfo',
            'transactionInfo': $data.transactionInfo,
        }, childDomain);
    }, validateResults: function ($data) {
        //获取iframe元素
        var iframe = document.getElementById("oceanpayment-iframe-applepay");
        //iframe网页IP:PORT
        var childDomain = ipAddressApplePay;
        //更新交易信息
        iframe.contentWindow.postMessage({
            'methodType': 'validateResults',
            'validateResults': $data,
        }, childDomain);
    }
}
window.addEventListener('message',function(e) {
    if (e.origin == "https://secure.oceanpayment.com" || e.origin == "https://test-secure.oceanpayment.com") {
        let code = e.data.code;
        let method = e.data.method;
        let modifiedXml;
        let parser=new DOMParser();
        let xmldoc = parser.parseFromString(e.data,'text/xml');
        if(xmldoc.getElementsByTagName("methods").length > 0){
            method = xmldoc.getElementsByTagName("methods")[0].textContent;

            if (method == 'ApplePayCreate') {
                var firstMethodNode = xmldoc.getElementsByTagName("methods")[0];
                if (firstMethodNode) {
                    firstMethodNode.parentNode.removeChild(firstMethodNode);
                    var serializer = new XMLSerializer();
                    modifiedXml = serializer.serializeToString(xmldoc);
                }
            }
        }
        if (method == 'ApplePay' || method == 'ApplePayCreate') {
            //自适应高度
            reinitIframeApplePay(e.data.height);
        }
        //只有code不为1 时才会给商户发送消息
        if (code != 1 && method == 'ApplePay' || method == 'ApplePayCreate') {
            delete e.data.height;
            if (method == 'ApplePayCreate') {
                oceanpaymentApplePayCallBack(modifiedXml);
            } else {
                oceanpaymentApplePayCallBack(e.data);
            }
        }
    }
});


function reinitIframeApplePay(heightData) {
    var iframe = document.getElementById("oceanpayment-iframe-applepay");
    try {
        if (heightData != undefined && heightData != '') {
            iframe.height = heightData;
        }
    } catch (ex) {
        console.log(ex);
        iframe.height = 70;
    }
}
