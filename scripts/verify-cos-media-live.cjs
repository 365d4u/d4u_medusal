const fs=require('fs'),assert=require('assert/strict'),crypto=require('crypto')
const base='https://testmedusa.365d4u.com',created=[]
const sha=b=>crypto.createHash('sha256').update(b).digest('hex')
;(async()=>{
 const fixtures=[{type:'image',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/YxQAAAAASUVORK5CYII=','base64')},{type:'video',body:fs.readFileSync('.private/cos-upload-test.mp4')}]
 try{
  for(const fixture of fixtures){
   const response=await fetch(base+'/api/review-media',{method:'POST',headers:{Origin:base,'Content-Type':'application/octet-stream'},body:fixture.body})
   assert.equal(response.status,200,await response.clone().text());const result=await response.json();created.push(result);fs.writeFileSync('.private/cos-upload-fixtures.json',JSON.stringify(created))
   const url=new URL(result.url);assert.equal(url.origin,'https://img.365d4u.com');assert.ok(url.pathname.startsWith('/c365/medusa/test/review-'));assert.equal(result.type,fixture.type)
   const media=await fetch(result.url);assert.equal(media.status,200);assert.equal(sha(Buffer.from(await media.arrayBuffer())),sha(fixture.body));assert.match(media.headers.get('content-type'),fixture.type==='video'?/video\/mp4/:/image\/png/)
   if(fixture.type==='video'){const partial=await fetch(result.url,{headers:{Range:'bytes=0-15'}});assert.equal(partial.status,206);assert.equal((await partial.arrayBuffer()).byteLength,16)}
  }
  const invalid=await fetch(base+'/api/review-media',{method:'POST',headers:{Origin:base,'Content-Type':'application/octet-stream'},body:'<script>not an image</script>'});assert.equal(invalid.status,400)
  const feedback=await fetch(base+'/api/reviews',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({name:'COS upload verification',email:'cos-verification@example.invalid',rating:5,content:'Temporary COS image and video verification, removed after validation.',media:created})})
  assert.equal(feedback.status,200,await feedback.clone().text());const review=await feedback.json();fs.writeFileSync('.private/cos-review-fixture.json',JSON.stringify({review_id:review.review_id}));assert.ok(review.review_id)
  console.log(JSON.stringify({image_upload:true,video_upload:true,cos_url:true,cloud_bytes_match:true,video_range_playback:true,invalid_file_rejected:true,review_with_cos_media_saved:true}))
 }finally{fs.writeFileSync('.private/cos-upload-fixtures.json',JSON.stringify(created))}
})().catch(e=>{console.error(e.message);process.exit(1)})
