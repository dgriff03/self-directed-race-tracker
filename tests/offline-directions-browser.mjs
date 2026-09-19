import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
const browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
  const context = await browser.newContext({viewport:{width:375,height:812},isMobile:true,hasTouch:true});
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/demo');
  await expect(page.getByRole('button',{name:'Copy GPS coordinates'}).first()).toBeVisible();
  await context.setOffline(true);
  const groups = page.locator('.station-directions');
  assert.ok(await groups.count() > 2);
  for (const group of await groups.all()) {
    await expect(group.getByText('Offline:',{exact:false})).toBeVisible();
    const value = await group.locator('input').inputValue();
    const url = new URL(await group.locator('a').getAttribute('href'));
    const target = url.searchParams.get('destination').split(',').map(Number);
    const coords = value.split(',').map(Number);
    assert.ok(Math.abs(coords[0]-target[0])<0.000001 && Math.abs(coords[1]-target[1])<0.000001);
  }
  await page.evaluate(() => Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedCoordinates=text;}}}));
  await groups.first().getByRole('button').click();
  await expect(groups.first().getByRole('status')).toContainText('GPS coordinates copied');
  assert.equal(await page.evaluate(()=>window.copiedCoordinates),await groups.first().locator('input').inputValue());
  await page.evaluate(() => Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('Denied');}}}));
  await groups.last().getByRole('button').click();
  await expect(groups.last().getByRole('status')).toContainText('Touch and hold');
  assert.equal(await groups.last().locator('input').evaluate(el=>el.selectionEnd-el.selectionStart), (await groups.last().locator('input').inputValue()).length);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  console.log('PASS offline mobile coordinates: every aid, latitude/longitude order, copy success, denied clipboard manual fallback, no overflow');
} finally { await browser.close(); }
