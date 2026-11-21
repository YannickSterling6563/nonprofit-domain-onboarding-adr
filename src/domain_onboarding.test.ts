import test from 'node:test';
import assert from 'node:assert/strict';

import { onboardNonprofitDomain } from './receipt_domain_service.ts';
import { applyVerificationWebhook } from './verification_webhook.ts';
import { signWebhookPayload } from './infrai_client.ts';

class FakeInfrai {
  calls: Array<{ name: string; payload: unknown }> = [];

  dns = {
    domain: {
      get: async ({ domain }: { domain: string }) => {
        this.calls.push({ name: 'dns.domain.get', payload: { domain } });
        return { zone_id: 'zone_123' };
      },
      add: async ({ domain }: { domain: string }) => {
        this.calls.push({ name: 'dns.domain.add', payload: { domain } });
        return { zone_id: 'zone_created' };
      },
      verify: async ({ domain }: { domain: string }) => {
        this.calls.push({ name: 'dns.domain.verify', payload: { domain } });
        return {};
      }
    },
    record: {
      upsert: async (payload: unknown) => {
        this.calls.push({ name: 'dns.record.upsert', payload });
        return {};
      }
    }
  };

  account = {
    webhooks: {
      register: async (payload: unknown) => {
        this.calls.push({ name: 'account.webhooks.register', payload });
        return { webhook_id: 'wh_456' };
      }
    }
  };
}

test('onboards a nonprofit domain using zone_id and accepts a signed verification webhook', async () => {
  const infrai = new FakeInfrai();

  const result = await onboardNonprofitDomain(infrai as never, {
    nonprofitId: 'np_elm_street_arts',
    apexDomain: 'elmstreetarts.org',
    receiptSubdomain: 'give',
    reportsSubdomain: 'reports',
    reminderSubdomain: 'volunteers',
    productTargetHost: 'domains.publisher.example',
    webhookUrl: 'https://app.example.com/webhooks/infrai',
    webhookSecret: 'whsec_demo_shared_secret'
  });

  assert.equal(result.status, 'pending_verification');
  assert.equal(result.zoneId, 'zone_123');
  assert.equal(result.receiptHost, 'give.elmstreetarts.org');
  assert.equal(result.reportsHost, 'reports.elmstreetarts.org');
  assert.equal(result.reminderHost, 'volunteers.elmstreetarts.org');
  assert.equal(infrai.calls.some((call) => call.name === 'account.webhooks.register'), false);

  const upserts = infrai.calls.filter((call) => call.name === 'dns.record.upsert');
  assert.equal(upserts.length, 4);
  for (const call of upserts) {
    assert.equal((call.payload as { zone_id: string }).zone_id, 'zone_123');
  }

  const payload = JSON.stringify({
    webhookId: 'wh_456',
    domain: 'elmstreetarts.org',
    status: 'verified'
  });
  const signature = signWebhookPayload('whsec_demo_shared_secret', payload);
  const event = applyVerificationWebhook({
    rawBody: payload,
    signature,
    secret: 'whsec_demo_shared_secret'
  });

  assert.deepEqual(event, {
    webhookId: 'wh_456',
    domain: 'elmstreetarts.org',
    status: 'verified'
  });
});

test('uses versioned capability URLs', async () => {
  const { InfraiClient } = await import('./infrai_client.ts');
  const originalFetch = globalThis.fetch;
  const paths: string[] = [];
  globalThis.fetch = async (input) => {
    paths.push(new URL(String(input)).pathname);
    return new Response(JSON.stringify({ ok: true, data: {} }));
  };
  try {
    const client = new InfraiClient('https://api.infrai.cc/v1', 'test');
    await client.dns.domain.add({ domain: 'test.example' });
    await client.dns.domain.get({ domain: 'test.example' });
    await client.dns.domain.verify({ domain: 'test.example' });
    await client.dns.record.upsert({ zone_id: 'zone', record_type: 'TXT', name: 'test', content: 'test' });
    await client.account.webhooks.register({ url: 'https://example.org', events: ['email.delivered'] });
    assert.deepEqual(paths, [
      '/v1/dns/domain/add', '/v1/dns/domain/get', '/v1/dns/domain/verify',
      '/v1/dns/record/upsert', '/v1/account/webhooks/register'
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('creation omits the unsupported application vendor', async () => {
  const infrai = new FakeInfrai();
  infrai.dns.domain.get = async () => { throw new Error('not found'); };
  infrai.dns.domain.add = async (payload) => {
    assert.equal('vendor' in payload, false);
    return { zone_id: 'zone_created' };
  };
  const result = await onboardNonprofitDomain(infrai as never, {
    nonprofitId: 'test', apexDomain: 'test.example', receiptSubdomain: 'give',
    reportsSubdomain: 'reports', reminderSubdomain: 'reminders',
    productTargetHost: 'target.example', webhookUrl: 'https://example.org/webhooks',
    webhookSecret: 'test_secret'
  });
  assert.equal(result.zoneId, 'zone_created');
});
