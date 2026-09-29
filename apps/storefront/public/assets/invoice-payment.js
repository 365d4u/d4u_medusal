(()=>{'use strict';const $=s=>document.querySelector(s),config=JSON.parse($('#invoice-data').textContent),invoice=config.invoice,form=$('#order_review'),button=$('#place_order'),message=t=>$('#invoice-payment-status').textContent=t;let oceanReady=false,oceanPromise=null,busy=false,choice=invoice.payment_choice,appleData=null,appleSubmitting=false;
if($('#invoice-card-sandbox'))$('#invoice-card-sandbox').hidden=!config.ocean_sandbox;
const providers={'payment_method_ppcp-gateway':'pp_paypal_paypal',payment_method_oceancreditcardonepage:'pp_oceanpayment_oceanpayment',payment_method_oceanapplepay:'pp_oceanpayment-applepay_oceanpayment'};
const appleRadio=$('#payment_method_oceanapplepay');
let appleSupported=false;try{appleSupported=!!(config.applepay_enabled&&window.ApplePaySession&&window.ApplePaySession.canMakePayments());}catch{}
$('#payment_method_oceancreditcardonepage').closest('.wc_payment_method').hidden=invoice.ocean_allowed===false;
$('#invoice-applepay-method').hidden=!config.applepay_enabled||invoice.ocean_allowed===false;appleRadio.disabled=!appleSupported;
$('#invoice-applepay-unavailable').hidden=appleSupported;
const configuredMethods=invoice.payment_methods||Object.entries(providers).map(([_,id])=>({id,enabled:true}));
for(const m of configuredMethods){const radio=document.querySelector('[name=payment_method]#'+Object.keys(providers).find(k=>providers[k]===m.id));if(!radio)continue;const row=radio.closest('.wc_payment_method');row.parentElement.append(row);if(!m.enabled){row.hidden=true;radio.disabled=true;}if(m.label){const label=row.querySelector('label');if(label){for(const n of [...label.childNodes])if(n.nodeType===Node.TEXT_NODE)n.remove();label.append(document.createTextNode(' '+m.label));}}}
const availableMethods=()=>configuredMethods.filter(m=>m.enabled&&(!m.id.includes('oceanpayment')||invoice.ocean_allowed!==false)&&(!m.id.includes('applepay')||appleSupported));
function selectedProvider(){return providers[$('[name=payment_method]:checked').id];}
const endpoint='/api/invoices/'+invoice.display_id,marker='invoice-return:'+invoice.display_id;
async function api(suffix,body){const r=await fetch(endpoint+suffix+'?key='+encodeURIComponent(config.key),{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw new Error(data.message||'Unable to process payment. Please try again.');return data;}
const same=$('#same_with_shipping');if(invoice.billing_address&&invoice.shipping_address)same.checked=['first_name','last_name','address_1','address_2','city','province','postal_code','country_code','phone'].every(k=>(invoice.billing_address[k]||'')===(invoice.shipping_address[k]||''));function sameAddress(){const block=$('.billing_data_div');block.hidden=same.checked;block.style.display=same.checked?'none':'block';block.querySelectorAll('input,select').forEach(i=>i.disabled=same.checked);}
same.onchange=sameAddress;sameAddress();
const usStates=[...$('#shipping_state').options].map(o=>({value:o.value,text:o.text}));
function country(prefix,value){value=String(value).toLowerCase();const current=$('#'+prefix+'_state'),options=window.D4U_ADDRESS_STATES?.[value.toUpperCase()]||(value==='us'?Object.fromEntries(usStates.filter(s=>s.value).map(s=>[s.value,s.text])):{});let control;if(Object.keys(options).length){control=document.createElement('select');control.add(new Option('Select an option…',''));for(const [code,name] of Object.entries(options))control.add(new Option(name,code));}else{control=document.createElement('input');control.type='text';control.placeholder='State / Province';control.className='input-text';}control.id=prefix+'_state';control.name=prefix+'_state';control.required=value==='us'||value==='ca';control.disabled=prefix==='billing'&&same.checked;current.replaceWith(control);document.dispatchEvent(new CustomEvent('invoice-state-replaced',{detail:{previous:current,current:control}}));}
for(const prefix of ['shipping','billing']){$('#'+prefix+'_country').addEventListener('change',e=>country(prefix,e.target.value));const address=invoice[prefix+'_address'];if(!address){$('#'+prefix+'_country').value='US';country(prefix,'us');}if(address){$('#'+prefix+'_country').value=address.country_code?.toUpperCase()||'';country(prefix,address.country_code);const names={first_name:'first_name',last_name:'last_name',address_1:'address_1',address_2:'address_2',city:'city',province:'state',postal_code:'postcode',phone:'phone'};for(const [source,target] of Object.entries(names))$('#'+prefix+'_'+target).value=address[source]||'';}}
$('#billing_email').value=invoice.email||'';
function paid(){if($('#invoice-paid'))return;invoice.status='paid';sessionStorage.removeItem(marker);document.querySelectorAll('.base_shipping_div,.check_same,.billing_data_div,.base_payment_title,#payment').forEach(el=>el.hidden=true);const status=document.createElement('div');status.id='invoice-paid';const strong=document.createElement('strong');strong.textContent='Payment received';status.append(strong,document.createTextNode(`Thank you. Order #${invoice.display_id} is paid.`));form.append(status);}
async function complete(){message('Checking your payment securely…');const {invoice:current}=await api('/complete',{});if(current.status==='paid'){paid();message('');return true;}message('Payment is awaiting confirmation. Please try again shortly.');return false;}
function loadScript(src){return new Promise((resolve,reject)=>{const script=document.createElement('script'),timer=setTimeout(fail,15000);function fail(){clearTimeout(timer);script.remove();reject(new Error('The payment form could not load. Please select credit card to try again.'));}script.src=src;script.onload=()=>{clearTimeout(timer);resolve();};script.onerror=fail;document.head.append(script);});}
function cardLoading(error){const loading=$('#invoice-card-loading');loading.hidden=oceanReady;loading.textContent=error||'Loading secure card form…';if(error){const retry=document.createElement('button');retry.type='button';retry.textContent='Retry';retry.onclick=()=>prepareOcean().catch(()=>{});loading.append(' ',retry);}if($('#payment_method_oceancreditcardonepage').checked)button.disabled=busy||!oceanReady;}
function prepareOcean(){
 if(oceanPromise)return oceanPromise;
 cardLoading();
 oceanPromise=(async()=>{
  if(!window.Oceanpayment)await loadScript('/assets/vendor/oceanpayment-0e7a4e5cebd8.js');
  await new Promise((resolve,reject)=>{
   const origin=config.ocean_sandbox?'https://test-secure.oceanpayment.com':'https://secure.oceanpayment.com';
   const timer=setTimeout(()=>{cleanup();reject(new Error('The secure card form is taking too long. Select credit card again to retry.'));},20000);
   function cleanup(){clearTimeout(timer);window.removeEventListener('message',ready);}
   // The preloaded iframe reports height 0 while its payment method is collapsed.
   function ready(event){const iframe=$('#oceanpayment-iframe-card');if(event.origin===origin&&event.source===iframe?.contentWindow&&event.data?.method==='Credit Card'&&Number(event.data.code)===1&&event.data.height!==undefined&&Number(event.data.height)>=0){cleanup();resolve();}}
   window.addEventListener('message',ready);
   try{window.Oceanpayment.init(config.ocean_sandbox,'','en_US',{showCardName:false});}catch(error){cleanup();reject(error);}
  });
  oceanReady=true;cardLoading();
 })().catch(error=>{oceanPromise=null;cardLoading(error.message);throw error;});
 return oceanPromise;
}
async function prepareApple(data){
 if(!appleSupported)throw new Error('Apple Pay is unavailable on this device. Please choose another payment method.');
 if(!window.onePageApplePay)await loadScript('/assets/vendor/oceanpayment-applepay-b57c3ce46ca9.js');
 appleData=data;appleSubmitting=false;
 await new Promise((resolve,reject)=>{
  const origin=config.ocean_sandbox?'https://test-secure.oceanpayment.com':'https://secure.oceanpayment.com';
  const timer=setTimeout(()=>{cleanup();reject(new Error('Apple Pay could not load. Please try again.'));},20000);
  function cleanup(){clearTimeout(timer);window.removeEventListener('message',ready);}
  function ready(event){if(event.origin===origin&&event.source===$('#oceanpayment-iframe-applepay')?.contentWindow&&event.data?.method==='ApplePay'&&Number(event.data.code)===1){cleanup();resolve();}}
  window.addEventListener('message',ready);
  try{window.onePageApplePay.init(data.sandbox,{language:'en_US',terminal:data.fields.terminal,transactionInfo:{orderCurrency:data.fields.order_currency,orderAmount:data.fields.order_amount,billCountry:data.fields.billing_country,orderNumber:data.fields.order_number,billAddress:'365D4U'},buttonStyle:{buttonstyle:'black',type:'pay',locale:'en-US',buttonHeight:48}});}catch(error){cleanup();reject(error);}
 });
 button.hidden=true;$('#invoice-applepay-help').textContent='Authorize your payment using Apple Pay.';message('');
 $('#oceanpayment-applepayelement').scrollIntoView({block:'center',behavior:'smooth'});
}
window.oceanpaymentApplePayCallBack=async result=>{
 if(Number(result?.code)===2){if(!busy||!appleData||appleSubmitting)return;appleSubmitting=true;sessionStorage.setItem(marker,'1');message('Processing your Apple Pay payment…');window.onePageApplePay.checkout(appleData.fields);return;}
 if(Number(result?.code)===3){sessionStorage.removeItem(marker);paymentBusy(false);message('Apple Pay was closed. You can try again or choose another payment method.');return;}
 await window.oceanpaymentCallBack(result);
};
function paymentBusy(value){busy=value;if(!value&&appleData){appleData=null;appleSubmitting=false;$('#oceanpayment-applepayelement').replaceChildren();$('#invoice-applepay-help').textContent='Continue with Apple Pay below, then authorize your payment.';button.hidden=false;}document.querySelectorAll('[name=payment_method]').forEach(el=>el.disabled=value||(el===appleRadio&&!appleSupported)||(invoice.ocean_allowed===false&&el.id!=='payment_method_ppcp-gateway'));button.disabled=value||($('#payment_method_oceancreditcardonepage').checked&&!oceanReady)||(appleRadio.checked&&!appleSupported);}
window.oceanpaymentCallBack=async result=>{if(result?.msg){paymentBusy(false);message(result.msg);sessionStorage.removeItem(marker);return;}const raw=typeof result==='string'?result:result?.data;if(typeof raw==='string'){const xml=new DOMParser().parseFromString(raw,'text/xml'),redirect=xml.querySelector('pay_url')?.textContent;if(redirect){const url=new URL(redirect);if(url.protocol==='https:'&&['secure.oceanpayment.com','test-secure.oceanpayment.com'].includes(url.hostname)){location.href=url.href;return;}}if(xml.querySelector('payment_status')?.textContent==='0'){paymentBusy(false);sessionStorage.removeItem(marker);message(xml.querySelector('payment_details')?.textContent||'Payment was declined. Please try again.');return;}}try{await complete();}catch(error){message(error.message);}};
function method(){const card=$('#payment_method_oceancreditcardonepage').checked;document.querySelectorAll('.wc_payment_method').forEach(li=>{const selected=li.querySelector('input').checked;li.classList.toggle('active-method',selected);li.querySelector('.payment_box').style.display=selected?'block':'none';});button.classList.toggle('invoice-card-button',card||appleRadio.checked);button.textContent=appleRadio.checked?'Continue with Apple Pay':card?'Pay for order':'Pay with PayPal';button.disabled=busy||(card&&!oceanReady)||(appleRadio.checked&&!appleSupported);if(card)prepareOcean().catch(()=>{});}
function applyChoice(){
 document.querySelectorAll('[name=payment_method]').forEach(el=>el.checked=providers[el.id]===choice.provider_id);method();
}
async function refreshChoice(){const {invoice:current}=await api('');choice=current.payment_choice;if(current.status==='paid'){paid();message('');return;}applyChoice();}
document.querySelectorAll('[name=payment_method]').forEach(r=>r.addEventListener('change',async()=>{
 if(busy){applyChoice();return;}
 const provider=providers[r.id];
 if(provider===choice.provider_id){method();return;}
 busy=true;button.disabled=true;document.querySelectorAll('[name=payment_method]').forEach(el=>el.disabled=true);message('Updating payment method…');
 try{const result=await api('/method',{provider_id:provider,payment_version:choice.version});choice=result.invoice.payment_choice;sessionStorage.removeItem(marker);message('');}
 catch(error){message(error.message);await refreshChoice().catch(()=>{});}
 finally{paymentBusy(false);applyChoice();}
}));
function address(prefix){const names={first_name:'first_name',last_name:'last_name',address_1:'address_1',address_2:'address_2',city:'city',province:'state',postal_code:'postcode',phone:'phone',country_code:'country'};return Object.fromEntries(Object.entries(names).map(([target,source])=>[target,$('#'+prefix+'_'+source).value.trim()]));}
form.addEventListener('submit',async e=>{e.preventDefault();if(busy)return;if(!form.reportValidity())return;paymentBusy(true);message('Connecting to secure payment…');try{const card=$('#payment_method_oceancreditcardonepage').checked;if(card)await prepareOcean();const {session}=await api('/payment',{provider_id:selectedProvider(),payment_version:choice.version,email:$('#billing_email').value,shipping_address:address('shipping'),billing_address:address('billing'),same_address:same.checked});if(session.data.approval_url){location.href=session.data.approval_url;return;}if(session.data.method==='ApplePay'){await prepareApple(session.data);return;}await prepareOcean();sessionStorage.setItem(marker,'1');message('');window.Oceanpayment.checkout(session.data.fields);}catch(error){message(error.message);paymentBusy(false);}});
document.querySelector('.wp-block-navigation__responsive-container-open')?.addEventListener('click',()=>document.querySelector('.wp-block-navigation__responsive-container')?.classList.add('is-menu-open','has-modal-open'));document.querySelector('.wp-block-navigation__responsive-container-close')?.addEventListener('click',()=>document.querySelector('.wp-block-navigation__responsive-container')?.classList.remove('is-menu-open','has-modal-open'));
async function initialize(){if(invoice.status==='unpaid'){const available=availableMethods();if(!available.length){button.disabled=true;message('No payment method is currently available. Please contact us.');return;}if(!available.some(m=>m.id===choice.provider_id)){try{const result=await api('/method',{provider_id:available[0].id,payment_version:choice.version});choice=result.invoice.payment_choice;}catch(error){message(error.message);button.disabled=true;return;}}}
if(invoice.status==='paid')paid();else if(invoice.status==='canceled'){button.disabled=true;message('This invoice has been canceled.');}else if(config.returning||sessionStorage.getItem(marker)){sessionStorage.removeItem(marker);paymentBusy(true);applyChoice();complete().catch(e=>message(e.message)).finally(()=>{if(invoice.status==='unpaid')paymentBusy(false);});}else{applyChoice();if(invoice.ocean_allowed!==false)prepareOcean().catch(()=>{});}}initialize();})();
