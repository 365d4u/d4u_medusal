import express from 'express'

export function mountReviewMedia(app,{backend,publishableKey,mediaBase}){
 app.get('/review-media/:name',(req,res)=>{
  if(!mediaBase||! /^[a-f0-9-]{36}\.(jpg|png|webp|gif|mp4)$/.test(req.params.name))return res.sendStatus(404)
  res.redirect(302,mediaBase.replace(/\/?$/,'/')+'legacy-reviews/'+req.params.name)
 })
 app.post('/api/review-media',express.raw({type:'application/octet-stream',limit:'10mb'}),async(req,res)=>{
  if(!Buffer.isBuffer(req.body))return res.status(400).json({message:'Please choose an image or MP4 video.'})
  try{
   const result=await fetch(backend+'/store/review-media',{method:'POST',headers:{'Content-Type':'application/octet-stream','x-publishable-api-key':publishableKey},body:req.body,signal:AbortSignal.timeout(60000)})
   if(!result.ok)return res.status(result.status===400||result.status===413?result.status:502).json({message:'Media upload failed. Please use JPG, PNG, WebP, GIF or MP4, up to 10 MB.'})
   res.json(await result.json())
  }catch{res.status(502).json({message:'Media upload failed. Please try again.'})}
 })
}
