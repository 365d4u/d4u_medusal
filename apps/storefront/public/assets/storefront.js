(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = (n,c='USD') => new Intl.NumberFormat('en-US',{style:'currency',currency:c}).format(Number(n||0));
  async function api(path,body) {
    const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const data=await response.json();if(!response.ok)throw new Error(data.message||data.error||'Unable to complete your request');return data;
  }
  function message(id,error) { const element=$(id);if(element)element.textContent=error.message||error; }
  async function showCart(){
    const {cart}=await api('/api/cart');let dialog=$('#d4u-cart-drawer');
    if(!dialog){dialog=document.createElement('dialog');dialog.id='d4u-cart-drawer';dialog.setAttribute('aria-label','Your shopping bag');document.body.append(dialog);dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});}
    dialog.innerHTML=`<div class="d4u-drawer-heading"><h2>Your shopping bag</h2><button type="button" aria-label="Close shopping bag" data-drawer-close>×</button></div>${cart?.items?.length?`<div class="d4u-drawer-items">${cart.items.map(i=>`<article><img src="${escape(i.thumbnail)}" alt="${escape(i.product_title||i.title)}"><div><a href="/product/${escape(i.product_handle)}/">${escape(i.product_title||i.title)}</a><p>${escape(i.variant_title?.replace(/-/g,' '))}</p><p>${Number(i.quantity)} × ${money(i.unit_price,cart.currency_code)}</p></div></article>`).join('')}</div><p class="d4u-drawer-total">Subtotal <strong>${money(cart.item_subtotal,cart.currency_code)}</strong></p><p>Shipping calculated at checkout.</p><a class="d4u-button" href="/checkout/">Proceed to checkout</a><a class="d4u-drawer-view" href="/cart/">View shopping bag</a>`:'<p>Your bag is empty.</p><a href="/list/?all=1">Continue shopping</a>'}`;
    dialog.querySelector('[data-drawer-close]').onclick=()=>dialog.close();if(!dialog.open)dialog.showModal();
  }
  document.querySelectorAll('.d4u-cart-link').forEach(link=>{link.setAttribute('aria-haspopup','dialog');link.onclick=async e=>{e.preventDefault();try{await showCart();}catch{location.href='/cart/';}};});
  // Oceanpayment 3DS returns to the page that hosted its iframe. Verification remains server-side.
  if(location.pathname==='/checkout/'&&sessionStorage.getItem('d4u_ocean_return')){sessionStorage.removeItem('d4u_ocean_return');location.replace('/payment/return/');return;}
  if(location.pathname==='/payment/return/')sessionStorage.removeItem('d4u_ocean_return');
  const reviewForm=$('#custom365d-review-form');
  if(reviewForm){
    $('.write-review-btn').onclick=()=>{$('.custom365d-review-form-container').style.display='block';reviewForm.scrollIntoView({behavior:'smooth',block:'start'});};
    $('.btn-cancel').onclick=()=>{$('.custom365d-review-form-container').style.display='none';};
    reviewForm.addEventListener('submit',async event=>{
      event.preventDefault();const button=reviewForm.querySelector('[type=submit]'),status=reviewForm.querySelector('.review-form-message');button.disabled=true;status.style.display='block';status.textContent='Submitting your review…';
      try{
        const fields=Object.fromEntries(new FormData(reviewForm)),files=[...$('#review_media').files],media=[];
        if(files.length>5)throw new Error('Please select up to five images or videos.');
        if(!fields.reviewer_name?.trim()||!Number(fields.rating))throw new Error('Please provide your display name and rating.');
        for(const file of files){if(file.size>10*1024*1024)throw new Error('Each file must be 10 MB or smaller.');const r=await fetch('/api/review-media',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});const data=await r.json();if(!r.ok)throw new Error(data.message||'Upload failed');media.push(data);}
        await api('/api/reviews',{name:fields.reviewer_name,email:fields.reviewer_email,rating:Number(fields.rating),content:fields.body,media});
        location.href='/customer-says/';
      }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
    });
  }
  const productData=$('#product-data');
  if(productData) {
    const product=JSON.parse(productData.textContent),form=$('#product-form');
    function selected() {
      const values=new FormData(form);
      return product.variants.find(v=>(v.options||[]).every(option=>values.get(option.option_id)===option.value));
    }
    function update() {
      const variant=selected(),price=variant?.calculated_price;
      const regular=Number(variant?.metadata?.catalog_pricing?.regular_price??price?.original_amount);
      $('#variant-price').innerHTML=price?`${money(price.calculated_amount,price.currency_code)}${regular>Number(price.calculated_amount)?` <del>${money(regular,price.currency_code)}</del>`:''}`:product.initial_price_html;
      const soldOut=variant?.metadata?.source_stock_status==='outofstock'&&!variant?.allow_backorder;
      $('#add-to-bag').disabled=!price||Boolean(variant?.metadata?.requires_quote)||soldOut;
      $('#add-to-bag').textContent=soldOut?'Sold out':variant&&!price?'Contact us for a quote':'Add to cart';
      if($('#buy-paypal'))$('#buy-paypal').disabled=!price||soldOut;
    }
    form.addEventListener('change',update);update();
    form.addEventListener('submit',async event=>{
      event.preventDefault();const button=$('#add-to-bag');button.disabled=true;
      try {const variant=selected();if(!variant)throw new Error('Please choose available product options.');await api('/api/cart/items',{variant_id:variant.id,quantity:Number(new FormData(form).get('quantity'))});await showCart();update();}
      catch(error){message('#product-message',error);update();}
    });
    document.querySelectorAll('.d4u-image').forEach(button=>button.addEventListener('click',()=>{const dialog=$('#image-lightbox');dialog.querySelector('img').src=button.querySelector('img').src;dialog.showModal();}));
    $('#image-lightbox button')?.addEventListener('click',()=>$('#image-lightbox').close());
    let mediaIndex=0;const thumbs=[...document.querySelectorAll('[data-media-index]')];
    function showMedia(index){if(!thumbs.length)return;mediaIndex=(index+thumbs.length)%thumbs.length;const media=thumbs[mediaIndex],video=$('#gallery-video'),picture=$('#gallery-main').parentElement;video.pause();video.hidden=media.dataset.mediaType!=='video';picture.hidden=!video.hidden;if(video.hidden)$('#gallery-main').src=media.dataset.mediaUrl;else{video.src=media.dataset.mediaUrl;video.play().catch(()=>{});}thumbs.forEach((button,i)=>button.setAttribute('aria-pressed',String(i===mediaIndex)));}
    thumbs.forEach((button,index)=>button.onclick=()=>showMedia(index));$('.gallery-prev')?.addEventListener('click',()=>showMedia(mediaIndex-1));$('.gallery-next')?.addEventListener('click',()=>showMedia(mediaIndex+1));
    $('#buy-paypal')?.addEventListener('click',async()=>{const button=$('#buy-paypal');button.disabled=true;try{if(!selected())throw new Error('Please choose available product options.');await api('/api/cart/items',{variant_id:selected().id,quantity:1});sessionStorage.setItem('d4u_preferred_payment','pp_paypal_paypal');location.href='/checkout/';}catch(error){message('#product-message',error);update();}});
    const tabs=[...document.querySelectorAll('[data-product-tab]')];
    function selectTab(tab){tabs.forEach(b=>{const active=b===tab;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;$('#panel-'+b.dataset.productTab).hidden=!active;});}
    tabs.forEach((tab,i)=>{tab.onclick=()=>selectTab(tab);tab.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;selectTab(tabs[next]);tabs[next].focus();}};});
    if(location.hash==='#product-reviews'||new URLSearchParams(location.search).has('review_page'))selectTab(tabs.at(-1));
    const countdown=$('[data-sale-countdown]');if(countdown){const tick=()=>{const seconds=Math.max(0,Math.floor(Number(countdown.dataset.saleCountdown)-Date.now()/1000));countdown.textContent=seconds?`Ends in ${Math.floor(seconds/86400)}d ${Math.floor(seconds/3600)%24}h ${Math.floor(seconds/60)%60}m ${seconds%60}s`:'This offer has ended. Refresh to see current prices.';if(!seconds){$('#add-to-bag').disabled=true;$('#buy-paypal').disabled=true;clearInterval(timer);}};const timer=setInterval(tick,1000);tick();}
  }
  document.querySelectorAll('[data-cart-quantity]').forEach(input=>input.addEventListener('change',async()=>{
    try{await api('/api/cart/items/'+input.dataset.cartQuantity,{quantity:Number(input.value)});location.reload();}catch(error){message('#cart-message',error);}
  }));
  document.querySelectorAll('[data-remove-item]').forEach(button=>button.addEventListener('click',async()=>{
    try{await api('/api/cart/items/'+button.dataset.removeItem,{quantity:0});location.reload();}catch(error){message('#cart-message',error);}
  }));
  const addressForm=$('#checkout-address');
  let checkoutReady=false,checkoutConfig,checkoutCart,checkoutVersion=0,paymentBusy=false;
  function clearPaymentForm(){
    $('#ocean-submit')?.remove();
    $('#oceanpayment-element')?.replaceChildren();
    $('#oceanpayment-applepayelement')?.replaceChildren();
    window.opApplepay=undefined;
  }
  const appleAvailable=()=>Boolean(window.ApplePaySession&&ApplePaySession.canMakePayments());
  function renderPaymentOptions(){
    if(!checkoutConfig)return;
    const config=checkoutConfig,cart=checkoutCart,ocean=config.payment_policy.ocean;
    const allowOcean=!ocean.enabled||(cart?.currency_code===ocean.currency&&Number(cart?.total)<ocean.threshold);
    $('#payment-options').replaceChildren();
    for(const method of config.payment_policy.methods||[]){
      if(!method.enabled||method.id.includes('applepay')&&!config.applepay_enabled)continue;
      const apple=method.id.includes('applepay'),card=method.id.includes('oceanpayment')&&!apple;
      const disabledReason=!config.checkout_enabled?'Online payment is currently unavailable.':!allowOcean&&cart&&method.id.includes('oceanpayment')?'Available for orders below '+money(ocean.threshold):apple&&!appleAvailable()?'Requires a supported Apple device with an active wallet.':!checkoutReady?'Complete your address and delivery first.':'';
      const button=document.createElement('button');button.type='button';button.dataset.provider=method.id;button.className='d4u-payment-method '+(apple?'d4u-applepay':card?'d4u-card':'d4u-paypal');button.disabled=Boolean(disabledReason)||paymentBusy;
      button.textContent=apple?'Apple Pay':card?'Debit or Credit Card':'Pay with PayPal';
      button.setAttribute('aria-label',button.textContent+(disabledReason?' — '+disabledReason:''));
      $('#payment-options').append(button);if(disabledReason){const hint=document.createElement('small');hint.textContent=disabledReason;$('#payment-options').append(hint);}
    }
    $('#payment-instructions').textContent=checkoutReady?'Choose your secure payment method.':'Enter your shipping address to confirm delivery and activate payment.';
  }
  function updateTotals(cart){
    checkoutCart=cart;
    for(const [id,value] of [['subtotal',cart.item_subtotal],['shipping',cart.shipping_total],['discount',cart.discount_total],['tax',cart.tax_total],['total',cart.total]])$('#checkout-'+id).textContent=(id==='discount'?'−':'')+money(value,cart.currency_code);
    for(const item of cart.items||[])document.querySelector(`[data-line-total="${CSS.escape(item.id)}"]`)?.replaceChildren(document.createTextNode(money(item.subtotal??item.unit_price*item.quantity,cart.currency_code)));
  }
  if(addressForm){
    Promise.all([api('/api/config'),api('/api/cart')]).then(([config,{cart}])=>{checkoutConfig=config;checkoutCart=cart;renderPaymentOptions();}).catch(e=>message('#checkout-message',e));
    addressForm.addEventListener('input',()=>{checkoutReady=false;checkoutVersion++;clearPaymentForm();$('#checkout-delivery').hidden=true;renderPaymentOptions();});
    async function chooseDelivery(id,version){
      checkoutReady=false;clearPaymentForm();renderPaymentOptions();
      const {cart}=await api('/api/cart/shipping',{option_id:id});if(version!==checkoutVersion)return;
      updateTotals(cart);checkoutConfig=await api('/api/config');if(version!==checkoutVersion)return;
      checkoutReady=true;renderPaymentOptions();message('#checkout-message','');
    }
    addressForm.addEventListener('submit',async event=>{
      event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;const version=++checkoutVersion;checkoutReady=false;renderPaymentOptions();
      try{
        await api('/api/cart/address',Object.fromEntries(new FormData(event.target)));const {shipping_options}=await api('/api/cart/shipping');if(version!==checkoutVersion)return;
        $('#shipping-options').innerHTML=shipping_options.map((option,i)=>`<label><input type="radio" name="shipping" value="${escape(option.id)}" ${i===0?'checked':''}>${escape(option.name)} — ${money(option.amount||0)}</label>`).join('')||'<p>No delivery method is available for this address. Please contact support.</p>';
        $('#checkout-delivery').hidden=false;
        $('#shipping-options').onchange=e=>chooseDelivery(e.target.value,++checkoutVersion).catch(error=>message('#checkout-message',error));
        if(shipping_options.length)await chooseDelivery(shipping_options[0].id,version);
      }catch(error){message('#checkout-message',error);}finally{button.disabled=false;}
    });
    $('#payment-options').onclick=async e=>{
      const button=e.target.closest('[data-provider]');if(!button||button.disabled||!checkoutReady||paymentBusy)return;
      const version=checkoutVersion;paymentBusy=true;clearPaymentForm();renderPaymentOptions();message('#checkout-message','Preparing secure payment…');
      try{
        const result=await api('/api/cart/payment',{provider_id:button.dataset.provider});
        if(version!==checkoutVersion||!checkoutReady)return;
        const session=result.payment_collection.payment_sessions.find(s=>s.provider_id===button.dataset.provider);
        if(session?.data?.approval_url)location.href=session.data.approval_url;else{await startOcean(session?.data,version);message('#checkout-message','');}
      }catch(error){message('#checkout-message',error);}finally{paymentBusy=false;renderPaymentOptions();}
    };
  }
  async function loadScript(src){if(document.querySelector(`script[src="${src}"]`))return;await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=reject;document.head.appendChild(s);});}
  async function startOcean(data,version){
    if(!data?.fields)throw new Error('Payment configuration is incomplete.');
    const callback=result=>{
      if(result?.msg){sessionStorage.removeItem('d4u_ocean_return');message('#checkout-message',result.msg);return;}
      const raw=typeof result==='string'?result:result?.data;
      if(typeof raw==='string'){
        const parsed=new DOMParser().parseFromString(raw,'text/xml'),redirect=parsed.querySelector('pay_url')?.textContent;
        if(redirect){const url=new URL(redirect);if(url.protocol==='https:'&&['secure.oceanpayment.com','test-secure.oceanpayment.com'].includes(url.hostname)){location.href=url.href;return;}}
        if(parsed.querySelector('payment_status')?.textContent==='0'){sessionStorage.removeItem('d4u_ocean_return');message('#checkout-message',parsed.querySelector('payment_details')?.textContent||'Payment was declined. Please choose another payment method.');return;}
      }
      location.href='/payment/return/';
    };
    window.oceanpaymentCallBack=callback;
    window.oceanpaymentApplePayCallBack=result=>{if(result?.code===2)window.opApplepay?.();else if(result?.code===3){sessionStorage.removeItem('d4u_ocean_return');message('#checkout-message','Apple Pay was closed. Choose a payment method to try again.');}else callback(result);};
    if(data.method==='ApplePay'){
      if(!window.ApplePaySession||!ApplePaySession.canMakePayments())throw new Error('Apple Pay is unavailable on this device. Please choose another payment method.');
      await loadScript('/assets/vendor/oceanpayment-applepay-b57c3ce46ca9.js');
      if(version!==checkoutVersion||!checkoutReady)return;
      window.onePageApplePay.init(data.sandbox,{language:'en_US',terminal:data.fields.terminal,transactionInfo:{orderCurrency:data.fields.order_currency,orderAmount:data.fields.order_amount,billCountry:data.fields.billing_country,orderNumber:data.fields.order_number,billAddress:data.fields.billing_address}});
      window.opApplepay=()=>window.onePageApplePay.checkout(data.fields);
    }else{
      await loadScript('/assets/vendor/oceanpayment-0e7a4e5cebd8.js');if(version!==checkoutVersion||!checkoutReady)return;window.Oceanpayment.init(data.sandbox,'','en_US',{showCardName:false});
      $('#ocean-submit')?.remove();const button=document.createElement('button');button.id='ocean-submit';button.textContent='Pay securely';button.onclick=()=>{if(version!==checkoutVersion||!checkoutReady)return;sessionStorage.setItem('d4u_ocean_return','1');window.Oceanpayment.checkout(data.fields);};$('#oceanpayment-element').after(button);
    }
  }
  for(const [id,route] of [['login-form','login'],['register-form','register']])$('#'+id)?.addEventListener('submit',async event=>{
    event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;
    try{await api('/api/account/'+route,Object.fromEntries(new FormData(event.target)));location.href='/my-account/';}catch(error){message('#account-message',error);}finally{button.disabled=false;}
  });
  if($('#account-content'))api('/api/account').then(async({customer})=>{
    $('#account-content').innerHTML=`<h2>Welcome, ${escape(customer.first_name||customer.email)}</h2><p>${escape(customer.email)}</p><button id="sign-out">Sign out</button><div id="account-orders"></div>`;
    $('#sign-out').onclick=async()=>{await api('/api/account/logout',{});location.reload();};
    const {orders,legacy_orders=[]}=await api('/api/account/orders');$('#account-orders').innerHTML='<h2>Your orders</h2>'+(!orders.length?'<p>No new orders yet.</p>':orders.map(o=>`<article><h3>Order #${escape(o.display_id)}</h3><p>${escape(o.status)} · ${money(o.total,o.currency_code)}</p></article>`).join(''))+'<h2>Previous orders</h2>'+(!legacy_orders.length?'<p>No previous orders.</p>':legacy_orders.map(o=>`<article><h3>Order #${escape(o.id)}</h3><p>${escape(o.created_at)} · ${escape(o.status.replace(/^wc-/,''))} · ${money(o.total,o.currency)}</p>${o.items.map(i=>`<p>${escape(i.name)} × ${escape(i.metadata._qty||1)}</p>`).join('')}</article>`).join(''));
  }).catch(()=>{});
  function wishlist(){try{return JSON.parse(localStorage.getItem('d4u_wishlist')||'[]');}catch{return [];}}
  document.querySelectorAll('[data-wishlist]').forEach(button=>button.addEventListener('click',async()=>{
    try{const result=await api('/api/wishlist',{product_id:button.dataset.wishlist});button.textContent=result.ids.includes(button.dataset.wishlist)?'♥ Saved to wishlist':'♡ Save to wishlist';}
    catch(error){message('#product-message',error);if(error.message.includes('sign in'))location.href='/my-account/';}
  }));
  if($('#wishlist-products'))$('#wishlist-products').innerHTML=wishlist().map(p=>`<article><a href="/product/${encodeURIComponent(p.handle)}/"><img src="${escape(p.image)}" alt="${escape(p.name)}"><h2>${escape(p.name)}</h2></a></article>`).join('')||'<p>Your wishlist is empty. <a href="/list/?all=1">Explore the collection</a>.</p>';
  const completeButton=$('#complete-order');
  async function completeOrder(){completeButton.disabled=true;try{const result=await api('/api/cart/complete',{});message('#payment-status',result.type==='order'?`Thank you. Your order #${result.order.display_id} is confirmed.`:'Payment is still awaiting confirmation. Please try again shortly.');if(result.type==='order'){completeButton.hidden=true;return true;}}catch(error){message('#payment-status',error);}finally{completeButton.disabled=false;}return false;}
  if(completeButton){completeButton.addEventListener('click',completeOrder);completeOrder();}
})();

