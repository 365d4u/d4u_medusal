import {test} from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import {mountInvoiceRoutes} from '../src/invoice-routes.mjs'

test('Embedded backend and independent Invoice never substitute each other\'s cookies',async()=>{
 const app=express(),calls=[]
 app.use(express.json())
 mountInvoiceRoutes(app,{root:'.',cookie:(req,name)=>req.headers.cookie?.split('; ').find(v=>v.startsWith(name+'='))?.split('=')[1],setCookie:()=>{},medusa:async(route,options)=>{
  calls.push({route,options})
  if(route==='/store/staff/session')return {user:{name:'Invoice-only staff'}}
  if(route==='/admin/users/me')return {user:{first_name:'Backend viewer'}}
  if(route==='/admin/staff-access/me')return {grant:{enabled:true,pages:['invoices'],super_admin:false,create_invoices:false,manage_payment_limit:false}}
  throw Error('Unexpected route')
 }})
 app.use((err,req,res,next)=>res.status(err.status||500).json({message:err.message}))
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port
 try{
  const embedded=await fetch(base+'/api/staff/session',{headers:{'x-staff-context':'admin',cookie:'d4u_feishu=invoice-token; d4u_staff=other-admin-token; connect.sid=native-admin-session'}})
  assert.equal(embedded.status,200);assert.equal((await embedded.json()).user.can_create_invoices,false)
  assert.equal(calls[0].route,'/admin/users/me');assert.equal(calls[0].options.token,null);assert.ok(calls[0].options.headers.Cookie.includes('connect.sid=native-admin-session'))
  calls.length=0
  const independent=await fetch(base+'/api/staff/session',{headers:{cookie:'d4u_feishu=invoice-token; connect.sid=native-admin-session'}})
  assert.equal((await independent.json()).user.can_create_invoices,true);assert.equal(calls[0].route,'/store/staff/session');assert.equal(calls[0].options.token,'invoice-token')
  calls.length=0
  assert.equal((await fetch(base+'/api/staff/session',{headers:{cookie:'connect.sid=native-admin-session; d4u_customer=customer-token'}})).status,401)
  assert.equal(calls.length,0)
 }finally{await new Promise(r=>server.close(r))}
})
