import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);

test('website forwards captured Google attribution into Opal CRM', async () => {
  const worker = await readFile(new URL('crm/worker.js', ROOT), 'utf8');
  const payload = worker.slice(worker.indexOf('body: JSON.stringify({'), worker.indexOf('});\n  if (!res.ok', worker.indexOf('body: JSON.stringify({')));

  assert.match(payload, /gclid:\s+lead\.gclid \|\| undefined/);
  assert.match(payload, /gbraid:\s+lead\.gbraid \|\| undefined/);
  assert.match(payload, /wbraid:\s+lead\.wbraid \|\| undefined/);
  assert.match(payload, /utm_source:\s+lead\.utm_source \|\| undefined/);
});

test('hashed user data is registered before the account-level form event', async () => {
  const source = await readFile(new URL('js/main.js', ROOT), 'utf8');
  const marker = '/* OPAL_GOOGLE_ENHANCED_LEADS_V2';
  const helper = source.slice(source.indexOf(marker));
  const calls = [];
  const hashed = {
    sha256_email_address: 'email-hash',
    sha256_phone_number: 'phone-hash',
  };
  const context = {
    window: {
      __opalBuildEnhancedUserData: async () => hashed,
    },
    gtag: (...args) => calls.push(args),
  };

  vm.runInNewContext(helper, context);
  const result = await context.window.__opalBuildEnhancedUserData(
    'person@example.com',
    '+919876543210',
    'Example Person',
  );
  context.gtag('event', 'conversion', {
    send_to: 'AW-18204959421/pDb3CKiOw7ccEL3F5uhD',
    user_data: result,
  });

  assert.deepEqual(result, hashed);
  assert.equal(JSON.stringify(calls), JSON.stringify([
    ['set', 'user_data', hashed],
    ['event', 'form_submit', { send_to: 'AW-18204959421' }],
    ['event', 'conversion', {
      send_to: 'AW-18204959421/pDb3CKiOw7ccEL3F5uhD',
      user_data: hashed,
    }],
  ]));
});
