import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto'

export function createFeishuFlow(target,now=Date.now()){
 return {state:randomBytes(32).toString('base64url'),verifier:randomBytes(48).toString('base64url'),actor:target==='admin'?'user':'invoice_staff',expires:now+300000}
}
export function validateFeishuFlow(flow,state,now=Date.now()){
 if(!flow||!['user','invoice_staff'].includes(flow.actor)||!Number.isFinite(flow.expires)||flow.expires<now||flow.expires>now+300000||typeof state!=='string'||typeof flow.state!=='string'||state.length!==flow.state.length||!timingSafeEqual(Buffer.from(state),Buffer.from(flow.state)))throw new Error('Feishu sign-in expired. Please try again.')
 return flow
}
export function mountFeishuLogin(app,{cookie,setCookie,medusa,backend}){
 const enabled=()=>process.env.FEISHU_ENABLED==='true'&&!!process.env.FEISHU_APP_ID&&!!process.env.FEISHU_BRIDGE_SECRET&&/^https:\/\//.test(process.env.STOREFRONT_URL||'')
 const origin=()=>process.env.STOREFRONT_URL
 app.get('/api/staff/feishu/config',(_req,res)=>res.set('Cache-Control','no-store').json({enabled:enabled()}))
 app.get('/api/staff/feishu/start',(req,res)=>{
  if(!enabled())return res.status(503).send('Feishu sign-in is not configured yet.')
  const flow=createFeishuFlow(req.query.target)
  setCookie(res,'d4u_feishu_flow',JSON.stringify(flow),300,'Lax')
  const url=new URL('https://accounts.feishu.cn/open-apis/authen/v1/authorize')
  url.search=new URLSearchParams({client_id:process.env.FEISHU_APP_ID,response_type:'code',redirect_uri:origin()+'/api/staff/feishu/callback',state:flow.state,code_challenge:createHash('sha256').update(flow.verifier).digest('base64url'),code_challenge_method:'S256'}).toString()
  res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}).redirect(302,url.href)
 })
 app.get('/api/staff/feishu/callback',async(req,res)=>{
  res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'})
  let actor='invoice_staff'
  let stage='state'
  try{
   if(!enabled())throw new Error('Feishu sign-in is not configured')
   const flow=validateFeishuFlow(JSON.parse(cookie(req,'d4u_feishu_flow')||'null'),req.query.state)
   actor=flow.actor
   setCookie(res,'d4u_feishu_flow','',0,'Lax')
   if(req.query.error||typeof req.query.code!=='string')throw new Error('Feishu authorization was not completed')
   const assertion=JSON.stringify({actor:flow.actor,code:req.query.code,verifier:flow.verifier,redirect_uri:origin()+'/api/staff/feishu/callback',timestamp:Date.now()})
   const signature=createHmac('sha256',process.env.FEISHU_BRIDGE_SECRET).update(assertion).digest('hex')
   stage='authentication'
   const login=await medusa('/auth/'+flow.actor+'/feishu',{method:'POST',body:{assertion,signature}})
   const {token}=login
   if(!token||login.mfa_required||login.verification_required)throw new Error('Feishu sign-in requires additional verification')
   if(flow.actor==='user'){
    stage='session'
    // The internal hop is HTTP, but the browser authenticated over our configured
    // HTTPS origin. Medusa's secure session cookie requires this proxy context.
    const result=await fetch(backend+'/auth/session',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','X-Forwarded-Proto':new URL(origin()).protocol.slice(0,-1)},body:'{}',signal:AbortSignal.timeout(10000)})
    if(!result.ok)throw new Error('Unable to start the administrator session')
    const cookies=result.headers.getSetCookie();if(!cookies.length)throw new Error('Administrator session cookie was not created')
    for(const value of cookies)res.append('Set-Cookie',value+(process.env.COOKIE_SECURE==='true'&&!/;\s*secure/i.test(value)?'; Secure':''))
    stage='permissions'
    const access=await medusa('/admin/staff-access/me',{token})
    return res.redirect(303,access.grant?.super_admin?'/app/orders':'/app/billing')
   }
   setCookie(res,'d4u_feishu',token,8*3600,process.env.COOKIE_SECURE==='true'?'None':'Lax')
   return res.redirect(303,'/invoices/new/')
  }catch(error){
   console.warn(JSON.stringify({event:'feishu_callback_failed',stage,status:Number.isInteger(error?.status)?error.status:null}))
   setCookie(res,'d4u_feishu_flow','',0,'Lax')
   // Never put authorization codes, upstream errors or credentials in a URL.
   return res.redirect(303,actor==='user'?'/app/login?sso_error=1':'/invoices/new/?sso_error=1')
  }
 })
}
