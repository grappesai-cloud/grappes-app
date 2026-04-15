#!/usr/bin/env npx tsx
/**
 * Test email script — sends one of each template to TEST_TO.
 * Usage: TEST_TO=you@example.com npx tsx scripts/test-email.ts
 *
 * Requires RESEND_API_KEY to be set in environment.
 */

// Polyfill import.meta.env for non-Astro context
const env = process.env;
(globalThis as any).importMetaEnv = env;

// Monkey-patch import.meta.env
Object.defineProperty(import.meta, 'env', {
  get: () => env,
  configurable: true,
});

import {
  sendFormEmail,
  sendWelcomeEmail,
  sendSiteLiveEmail,
  sendReferralPayoutAlert,
  sendReferralEarnedEmail,
  sendSubscriptionCancelledEmail,
  sendDeploymentFailedEmail,
  sendDomainPurchaseFailedEmail,
  sendPaymentConfirmedEmail,
  sendPasswordChangedEmail,
} from '../src/lib/resend';

const TEST_TO = env.TEST_TO;
if (!TEST_TO) {
  console.error('❌ Set TEST_TO=you@example.com');
  process.exit(1);
}
if (!env.RESEND_API_KEY) {
  console.error('❌ Set RESEND_API_KEY');
  process.exit(1);
}

// Override ADMIN_EMAIL so admin alerts go to test address
env.ADMIN_EMAIL = TEST_TO;

const results: { name: string; success: boolean; error?: string }[] = [];

async function test(name: string, fn: () => Promise<any>) {
  try {
    const r = await fn();
    results.push({ name, success: r.success, error: r.error });
    console.log(r.success ? `  ✅ ${name}` : `  ❌ ${name}: ${r.error}`);
  } catch (e: any) {
    results.push({ name, success: false, error: e.message });
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

async function main() {
  console.log(`\n📧 Sending test emails to ${TEST_TO}\n`);

  await test('sendWelcomeEmail', () =>
    sendWelcomeEmail({ to: TEST_TO!, name: 'Test User' })
  );

  await test('sendSiteLiveEmail', () =>
    sendSiteLiveEmail({ to: TEST_TO!, siteName: 'My Test Site', siteUrl: 'https://example.grappes.dev' })
  );

  await test('sendFormEmail', () =>
    sendFormEmail({
      to: TEST_TO!,
      siteName: 'Acme Corp',
      siteUrl: 'https://acme.grappes.dev',
      submission: { name: 'Jane Doe', email: 'jane@example.com', message: 'Hi, I am interested in your services.' },
    })
  );

  await test('sendReferralPayoutAlert', () =>
    sendReferralPayoutAlert({ referrerEmail: 'referrer@example.com', amount: 75 })
  );

  await test('sendReferralEarnedEmail', () =>
    sendReferralEarnedEmail({ to: TEST_TO!, amount: 15, newBalance: 45, plan: 'pro' })
  );

  await test('sendSubscriptionCancelledEmail', () =>
    sendSubscriptionCancelledEmail({ to: TEST_TO!, siteName: 'My Cancelled Site' })
  );

  await test('sendDeploymentFailedEmail', () =>
    sendDeploymentFailedEmail({ to: TEST_TO!, siteName: 'Broken Deploy', error: 'Build timeout after 120s' })
  );

  await test('sendDomainPurchaseFailedEmail', () =>
    sendDomainPurchaseFailedEmail({ domain: 'example.com', projectId: 'test-123', error: 'Payment declined' })
  );

  await test('sendPaymentConfirmedEmail', () =>
    sendPaymentConfirmedEmail({ to: TEST_TO!, editsAdded: 50, totalExtra: 75 })
  );

  await test('sendPasswordChangedEmail', () =>
    sendPasswordChangedEmail({ to: TEST_TO! })
  );

  console.log('\n────────────────────────────────');
  const passed = results.filter(r => r.success).length;
  console.log(`Results: ${passed}/${results.length} sent successfully`);
  if (passed < results.length) {
    console.log('Failed:');
    results.filter(r => !r.success).forEach(r => console.log(`  - ${r.name}: ${r.error}`));
  }
  console.log('');
}

main().catch(console.error);
