import express from 'express'
import helmet from 'helmet'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { renderProduct, renderCart, renderCheckout, renderAccount, renderWishlist, renderReviews } from './views.mjs'
import { mountInvoiceRoutes } from './invoice-routes.mjs'
import { mountFeishuLogin } from './feishu-login.mjs'
import { mountReviewMedia } from './review-media.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const app = express(), port = Number(process.env.PORT || 8000)
const backend = process.env.MEDUSA_BACKEND_URL || 'http://localhost:9000'
const key = process.env.MEDUSA_PUBLISHABLE_KEY
const secret = process.env.COOKIE_SECRET
if (!secret) throw new Error('COOKIE_SECRET is required')
const routes = JSON.parse(fs.readFileSync(path.join(root,'templates/routes.json'),'utf8'))
const shell = fs.readFileSync(path.join(root,'templates/shell.html'),'utf8')
const escape = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const html = (content,title='365D4U') => shell.replace('__D4U_CONTENT__',content).replace(/<title>[\s\S]*?<\/title>/,`<title>${escape(title)} – 365D4U</title>`)
app.disable('x-powered-by')
app.set('trust proxy','loopback')
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, crossOriginResourcePolicy: {policy:'cross-origin'} }))
app.use(express.json({limit:'256kb'}),express.urlencoded({extended:false,limit:'256kb'}))
// A gateway redirect is navigation only. The signed webhook/server API confirms money movement.
app.post('/payment/return/',(req,res)=>res.redirect(303,'/payment/return/'))
app.post('/checkout/',(req,res)=>res.redirect(303,'/payment/return/'))
app.post('/checkout/order-pay/:number/',(req,res)=>{
 const key=String(req.query.key||'');if(!/^[a-f0-9]{64}$/.test(key))return res.status(404).send('Invalid payment link')
 res.redirect(303,`/checkout/order-pay/${req.params.number}/?pay_for_order=true&key=${key}&payment_return=1`)
})
app.post('/payit/:number/:key',(req,res)=>{
 if(!/^\d+$/.test(req.params.number)||!/^mo_[a-z0-9]{7}$/.test(req.params.key))return res.status(404).send('Invalid payment link')
 res.set({'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'})
 res.redirect(303,`/payit/${req.params.number}/${req.params.key}?payment_return=1`)
})
app.use((req,res,next)=>{
  if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
    const origin=req.headers.origin
    if (!origin || new URL(origin).host !== req.headers.host) return res.status(403).json({message:'Request origin rejected'})
  }
  next()
})
app.use(express.static(path.join(root,'public'), {index:false, dotfiles:'deny', maxAge:'1h',setHeaders(res,file){if(/oceanpayment-(?:applepay-)?[a-f0-9]{12}\.js$/.test(file))res.setHeader('Cache-Control','public, max-age=31536000, immutable')}}))
mountReviewMedia(app,{backend,publishableKey:key,mediaBase:process.env.COS_MEDIA_BASE_URL})

