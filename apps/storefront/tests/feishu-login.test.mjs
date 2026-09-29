import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createFeishuFlow,validateFeishuFlow} from '../src/feishu-login.mjs'
import {mountFeishuLogin} from '../src/feishu-login.mjs'
import express from 'express'
import {createHash,createHmac} from 'node:crypto'
import {createRequire} from 'node:module'
const backendRequire=createRequire(new URL('../../backend/package.json',import.meta.url))
const session=backendRequire('express-session')

test('Internal HTTP session hop preserves the HTTPS context required for a real secure cookie',async()=>{
 const previous={...process.env};Object.assign(process.env,{FEISHU_ENABLED:'true',FEISHU_APP_ID:'cli_fixture',FEISHU_BRIDGE_SECRET:'fixture-secret-with-more-than-32-characters',STOREFRONT_URL:'https://example.invalid',COOKIE_SECURE:'true'})
 const backendApp=express()
 backendApp.use(session({secret:'fixture-only-session-secret',proxy:true,resave:false,saveUninitialized:false,cookie:{secure:true,httpOnly:true,sameSite:'lax'}}))
 backendApp.post('/auth/session',(req,res)=>{req.session.auth_context={actor_type:'user',actor_id:'fixture-only'};res.json({success:true})})
 const api=backendApp.listen(0,'127.0.0.1');await new Promise(r=>api.once('listening',r));const backend='http://127.0.0.1:'+api.address().port
 const app=express()
 mountFeishuLogin(app,{backend,cookie:req=>req.headers.cookie,setCookie:(res,name,value)=>res.append('Set-Cookie',name+'='+encodeURIComponent(value)),medusa:async route=>route==='/auth/user/feishu'?{token:'fixture-token'}:{grant:{super_admin:false}}})
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port
 try{
  const noProxy=await fetch(backend+'/auth/session',{method:'POST'});assert.equal(noProxy.status,200);assert.equal(noProxy.headers.get('set-cookie'),null)
  const flow=createFeishuFlow('admin')
  const done=await fetch(base+'/api/staff/feishu/callback?state='+flow.state+'&code=fixture',{redirect:'manual',headers:{cookie:JSON.stringify(flow)}})
  assert.equal(done.headers.get('location'),'/app/billing')
  const cookie=done.headers.getSetCookie().find(value=>value.startsWith('connect.sid='))
  assert.ok(cookie);assert.match(cookie,/; Secure/);assert.match(cookie,/; HttpOnly/)
 }finally{await new Promise(r=>server.close(r));await new Promise(r=>api.close(r));for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous)}
})

