const fs=require('fs'),path=require('path')
process.chdir(path.join(__dirname,'../apps/backend'))
require('../apps/backend/node_modules/ts-node/register')
const {customerPaidEmail,customerPaidAttachment}=require('../apps/backend/src/lib/customer-paid-email')
const output=path.join(__dirname,'../.private/customer-paid-email-preview')
const order={display_id:200099,status:'pending',created_at:'2026-09-28T05:00:00Z',email:'buyer@example.invalid',currency_code:'usd',total:125,items:[{title:'Custom silver necklace / 定制项链',quantity:1,unit_price:100},{title:'Gift box',quantity:1,unit_price:25}],billing_address:{first_name:'Example',last_name:'Buyer',address_1:'123 Example Street',city:'New York',province:'NY',postal_code:'10001',country_code:'us'},shipping_address:{first_name:'Example',last_name:'Buyer',address_1:'123 Example Street',city:'New York',province:'NY',postal_code:'10001',country_code:'us'}}
;(async()=>{fs.mkdirSync(output,{recursive:true});const mail=customerPaidEmail(order,'ppcp-gateway'),attachment=await customerPaidAttachment(order);fs.writeFileSync(path.join(output,'email.html'),mail.html);fs.writeFileSync(path.join(output,'invoice.pdf'),Buffer.from(attachment.content,'base64'));console.log('Customer email and PDF preview generated from fictional data.')})().catch(e=>{console.error(e.message);process.exit(1)})
