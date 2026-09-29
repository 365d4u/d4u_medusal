import fs from 'node:fs'
import path from 'node:path'
import {escape,money} from './views.mjs'

export function mountInvoiceRoutes(app,{root,medusa,cookie,setCookie}){
 app.use(['/api/staff','/api/invoices'],(req,res,next)=>{res.set('Cache-Control','private, no-store');next()})
 const staff=(req,route,options={})=>{
  const adminMode=req.headers['x-staff-context']==='admin'
  const feishu=!adminMode&&cookie(req,'d4u_feishu')
  if(feishu){
   if(route==='/admin/users/me')return medusa('/store/staff/session',{token:feishu})
   if(route.includes('/payment-policy'))throw Object.assign(new Error('Only administrators can change the payment limit.'),{status:403})
   return medusa(route.replace(/^\/admin\/invoices/,'/store/staff/invoices'),{...options,token:feishu})
  }
  // Embedded Admin uses its native session exclusively. An independent Invoice
  // session must never override a restricted Admin session in the same browser.
  const token=adminMode?null:cookie(req,'d4u_staff')
  if(!adminMode&&!token)throw Object.assign(new Error('Invoice staff sign-in is required.'),{status:401})
  return medusa(route,{...options,token,headers:{...options.headers,...(!token?{Cookie:req.headers.cookie||''}:{})}})
 }
 const invoiceKey=req=>String(req.params.key||req.query.key||req.body?.key||'')
 const invoiceApi=(req,suffix='',options={})=>medusa('/store/invoices/'+encodeURIComponent(req.params.number)+suffix,{...options,headers:{'x-invoice-key':invoiceKey(req)}})
 app.get('/invoices/new/',(req,res)=>{
  res.removeHeader('X-Frame-Options');res.set('Content-Security-Policy',"frame-ancestors 'self' https://*.feishu.cn https://*.feishu.net https://*.larksuite.com");res.set('Cache-Control','no-store');res.sendFile(path.join(root,'templates/invoice-builder.html'))
 })
 app.post('/api/staff/login',async(req,res)=>{
  const {token}=await medusa('/auth/user/emailpass',{method:'POST',body:{email:String(req.body.email||'').trim().toLowerCase(),password:String(req.body.password||'')}})
  await medusa('/admin/users/me',{token})
  setCookie(res,'d4u_feishu','',0)
  setCookie(res,'d4u_staff',token,8*3600,process.env.COOKIE_SECURE==='true'?'None':'Lax');res.json({success:true})
 })
 app.post('/api/staff/logout',(req,res)=>{setCookie(res,'d4u_staff','',0);setCookie(res,'d4u_feishu','',0);res.json({success:true})})
 app.get('/api/staff/session',async(req,res)=>{
  const {user}=await staff(req,'/admin/users/me')
  const independent=req.headers['x-staff-context']!=='admin'&&cookie(req,'d4u_feishu')
  const grant=independent?null:(await staff(req,'/admin/staff-access/me')).grant
  const canView=independent||grant?.enabled&&(grant.super_admin||grant.pages.includes('invoices'))
  if(!canView)return res.status(403).json({message:'Invoice access has not been assigned.'})
  res.json({user:{email:user.email,first_name:user.first_name,name:user.name,feishu:user.feishu,can_create_invoices:!!(independent||grant?.super_admin||grant?.create_invoices),can_manage_payment_limit:!!(!independent&&(grant?.super_admin||grant?.manage_payment_limit))}})
 })
 app.get('/api/staff/invoices',async(req,res)=>res.json(await staff(req,'/admin/invoices?'+new URLSearchParams({limit:'20',offset:String(Number(req.query.offset)||0),search:String(req.query.search||''),date:String(req.query.date||''),paid_only:String(req.query.paid_only||'false')}))))
 app.get('/api/staff/invoices/:number',async(req,res)=>res.json(await staff(req,'/admin/invoices/'+encodeURIComponent(req.params.number))))
 app.post('/api/staff/invoices/:number',async(req,res)=>res.json(await staff(req,'/admin/invoices/'+encodeURIComponent(req.params.number),{method:'POST',body:req.body})))
 app.get('/api/staff/invoices/:number/history',async(req,res)=>res.json(await staff(req,'/admin/invoices/'+encodeURIComponent(req.params.number)+'/history'+(req.query.before?'?before='+encodeURIComponent(String(req.query.before)):''))))
 app.post('/api/staff/invoices',async(req,res)=>res.status(201).json(await staff(req,'/admin/invoices',{method:'POST',body:req.body,headers:{'idempotency-key':String(req.body.request_id||'')}})))
 app.post('/api/staff/invoices/:number/payment-policy',async(req,res)=>res.json(await staff(req,'/admin/invoices/'+encodeURIComponent(req.params.number)+'/payment-policy',{method:'POST',body:req.body})))
 app.get('/api/invoices/:number',async(req,res)=>{res.set('Cache-Control','no-store');res.json(await invoiceApi(req))})
 app.post('/api/invoices/:number/method',async(req,res)=>res.json(await invoiceApi(req,'/method',{method:'POST',body:req.body})))
 app.post('/api/invoices/:number/payment',async(req,res)=>res.json(await invoiceApi(req,'/payment',{method:'POST',body:{...req.body,ip_address:req.ip}})))
 app.post('/api/invoices/:number/complete',async(req,res)=>res.json(await invoiceApi(req,'/complete',{method:'POST',body:{}})))
 app.get(['/payit/:number/:key','/checkout/order-pay/:number/'],async(req,res)=>{
  res.set({'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'})
  const {invoice}=await invoiceApi(req)
  if(req.path!==invoice.payment_path)return res.redirect(302,invoice.payment_path+(req.query.payment_return==='1'?'?payment_return=1':''))
  let html=fs.readFileSync(path.join(root,'templates/invoice-payment.html'),'utf8')
  const rows=invoice.items.map((i,index)=>`<tr class="invoice-line"><th colspan="2" scope="row"><table class="innerTable" style="width:100%"><tbody><tr><td style="padding:0;width:65%"><span class="${invoice.customer_note?'cusfeeNameBold':'cusfeeName'}">${i.thumbnail?`<img src="${escape(i.thumbnail)}" alt="" style="width:70px;height:70px;object-fit:cover;vertical-align:middle;margin-right:14px">`:''}${escape(i.title)}</span>${index===0&&invoice.customer_note?`<div class="cus_note" style="font-size:12px;font-weight:normal;white-space:pre-wrap;overflow-wrap:anywhere">${escape(invoice.customer_note)}</div>`:''}</td><td><span class="cusFeeQty">${i.quantity}</span></td></tr></tbody></table></th><td class="product-total"><span class="woocommerce-Price-amount amount cusFeePriceVal"><bdi>${money(i.unit_price*i.quantity,invoice.currency_code)}</bdi></span></td></tr>`).join('')
  const data=JSON.stringify({invoice,ocean_sandbox:process.env.OCEAN_ENVIRONMENT!=='production',applepay_enabled:process.env.APPLEPAY_ENABLED==='true',key:invoiceKey(req),returning:req.query.payment_return==='1'}).replace(/</g,'\\u003c')
  html=html.replaceAll('__INVOICE_NUMBER__',String(invoice.display_id)).replace('__INVOICE_ROWS__',rows).replaceAll('__INVOICE_TOTAL__',money(invoice.amount,invoice.currency_code)).replace('__INVOICE_DATA__',data)
  res.send(html)
 })
}
