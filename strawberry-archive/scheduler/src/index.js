// Strawberry Moon independent scheduler: Cloudflare Workers Free Cron Trigger.
// Set ARCHIVE_URL as a Worker variable and ARCHIVE_CRON_TOKEN as a secret.
// Never include credentials in the source repository.
export default {
  async scheduled(_event,env,ctx) {
    ctx.waitUntil((async()=>{
      if(!env.ARCHIVE_URL||!env.ARCHIVE_CRON_TOKEN)throw new Error('Worker configuration missing');
      const url=new URL('/api/cron-scan',env.ARCHIVE_URL);
      if(url.protocol!=='https:')throw new Error('ARCHIVE_URL must be https');
      const result=await fetch(url.href,{
        method:'POST',
        headers:{Authorization:'Bearer '+env.ARCHIVE_CRON_TOKEN},
        signal:AbortSignal.timeout(30000)
      });
      if(!result.ok)throw new Error('Wake request returned '+result.status);
    })());
  }
};
