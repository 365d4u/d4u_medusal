// Isolated UI verification: mocked API, no merchant credentials or live payments.
const path = require('node:path')
const fs = require('node:fs/promises')
const assert = require('node:assert/strict')
const { createRequire } = require('node:module')
const { chromium } = require('playwright')
const root = path.resolve(__dirname, '..'), backend = path.join(root, 'apps/backend')
const backendRequire = createRequire(path.join(backend, 'package.json'))

;(async () => {
  const cache = path.join(backend, '.cache/payment-connections-ui')
  await fs.mkdir(cache, { recursive: true })
  await fs.writeFile(path.join(cache, 'index.html'), '<html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./main.tsx"></script></html>')
  await fs.writeFile(path.join(cache, 'main.tsx'), "import React from 'react';import{createRoot}from'react-dom/client';import Settings from '../../src/admin/routes/store-settings/page';createRoot(document.getElementById('root')!).render(<Settings/>);")
  const { createServer } = await import(require('node:url').pathToFileURL(path.join(path.dirname(backendRequire.resolve('vite/package.json')), 'dist/node/index.js')).href)
  const server = await createServer({ configFile: false, root: backend, logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, esbuild: { jsx: 'automatic' } })
  await server.listen()
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1365, height: 1000 } }), errors = []
    page.on('pageerror', error => errors.push(error.message))
    let canEdit = true, conflict = false, saved
    let connections = { revision: 0, paypal: { enabled: true, environment: 'sandbox', app_name: 'Legacy app', client_id: 'client-fixture', client_secret_configured: true, webhook_id: 'webhook-fixture' }, ocean: { enabled: true, environment: 'sandbox', account: 'account-fixture', terminal: 'card-fixture', secure_code_configured: true, public_key: '' }, applepay: { enabled: false, terminal: 'apple-fixture', secure_code_configured: true } }
    await page.route('**/admin/store-management/**', async route => {
      const request = route.request(), section = request.url().split('/').pop()
      if (section === 'payment-connections') {
        if (request.method() === 'POST') {
          if (conflict) return route.fulfill({ status: 400, json: { message: 'Payment connections changed. Reload before saving.' } })
          saved = request.postDataJSON(); connections = { ...structuredClone(saved), revision: connections.revision + 1 }
          delete connections.paypal.client_secret; delete connections.ocean.secure_code; delete connections.applepay.secure_code
          return route.fulfill({ json: { connections } })
        }
        return route.fulfill({ json: { connections, can_edit: canEdit, webhooks: { paypal: 'https://store.example.invalid/hooks/payment/paypal_paypal', ocean: 'https://store.example.invalid/webhooks/oceanpayment' }, storefront_url: 'https://store.example.invalid' } })
      }
      return route.fulfill({ json: { settings: { revision: 0, methods: [{ id: 'pp_paypal_paypal', label: 'PayPal', enabled: true }, { id: 'pp_oceanpayment_oceanpayment', label: 'Credit Card', enabled: true }, { id: 'pp_oceanpayment-applepay_oceanpayment', label: 'Apple Pay', enabled: false }], ocean: { enabled: true, threshold: 1000 } } } })
    })
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/.cache/payment-connections-ui/index.html`)
    const submit = page.getByRole('button', { name: '保存支付接入配置', exact: true })
    await submit.waitFor()
    assert.equal(await page.locator('input[type=password]').count(), 3)
    for (const input of await page.locator('input[type=password]').all()) assert.equal(await input.inputValue(), '')
    await page.getByLabel('REST App 名称／备注').fill('Medusa Live')
    await page.getByLabel('Client Secret', { exact: false }).fill('replacement-fixture')
    await submit.click()
    await page.getByText('已保存。新付款立即使用此配置', { exact: false }).waitFor()
    assert.equal(saved.paypal.app_name, 'Medusa Live'); assert.equal(saved.paypal.client_secret, 'replacement-fixture')
    assert.equal(saved.ocean.secure_code, '')
    assert.equal(await page.getByLabel('Client Secret', { exact: false }).inputValue(), '')
    conflict = true
    await page.getByLabel('REST App 名称／备注').fill('Unsaved change'); await submit.click()
    await page.getByRole('alert').waitFor(); assert.equal(await page.getByLabel('REST App 名称／备注').inputValue(), 'Unsaved change')
    await page.getByRole('button', { name: '撤销修改', exact: true }).click()
    assert.equal(await page.getByLabel('REST App 名称／备注').inputValue(), 'Medusa Live')
    const output = path.join(root, 'artifacts/payment-connections'); await fs.mkdir(output, { recursive: true })
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true })
    canEdit = false; await page.reload(); await submit.waitFor(); assert.equal(await submit.isDisabled(), true)
    assert.deepEqual(errors, [])
    console.log('PASS: desktop/mobile, write-only secrets, save, revision conflict, undo and read-only access')
  } finally { await browser.close(); await server.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
