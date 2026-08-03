import { chromium } from 'playwright';
const B='https://lp-mssp.tail6397c.ts.net';
const b=await chromium.launch(); const p=await b.newContext({ignoreHTTPSErrors:true}); const page=await p.newPage();
await page.goto(`${B}/login`,{waitUntil:'load'});
await page.locator('input[type=email]').fill('admin@launchpad.demo');
await page.locator('input[type=password]').fill('LaunchpadDemo123!');
await page.getByRole('button',{name:/sign in/i}).click();
await page.waitForURL(u=>!u.pathname.includes('/login'),{timeout:20000});
for (const r of ['/','/tenants','/investigations','/review','/reviews','/alerts']) {
  try { const resp=await page.goto(`${B}${r}`,{waitUntil:'load',timeout:12000});
    const h=await page.locator('h1,h2').allInnerTexts();
    const is404=await page.locator('text=/404|not found/i').count();
    console.log(r, '→', resp.status(), is404?'[404-content]':'', '| headings:', h.slice(0,3).join(' / ').slice(0,70));
  } catch(e){ console.log(r,'ERR',e.message.slice(0,50)); }
}
await b.close();