test('Backend Feishu sign-in sends ordinary staff straight to invoices and administrators to their pages',async t=>{
 const previous={...process.env};Object.assign(process.env,{FEISHU_ENABLED:'true',FEISHU_APP_ID:'cli_fixture',FEISHU_BRIDGE_SECRET:'fixture-secret-with-more-than-32-characters',STOREFRONT_URL:'https://example.invalid'})
 let administrator=false
 const app=express(),realFetch=globalThis.fetch
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(String(url)!=='http://backend.invalid/auth/session')return realFetch(url,options)
  assert.equal(options.headers['X-Forwarded-Proto'],'https')
  return new Response('{}',{headers:{'Set-Cookie':'connect.sid=backend-session; HttpOnly; Secure; Path=/'}})
 })
 mountFeishuLogin(app,{backend:'http://backend.invalid',cookie:(req,name)=>{const value=req.headers.cookie?.split('; ').find(v=>v.startsWith(name+'='));return value?decodeURIComponent(value.slice(name.length+1)):null},setCookie:(res,name,value,maxAge)=>res.append('Set-Cookie',name+'='+encodeURIComponent(value)+'; Max-Age='+maxAge+'; HttpOnly'),medusa:async(route)=>{
  if(route==='/auth/user/feishu')return {token:'private-user-token'}
  assert.equal(route,'/admin/staff-access/me');return {grant:{super_admin:administrator}}
 }})
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port
 try{
  for(const isAdmin of [false,true]){
   administrator=isAdmin
   const start=await fetch(base+'/api/staff/feishu/start?target=admin',{redirect:'manual'}),cookie=start.headers.get('set-cookie').split(';')[0],flow=JSON.parse(decodeURIComponent(cookie.split('=')[1]))
   const done=await fetch(base+'/api/staff/feishu/callback?state='+flow.state+'&code=fixture',{redirect:'manual',headers:{cookie}})
   assert.equal(done.headers.get('location'),isAdmin?'/app/staff-home':'/app/billing')
   assert.ok(done.headers.get('set-cookie').includes('connect.sid=backend-session'))
  }
 }finally{await new Promise(r=>server.close(r));for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous)}
})
test('OAuth flow binds callback to a browser state, expires and has independent PKCE material',()=>{
 const flow=createFeishuFlow('invoices',100000),other=createFeishuFlow('invoices',100000)
 assert.equal(flow.actor,'invoice_staff');assert.equal(createFeishuFlow('admin').actor,'user')
 assert.notEqual(flow.state,other.state);assert.notEqual(flow.state,flow.verifier)
 assert.equal(validateFeishuFlow(flow,flow.state,100001),flow)
 assert.throws(()=>validateFeishuFlow(flow,other.state,100001))
 assert.throws(()=>validateFeishuFlow(flow,flow.state,400001))
 assert.throws(()=>validateFeishuFlow(null,flow.state,100001))
})
test('Browser OAuth callback enforces state, uses a signed server exchange and keeps tokens out of redirects',async()=>{
 const previous={...process.env};Object.assign(process.env,{FEISHU_ENABLED:'true',FEISHU_APP_ID:'cli_fixture',FEISHU_BRIDGE_SECRET:'fixture-secret-with-more-than-32-characters',STOREFRONT_URL:'https://example.invalid'})
 const app=express();let exchanges=0,expectedChallenge
 mountFeishuLogin(app,{backend:'http://invalid',cookie:(req,name)=>{const value=req.headers.cookie?.split('; ').find(v=>v.startsWith(name+'='));return value?decodeURIComponent(value.slice(name.length+1)):null},setCookie:(res,name,value,maxAge)=>res.append('Set-Cookie',name+'='+encodeURIComponent(value)+'; Max-Age='+maxAge+'; HttpOnly'),medusa:async(route,{body})=>{
  exchanges++;assert.equal(route,'/auth/invoice_staff/feishu');assert.equal(createHmac('sha256',process.env.FEISHU_BRIDGE_SECRET).update(body.assertion).digest('hex'),body.signature);assert.equal(JSON.parse(body.assertion).code,'single-use-fixture');assert.equal(createHash('sha256').update(JSON.parse(body.assertion).verifier).digest('base64url'),expectedChallenge);return {token:'private-token-fixture'}
 }})
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port
 try{
  const start=await fetch(base+'/api/staff/feishu/start',{redirect:'manual'});assert.equal(start.status,302)
  const url=new URL(start.headers.get('location')),cookie=start.headers.get('set-cookie').split(';')[0],flow=JSON.parse(decodeURIComponent(cookie.split('=')[1]))
  expectedChallenge=url.searchParams.get('code_challenge');assert.equal(url.searchParams.get('code_challenge_method'),'S256')
  assert.equal(url.origin,'https://accounts.feishu.cn');assert.equal(url.searchParams.get('code_challenge'),createHash('sha256').update(flow.verifier).digest('base64url'));assert.equal(url.searchParams.has('scope'),false)
  const invalid=await fetch(base+'/api/staff/feishu/callback?state=wrong&code=single-use-fixture',{redirect:'manual',headers:{cookie}});assert.equal(invalid.headers.get('location'),'/invoices/new/?sso_error=1');assert.equal(exchanges,0)
  const done=await fetch(base+'/api/staff/feishu/callback?state='+flow.state+'&code=single-use-fixture',{redirect:'manual',headers:{cookie}});assert.equal(done.status,303);assert.equal(done.headers.get('location'),'/invoices/new/');assert.equal(exchanges,1);assert.ok(done.headers.get('set-cookie').includes('HttpOnly'));assert.ok(done.headers.get('set-cookie').includes('Max-Age=0'));assert.equal(done.headers.get('location').includes('token'),false)
 }finally{await new Promise(r=>server.close(r));for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous)}
})
