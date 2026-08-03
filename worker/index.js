export default {
  async fetch(request, env) {
    const url=new URL(request.url);
    const response=await env.ASSETS.fetch(request);
    if(url.pathname==='/changelog.json'){
      const headers=new Headers(response.headers);
      headers.set('Cache-Control','no-cache, no-store, must-revalidate');
      headers.set('X-Content-Type-Options','nosniff');
      return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
    }
    return response;
  }
};
