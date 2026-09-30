// Read-only verification on TEST. Does not save merchant settings or initiate payments.
const fs = require('node:fs')
const assert = require('node:assert/strict')
const { chromium } = require('playwright')
const base = 'https://testmedusa.365d4u.com'

;(async () => {
  const credentials = JSON.parse(fs.readFileSync('.private/admin-access.json', 'utf8'))
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext(), page = await context.newPage(), errors = []
    page.on('pageerror', error => errors.push(error.message))
    const report = { origin: base, real_payments_initiated: false, settings_changed: false }
    for (const entry of ['/admin', '/admin/']) {
      const response = await context.request.get(base + entry, { maxRedirects: 0 })
      assert.equal(response.status(), 302); assert.ok(response.headers().location.endsWith('/app/'))
    }
    report.admin_entry_redirects = true
    await page.goto(base + '/admin')
    await page.locator('[name=email]').waitFor({ timeout: 30000 })
    assert.ok(page.url().startsWith(base + '/app/login'))
    report.anonymous_entry_reaches_login = true
    const auth = await context.request.post(base + '/auth/user/emailpass', { data: { email: credentials.email, password: credentials.password }, headers: { Origin: base } })
    assert.equal(auth.status(), 200, 'Existing verification account login')
    const { token } = await auth.json(), headers = { Origin: base, Authorization: 'Bearer ' + token }
    const session = await context.request.post(base + '/auth/session', { headers }); assert.equal(session.status(), 200)
    const grant = await context.request.get(base + '/admin/staff-access/me', { headers }); assert.equal(grant.status(), 200)
    const response = await context.request.get(base + '/admin/store-management/payment-connections', { headers })
    if (response.status() === 403) {
      report.verification_account_restricted = true
      await page.goto(base + '/app/store-settings')
      await page.getByText('You have not been assigned this page.', { exact: false }).waitFor({ timeout: 30000 })
      report.restricted_page_denied = true
    } else {
      assert.equal(response.status(), 200)
      const data = await response.json(), saved = data.connections
      assert.equal(saved.paypal.client_secret, undefined); assert.equal(saved.ocean.secure_code, undefined); assert.equal(saved.applepay.secure_code, undefined)
      assert.equal(saved.paypal.environment, 'sandbox'); assert.equal(saved.ocean.environment, 'sandbox')
      assert.equal(data.webhooks.paypal, base + '/hooks/payment/paypal_paypal')
      assert.equal(data.webhooks.ocean, base + '/webhooks/oceanpayment')
      report.admin_configuration_redacted = true
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 }); await page.goto(base + '/app/store-settings')
        await page.getByRole('heading', { name: '支付接入配置', exact: true }).waitFor({ timeout: 30000 })
        assert.equal(await page.locator('input[type=password]').count(), 3)
        for (const input of await page.locator('input[type=password]').all()) assert.equal(await input.inputValue(), '')
        assert.equal(await page.getByRole('button', { name: '保存支付接入配置', exact: true }).isDisabled(), !data.can_edit)
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
        await page.screenshot({ path: '.private/payment-connections-deployment/live-' + width + '.png', fullPage: true })
      }
      report.desktop_mobile_configuration_page = true
    }
    const config = await context.request.get(base + '/api/config'); assert.equal(config.status(), 200)
    const publicConfig = await config.json()
    assert.equal(publicConfig.ocean_sandbox, true)
    for (const secret of ['client_secret', 'secure_code', 'webhook_id', 'client_id']) assert.ok(!JSON.stringify(publicConfig).includes('"' + secret + '"'))
    report.public_configuration_redacted = true
    assert.deepEqual(errors, [])
    report.browser_errors = errors
    fs.writeFileSync('.private/payment-connections-deployment/live-verification.json', JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report))
  } finally { await browser.close() }
})().catch(error => { console.error(error.message); process.exitCode = 1 })