const sign = value => createHmac('sha256',secret).update(value).digest('hex')
function cookie(req,name) {
  const value=(req.headers.cookie||'').split('; ').find(v=>v.startsWith(name+'='))?.slice(name.length+1)
  if (!value) return null
  const [body,signature]=decodeURIComponent(value).split('.')
  if (!body || !signature || signature.length!==64 || !timingSafeEqual(Buffer.from(sign(body)),Buffer.from(signature))) return null
  return Buffer.from(body,'base64url').toString()
}
function setCookie(res,name,value,maxAge=60*60*24*30,sameSite='Lax') {
  const body=Buffer.from(value).toString('base64url')
  res.append('Set-Cookie',`${name}=${body}.${sign(body)}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}${process.env.COOKIE_SECURE==='true'?'; Secure':''}`)
}
async function medusa(route,{method='GET',body,token,headers={}}={}) {
  const response=await fetch(backend+route,{method,headers:{'Content-Type':'application/json',...(key?{'x-publishable-api-key':key}:{}),...(token?{Authorization:`Bearer ${token}`}:{}) ,...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)})
  const data=await response.json().catch(()=>({message:'Backend returned an invalid response'}))
  if (!response.ok) throw Object.assign(new Error(data.message||data.error||'Request failed'),{status:response.status})
  return data
}
const legacy = params => medusa('/store/legacy?'+new URLSearchParams(params))
mountFeishuLogin(app,{cookie,setCookie,medusa,backend})
mountInvoiceRoutes(app,{root,medusa,cookie,setCookie})
async function cart(req,res,create=true) {
  const id=cookie(req,'d4u_cart')
  if(id) {
    try { const result=await medusa(`/store/carts/${encodeURIComponent(id)}`); if(!result.cart.completed_at) return result.cart }
    catch(error) { if(error.status!==404) throw error }
  }
  if(!create) return null
  const config=await legacy({action:'store'})
  const {cart:newCart}=await medusa('/store/carts',{method:'POST',body:{region_id:config.region_id},token:cookie(req,'d4u_customer')})
  setCookie(res,'d4u_cart',newCart.id);return newCart
}
app.get('/health',async(req,res)=>{
  try {const r=await fetch(backend+'/health',{signal:AbortSignal.timeout(3000)});res.status(r.ok?200:503).json({storefront:'ok',backend:r.ok?'ok':'unavailable'})}
  catch {res.status(503).json({storefront:'ok',backend:'unavailable'})}
})
app.get('/custom-api.php',async(req,res)=>res.json(await legacy({...req.query,...(req.query.action==='reviews'?{context:'home'}:{})})))
app.post('/custom-api.php',async(req,res)=>{
  if(req.query.action!=='subscribe_newsletter')return res.status(400).json({status:400,msg:'Unsupported form.'})
  await medusa('/store/feedback',{method:'POST',body:{type:'newsletter',email:req.body.email}})
  res.json({status:200,msg:'Thanks for subscribing!'})
})
app.post('/api/product-reviews',async(req,res)=>res.json(await medusa('/store/feedback',{method:'POST',body:{...req.body,type:'product_review'}})))
app.post('/api/reviews',async(req,res)=>res.json(await medusa('/store/feedback',{method:'POST',body:{...req.body,type:'review'}})))
app.get('/wp-json/myshop/v1/product/:id',async(req,res)=>{
  const product=await legacy({action:'product',id:req.params.id})
  res.json({...product,gallery:(product.gallery_images||product.gallery||[]).filter(m=>m.type==='image').map(m=>m.url),price_html:product.price||''})
})
async function signIn(email,password){
  const credentials={email:String(email).trim().toLowerCase(),password:String(password)}
  try{return await medusa('/auth/customer/customer-emailpass',{method:'POST',body:credentials})}
  catch(error){if(error.status!==401)throw error;return medusa('/auth/customer/wordpress',{method:'POST',body:credentials})}
}
async function savedProducts(req){
  const token=cookie(req,'d4u_customer');if(!token)throw Object.assign(new Error('Please sign in to save your wishlist'),{status:401})
  const {ids}=await medusa('/store/customers/me/wishlist',{token})
  return (await legacy({action:'wishlist',ids:ids.join(',')})).products
}
const wishlistShape=p=>({...p,id:p.id,image:[p.image],permalink:p.url,short_description:p.description,stock_status:p.stock_status||'instock',in_stock:p.stock_status!=='outofstock'})
app.all('/wp-admin/admin-ajax.php',async(req,res)=>{
  const input={...req.query,...req.body},action=input.action,token=cookie(req,'d4u_customer')
  if(action==='get_wishlist'||action==='get_wishlist_products'){
    if(!token)return res.json({success:false,data:'Please sign in'})
    const products=await savedProducts(req);return res.json({success:true,data:{wishlist:products.map(p=>p.id),products:products.map(wishlistShape)}})
  }
  if(action==='get_shared_collection'){
    try{const {ids}=await medusa('/store/shared-wishlist/'+encodeURIComponent(input.token));const {products}=await legacy({action:'wishlist',ids:ids.join(',')});return res.json({success:true,data:{products:products.map(wishlistShape),shared_by:'365D4U customer'}})}catch{return res.json({success:false,data:'This share link is invalid or expired.'})}
  }
  if(req.method!=='POST')return res.status(405).json({message:'POST required'})
  if(action==='ajax_login'){
    try{const {token:newToken}=await signIn(input.email||input.username,input.password);setCookie(res,'d4u_customer',newToken);return res.json({success:true,data:{message:'Signed in'}})}catch{return res.json({success:false,data:'Invalid email or password'})}
  }
  if(['toggle_wishlist','generate_share_token'].includes(action)){
    if(!token)return res.json({success:false,data:'Please sign in'})
    if(action==='generate_share_token'){const result=await medusa('/store/customers/me/wishlist',{method:'POST',token,body:{action:'share'}});return res.json({success:true,data:{...result,share_url:`https://${req.headers.host}/share-collection/?token=${result.token}`}})}
    const product=await legacy({action:'product',id:input.product_id})
    const result=await medusa('/store/customers/me/wishlist',{method:'POST',token,body:{product_id:product.medusa_id}})
    const products=(await legacy({action:'wishlist',ids:result.ids.join(',')})).products
    return res.json({success:true,data:{status:result.ids.includes(product.medusa_id)?'added':'removed',wishlist:products.map(p=>p.id),new_count:products.length}})
  }
  return res.status(400).json({success:false,data:'This operation is not available.'})
})
app.get('/api/wishlist',async(req,res)=>res.json({products:await savedProducts(req)}))
app.post('/api/wishlist',async(req,res)=>{
  const token=cookie(req,'d4u_customer');if(!token)return res.status(401).json({message:'Please sign in to save your wishlist'})
  res.json(await medusa('/store/customers/me/wishlist',{method:'POST',token,body:{product_id:String(req.body.product_id)}}))
})
app.get('/api/config',async(req,res)=>{const policy=await medusa('/store/payment-policy');res.set('Cache-Control','no-store');res.json({...(await legacy({action:'store'})),payment_policy:policy,checkout_enabled:process.env.CHECKOUT_ENABLED==='true',applepay_enabled:policy.applepay_enabled,ocean_sandbox:policy.ocean_sandbox})})
app.get('/api/cart',async(req,res)=>res.json({cart:await cart(req,res,false)}))
app.post('/api/cart/items',async(req,res)=>{
  const quantity=Number(req.body.quantity||1)
  if(!Number.isInteger(quantity)||quantity<1||quantity>100) return res.status(400).json({message:'Quantity must be between 1 and 100'})
  const c=await cart(req,res)
  res.json(await medusa(`/store/carts/${c.id}/line-items`,{method:'POST',body:{variant_id:String(req.body.variant_id),quantity}}))
})
app.post('/api/cart/items/:id',async(req,res)=>{
  const c=await cart(req,res,false),quantity=Number(req.body.quantity)
  if(!c||!c.items.some(i=>i.id===req.params.id)) return res.status(404).json({message:'Cart item not found'})
  if(!Number.isInteger(quantity)||quantity<0||quantity>100) return res.status(400).json({message:'Invalid quantity'})
  res.json(await medusa(`/store/carts/${c.id}/line-items/${req.params.id}`,{method:quantity?'POST':'DELETE',...(quantity?{body:{quantity}}:{})}))
})
app.post('/api/cart/address',async(req,res)=>{
  const c=await cart(req,res),input=req.body,address={}
  for(const name of ['first_name','last_name','address_1','address_2','city','province','postal_code','country_code','phone'])address[name]=String(input[name]||'').trim()
  if(!input.email||!address.phone||!address.address_1||!address.first_name||!address.last_name)return res.status(400).json({message:'Please provide your email, phone and complete shipping address.'})
  res.json(await medusa(`/store/carts/${c.id}`,{method:'POST',body:{email:String(input.email),shipping_address:address,billing_address:address}}))
})
app.get('/api/cart/shipping',async(req,res)=>{
  const c=await cart(req,res);res.json(await medusa('/store/shipping-options?cart_id='+c.id))
})
app.post('/api/cart/shipping',async(req,res)=>{
  const c=await cart(req,res);res.json(await medusa(`/store/carts/${c.id}/shipping-methods`,{method:'POST',body:{option_id:String(req.body.option_id)}}))
})
app.post('/api/cart/promotions',async(req,res)=>{
  const c=await cart(req,res);res.json(await medusa(`/store/carts/${c.id}/promotions`,{method:'POST',body:{promo_codes:[String(req.body.code)]}}))
})
app.post('/api/cart/payment',async(req,res)=>{
  if(process.env.CHECKOUT_ENABLED!=='true') return res.status(503).json({message:'Payment is not yet enabled on this test store.'})
  const c=await cart(req,res)
  const allowed=['pp_paypal_paypal','pp_oceanpayment_oceanpayment','pp_oceanpayment-applepay_oceanpayment']
  if(!allowed.includes(req.body.provider_id))return res.status(400).json({message:'Unsupported payment method'})
  if(!c.shipping_methods?.length)return res.status(400).json({message:'Please confirm your delivery method first.'})
  const {payment_collection}=await medusa('/store/payment-collections',{method:'POST',body:{cart_id:c.id}})
  res.json(await medusa(`/store/payment-collections/${payment_collection.id}/payment-sessions`,{method:'POST',body:{provider_id:req.body.provider_id,data:{billing_address:c.billing_address,email:c.email,ip_address:req.ip}}}))
})
app.post('/api/cart/complete',async(req,res)=>{
  if(process.env.CHECKOUT_ENABLED!=='true')return res.status(503).json({message:'Payment is not yet enabled on this test store.'})
  const id=cookie(req,'d4u_cart');if(!id)return res.status(400).json({message:'No checkout session found'})
  try{res.json(await medusa(`/store/carts/${encodeURIComponent(id)}/complete`,{method:'POST',body:{}}))}
  catch(error){if(error.status===400&&/payment sessions|not authorized|payment.*pending/i.test(error.message))return res.status(400).json({message:'Payment has not been confirmed. Please return to checkout to try again or choose another payment method.'});throw error}
})
app.post('/api/account/login',async(req,res)=>{
  const {token}=await signIn(req.body.email,req.body.password)
  setCookie(res,'d4u_customer',token);res.json({success:true})
})
app.post('/api/account/register',async(req,res)=>{
  if(String(req.body.password||'').length<10)return res.status(400).json({message:'Use a password with at least 10 characters.'})
  const {token}=await medusa('/auth/customer/customer-emailpass/register',{method:'POST',body:{email:String(req.body.email),password:String(req.body.password)}})
  await medusa('/store/customers',{method:'POST',token,body:{email:String(req.body.email),first_name:String(req.body.first_name||''),last_name:String(req.body.last_name||'')}})
  const session=await medusa('/auth/customer/customer-emailpass',{method:'POST',body:{email:String(req.body.email),password:String(req.body.password)}})
  setCookie(res,'d4u_customer',session.token);res.json({success:true})
})
app.post('/api/account/logout',(req,res)=>{setCookie(res,'d4u_customer','',0);res.json({success:true})})
app.get('/api/account',async(req,res)=>{
  const token=cookie(req,'d4u_customer');if(!token)return res.status(401).json({message:'Please sign in'})
  res.json(await medusa('/store/customers/me',{token}))
})
app.get('/api/account/orders',async(req,res)=>{
  const token=cookie(req,'d4u_customer');if(!token)return res.status(401).json({message:'Please sign in'})
  const [current,legacy]=await Promise.all([medusa('/store/orders?limit=50',{token}),medusa('/store/customers/me/legacy-orders?limit=50',{token})])
  res.json({...current,legacy_orders:legacy.orders,legacy_count:legacy.count})
})
app.get('/api/products/:id',async(req,res)=>{
  const config=await legacy({action:'store'})
  const {products}=await medusa('/store/products?handle='+encodeURIComponent(req.params.id)+'&region_id='+config.region_id+'&fields=id,title,handle,description,thumbnail,metadata,variants.id,variants.title,variants.metadata,variants.allow_backorder,variants.inventory_quantity,*variants.calculated_price,*variants.options,*options,*options.values,*images')
  if(!products[0])return res.status(404).json({message:'Product not found'})
  res.json({product:products[0]})
})
app.get('/product/:handle/',async(req,res)=>{
  const config=await legacy({action:'store'})
  const {products}=await medusa('/store/products?handle='+encodeURIComponent(req.params.handle)+'&region_id='+config.region_id+'&fields=id,title,handle,description,thumbnail,metadata,variants.id,variants.title,variants.metadata,variants.allow_backorder,variants.inventory_quantity,*variants.calculated_price,*variants.options,*options,*options.values,*images')
  if(!products[0]) {
    try {const migrated=await legacy({action:'resolve_handle',handle:req.params.handle});return res.redirect(301,migrated.url)}
    catch {return res.status(404).send(html('<h1>Product not found</h1>'))}
  }
  const product=products[0],reviews=await legacy({action:'product_reviews',product_id:[product.id,product.metadata?.legacy?.id].filter(Boolean).join(','),page:Math.max(1,Number(req.query.review_page)||1),per_page:20})
  res.send(html(renderProduct({...product,product_reviews:reviews,global_policies:await legacy({action:'global_policies'})}),product.title))
})
app.get('/p/:id/',async(req,res)=>{
  const product=await legacy({action:'product',id:req.params.id});res.redirect(301,product.url)
})
app.get('/cart/',async(req,res)=>{const c=await cart(req,res,false);if(c?.items?.length)await medusa(`/store/carts/${c.id}/refresh`,{method:'POST',body:{}});res.send(html(renderCart(c?await cart(req,res,false):null),'Shopping bag'))})
app.get('/checkout/',async(req,res)=>res.send(html(renderCheckout(await cart(req,res,false)),'Checkout')))
app.get('/my-account/wishlist/',(req,res)=>res.redirect('/collect/'))
app.get(['/my-account/','/my-account/{*path}'],async(req,res)=>res.send(html(renderAccount(req.path),'My account')))
app.get('/payment/return/',(req,res)=>res.send(html('<section class="d4u-panel"><h1>Payment status</h1><p id="payment-status">We are verifying your payment securely.</p><button id="complete-order">Check payment status</button><p><a href="/checkout/">Return to checkout</a> · <a href="/">Continue shopping</a></p></section>','Payment status')))
app.get('/product-category/{*path}',(req,res)=>res.redirect('/list/?category='+encodeURIComponent(req.params.path.at(-1))))
app.get('/product-tag/:tag/',(req,res)=>res.redirect('/list/?tags='+encodeURIComponent(req.params.tag)))
app.get('/robots.txt',(req,res)=>res.type('text').send('User-agent: *\nDisallow: /\n'))
app.get('/customer-says/',async(req,res)=>{
  const data=await legacy({action:'reviews',per_page:20,page:Math.max(1,Number(req.query.rvpage)||1)})
  const rendered=renderReviews(data),template=fs.readFileSync(path.join(root,'templates',routes['/customer-says/']),'utf8')
  res.send(template.replace('__D4U_REVIEW_LIST__',rendered.list).replace('__D4U_REVIEW_PAGINATION__',rendered.pagination).replace('__D4U_REVIEW_INFO__',rendered.info))
})
app.get('/{*path}',(req,res)=>{
  const name=routes[req.path.endsWith('/')?req.path:req.path+'/']
  if(name)return res.sendFile(path.join(root,'templates',name))
  res.status(404).send(html('<section class="d4u-panel"><h1>Page not found</h1><a href="/">Back to the store</a></section>'))
})
app.use((error,req,res,next)=>{
  console.error(req.method,req.path,error.status||500)
  const message=error.status&&error.status<500?error.message:'This service is temporarily unavailable. Please try again.'
  res.status(error.status||503).json({message})
})
app.listen(port,process.env.HOST||'127.0.0.1',(error)=>{if(error)throw error;console.log(`365D4U storefront listening on ${port}`)})
