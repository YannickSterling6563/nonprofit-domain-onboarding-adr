import { InfraiClient } from './infrai_client.ts';
import { nonprofitDomainRequestSchema, type DomainOnboardingResult, type NonprofitDomainRequest, joinHost } from './domain_shapes.ts';

async function ensureZoneId(infrai: InfraiClient, domain: string): Promise<string> {
  try {
    const existing = await infrai.dns.domain.get({ domain });
    return existing.zone_id;
  } catch {
    const created = await infrai.dns.domain.add({
      domain,
      metadata: { workflow: 'custom-domain-onboarding' }
    });
    return created.zone_id;
  }
}

export async function onboardNonprofitDomain(infrai: InfraiClient, input: NonprofitDomainRequest): Promise<DomainOnboardingResult> {
  const parsed = nonprofitDomainRequestSchema.parse(input);
  const zoneId = await ensureZoneId(infrai, parsed.apexDomain);

  const receiptHost = joinHost(parsed.receiptSubdomain, parsed.apexDomain);
  const reportsHost = joinHost(parsed.reportsSubdomain, parsed.apexDomain);
  const reminderHost = joinHost(parsed.reminderSubdomain, parsed.apexDomain);

  await infrai.dns.record.upsert({
    zone_id: zoneId,
    record_type: 'CNAME',
    name: parsed.receiptSubdomain,
    content: parsed.productTargetHost,
    ttl: 300,
    proxied: false,
    metadata: { surface: 'donor-receipts', nonprofit_id: parsed.nonprofitId }
  });

  await infrai.dns.record.upsert({
    zone_id: zoneId,
    record_type: 'CNAME',
    name: parsed.reportsSubdomain,
    content: parsed.productTargetHost,
    ttl: 300,
    proxied: false,
    metadata: { surface: 'campaign-reporting', nonprofit_id: parsed.nonprofitId }
  });

  await infrai.dns.record.upsert({
    zone_id: zoneId,
    record_type: 'CNAME',
    name: parsed.reminderSubdomain,
    content: parsed.productTargetHost,
    ttl: 300,
    proxied: false,
    metadata: { surface: 'volunteer-reminders', nonprofit_id: parsed.nonprofitId }
  });

  await infrai.dns.record.upsert({
    zone_id: zoneId,
    record_type: 'TXT',
    name: '_nonprofit-onboarding',
    content: `nonprofit=${parsed.nonprofitId}`,
    ttl: 300,
    metadata: { nonprofit_id: parsed.nonprofitId }
  });

  await infrai.dns.domain.verify({ domain: parsed.apexDomain });

  return {
    status: 'pending_verification',
    zoneId,
    receiptHost,
    reportsHost,
    reminderHost
  };
}

async function main(): Promise<void> {
  const infrai = new InfraiClient();
  const result = await onboardNonprofitDomain(infrai, {
    nonprofitId: 'np_elm_street_arts',
    apexDomain: process.env.INFRAI_DEMO_DOMAIN ?? 'elmstreetarts.org',
    receiptSubdomain: 'give',
    reportsSubdomain: 'reports',
    reminderSubdomain: 'volunteers',
    productTargetHost: 'domains.publisher.example',
    webhookUrl: 'https://app.example.com/webhooks/infrai',
    webhookSecret: 'whsec_demo_shared_secret'
  });

  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
