import {test,expect,type BrowserContext,type Page} from '@playwright/test';
const owner='11111111-1111-4111-8111-111111111111',challenge='33333333-3333-4333-8333-333333333333';
function token(kind:string){return `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({aud:'fixture-client',token_use:'id',sub:owner,email:'fixture@example.test',exp:Math.floor(Date.now()/1000)+3600,kind})).toString('base64url')}.fixture`;}
const original=token('original'),fresh=token('fresh');
async function setup(context:BrowserContext,page:Page,enabled:boolean,authenticated=false){
 await context.route('https://**',route=>route.abort());
 await page.addInitScript(({original,authenticated})=>{localStorage.setItem('lyra:web:ui-language','en');if(authenticated && !sessionStorage.getItem('lyra:web:cognito-session'))sessionStorage.setItem('lyra:web:cognito-session',JSON.stringify({accessToken:'original-access',idToken:original,refreshToken:null,expiresAt:Date.now()+3600000}));},{original,authenticated});
 await context.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  const body=path==='/api/auth/capabilities'?{version:2,google_sign_in:enabled,google_linking:enabled,google_ios:false}:path==='/api/me'?{user:{id:owner,email:'fixture@example.test'},capabilities:{web_image_delivery:false}}:path==='/api/works'?{works:[]}:path==='/api/billing/balance'?{monthly_credits:0,purchased_credits:0,total_credits:0,plan_code:'free',subscription_plans:[]}:path==='/api/compositions'?{compositions:[]}:{};
  await route.fulfill({json:body});
 });
 await context.route('https://cognito.fixture.invalid/**',route=>route.fulfill({contentType:'text/html',body:'<p>Mock native sign-in</p>'}));
 await context.route('https://accounts.google.com/**',route=>route.fulfill({contentType:'text/html',body:'<p>Mock Google authorization</p>'}));
}
test('disabled capability preserves email login and hides Google; iOS stays withheld',async({context,page})=>{
 await setup(context,page,false);await page.goto('/');await expect(page.getByRole('button',{name:'Sign in or create an account'})).toBeVisible();await expect(page.getByRole('button',{name:'Continue with Google'})).toHaveCount(0);
 await context.route('**/api/auth/capabilities?version=2',route=>route.fulfill({json:{version:2,google_sign_in:true,google_linking:true,google_ios:false}}));
 await page.addInitScript(()=>Object.defineProperty(navigator,'platform',{get:()=> 'iPhone'}));await page.reload();await expect(page.getByRole('button',{name:'Continue with Google'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Sign in or create an account'})).toBeVisible();
});
test('normal Google CTA uses existing Cognito PKCE',async({context,page})=>{
 await setup(context,page,true);await page.goto('/');await page.getByRole('button',{name:'Continue with Google'}).click();await page.waitForURL('https://cognito.fixture.invalid/**');const url=new URL(page.url());expect(url.searchParams.get('identity_provider')).toBe('Google');expect(url.searchParams.get('code_challenge_method')).toBe('S256');expect(url.searchParams.has('state')).toBe(true);
});
test('explicit linking uses fresh proof, fixed callback and authenticated receipt without replacing main session',async({context,page})=>{
 await setup(context,page,true,true);let startToken:string|undefined,statusToken:string|undefined;
 await context.route('**/api/auth/identity-links/google/start',async route=>{startToken=route.request().headers().authorization;expect(route.request().postDataJSON().platform).toBe('web');await route.fulfill({json:{challenge_id:challenge,status:'pending',expires_at:new Date(Date.now()+600000).toISOString(),authorization_url:'https://accounts.google.com/o/oauth2/v2/auth?state=fixture',requires_reauthentication:false}});});
 await context.route('**/api/auth/identity-links/google/'+challenge,async route=>{statusToken=route.request().headers().authorization;await route.fulfill({json:{challenge_id:challenge,status:'linked',expires_at:new Date(Date.now()+600000).toISOString(),requires_reauthentication:false}});});
 await context.route('https://cognito.fixture.invalid/oauth2/token',route=>route.fulfill({json:{access_token:'fresh-access',id_token:fresh,expires_in:3600}}));
 await page.goto('/?account=google-link');const currentBefore=await page.evaluate(()=>sessionStorage.getItem('lyra:web:cognito-session'));
 const popupPromise=page.waitForEvent('popup');await page.getByRole('button',{name:'Verify existing login and link Google'}).click();const popup=await popupPromise;await popup.waitForURL('https://cognito.fixture.invalid/**');const url=new URL(popup.url());expect(url.searchParams.get('identity_provider')).toBe('COGNITO');expect(url.searchParams.get('prompt')).toBe('login');expect(url.searchParams.get('max_age')).toBe('0');
 await popup.goto('http://127.0.0.1:4174/?code=fixture-native-code&state='+url.searchParams.get('state'));await popup.waitForURL('https://accounts.google.com/**');
 await popup.goto('http://127.0.0.1:4174/auth/identity-link?challenge_id='+challenge).catch(error=>{if(!popup.isClosed())throw error;});
 await expect(page.getByText('Google is linked to this account.',{exact:false})).toBeVisible();expect(startToken).toBe('Bearer '+fresh);expect(statusToken).toBe('Bearer '+fresh);expect(await page.evaluate(()=>sessionStorage.getItem('lyra:web:cognito-session'))).toBe(currentBefore);await expect(page.getByRole('button',{name:'Sign out to sign in again'})).toBeVisible();
});
