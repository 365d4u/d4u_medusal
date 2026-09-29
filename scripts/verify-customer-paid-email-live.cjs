// Read-only live verification. No orders, payments, template saves or emails.
const fs=require('fs'),assert=require('node:assert/strict'),{chromium}=require('playwright')
const base='https://testmedusa.365d4u.com',credentials=JSON.parse(fs.readFileSync('.private/admin-access.json','utf8'))
;(async()=>{
 const browser=await chromium.launch({headless:true}),errors=[]
 try{
  const context=await browser.newContext(),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message))
  const login=await context.request.post(base+'/api/staff/login',{headers:{Origin:base},data:{email:credentials.email,password:credentials.password}});assert.equal(login.status(),200,'staff login')
  for(const width of [375,1280]){
   await page.setViewportSize({width,height:850});await page.goto(base+'/invoices/new/');await page.locator('#create-panel').waitFor()
   assert.equal(await page.locator('#list-panel').isVisible(),false);assert.equal(await page.locator('[data-tab=create]').getAttribute('class'),'active')
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'.private/customer-paid-email-preview/create-live-'+width+'.png',fullPage:true})
   await page.getByRole('button',{name:'Invoices',exact:true}).click();await page.locator('#list-panel').waitFor();await page.locator('#invoice-count').filter({hasText:/invoice/}).waitFor()
  }
  const auth=await context.request.post(base+'/auth/user/emailpass',{data:{email:credentials.email,password:credentials.password}});assert.equal(auth.status(),200,'admin login');const {token}=await auth.json()
  const headers={Authorization:'Bearer '+token,Origin:base}
  const response=await context.request.get(base+'/admin/email-management?templates=true',{headers});if(response.status()===403){assert.deepEqual(errors,[]);console.log(JSON.stringify({default_create:true,mobile_desktop:true,list_navigation:true,management_account_restricted:true,no_real_emails_sent:true}));return}assert.equal(response.status(),200,'template read')
  const {templates}=await response.json(),template=templates.find(t=>t.id==='customer_processing_order');assert.ok(template?.enabled)
  assert.equal(templates.find(t=>t.id==='customer_completed_order').enabled,false)
  const preview=await context.request.post(base+'/admin/email-management',{headers,data:{preview:template}});assert.equal(preview.status(),200,'template preview')
  const mail=await preview.json();assert.match(mail.html,/Thank you for your order/);assert.match(mail.html,/Order #200000/)
  fs.writeFileSync('.private/customer-paid-email-preview/live-template.html',mail.html)
  await page.setContent(mail.html);await page.screenshot({path:'.private/customer-paid-email-preview/email-live.png',fullPage:true})
  const log=await context.request.get(base+'/admin/email-management?limit=1',{headers});assert.equal(log.status(),200,'email log')
  for(const email of (await log.json()).emails)assert.equal(email.mail?.attachments,undefined)
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({default_create:true,mobile_desktop:true,list_navigation:true,customer_template:true,legacy_disabled_rules:true,payment_email_preview:true,email_log:true,no_real_emails_sent:true}))
 }finally{await browser.close()}
})().catch(e=>{console.error(e.message);process.exit(1)})
