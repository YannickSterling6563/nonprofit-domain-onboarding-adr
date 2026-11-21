import { z } from 'zod';

export const nonprofitDomainRequestSchema = z.object({
  nonprofitId: z.string().min(1),
  apexDomain: z.string().min(3),
  receiptSubdomain: z.string().min(1),
  reportsSubdomain: z.string().min(1),
  reminderSubdomain: z.string().min(1),
  productTargetHost: z.string().min(1),
  webhookUrl: z.string().url(),
  webhookSecret: z.string().min(8)
});

export type NonprofitDomainRequest = z.infer<typeof nonprofitDomainRequestSchema>;

export type DomainOnboardingResult = {
  status: 'pending_verification';
  zoneId: string;
  receiptHost: string;
  reportsHost: string;
  reminderHost: string;
};

export function joinHost(label: string, apexDomain: string): string {
  return `${label}.${apexDomain}`;
}
