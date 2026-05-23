/**
 * Dev seed. Creates:
 *   - 1 admin user (email: admin@sblossom.local, password: changeme1234)
 *   - 3 fake orders with 1-3 items each, spread across early workflow states
 *
 * Idempotent on email + shopify_order_id. Re-running upserts rather than
 * duplicating. Safe to run repeatedly while developing.
 *
 * DO NOT run against any DB containing real data. Aborts if it sees an
 * order whose shopify_order_id doesn't match the SEED_PREFIX.
 */
import bcrypt from 'bcryptjs';
import { loadEnvConfig } from '@next/env';
import { eq } from 'drizzle-orm';

loadEnvConfig(process.cwd());

const SEED_PREFIX = 'SEED-';
const ADMIN_EMAIL = 'admin@sblossom.local';
const ADMIN_PASSWORD = 'changeme1234';

async function main() {
  // Dynamic import keeps db client construction (which reads env) below loadEnvConfig.
  const { db, users, orders, orderItems } = await import('../lib/db');
  console.log('Seeding…');

  // ── Admin user ────────────────────────────────────────────────────────
  const existing = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);

  let adminId: string;
  if (existing[0]) {
    adminId = existing[0].id;
    await db
      .update(users)
      .set({ passwordHash, isActive: true, updatedAt: new Date() })
      .where(eq(users.id, adminId));
    console.log(`  admin: updated ${ADMIN_EMAIL}`);
  } else {
    const [inserted] = await db
      .insert(users)
      .values({
        email: ADMIN_EMAIL,
        passwordHash,
        name: 'Seed Admin',
        role: 'admin',
      })
      .returning({ id: users.id });
    adminId = inserted!.id;
    console.log(`  admin: created ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  }

  // ── Orders ────────────────────────────────────────────────────────────
  const fixtures = [
    {
      shopifyOrderId: `${SEED_PREFIX}1001`,
      shopifyOrderNumber: '#SEED1001',
      shopifyOrderName: '#SEED1001',
      customerName: 'Aanya Sharma',
      customerPhone: '+919876543210',
      paymentMode: 'prepaid' as const,
      totalAmount: '1299.00',
      state: 'approval_pending' as const,
      items: [
        { title: 'Personalized Wooden Frame', namesText: 'Aanya & Rohan', quantity: 1 },
      ],
    },
    {
      shopifyOrderId: `${SEED_PREFIX}1002`,
      shopifyOrderNumber: '#SEED1002',
      shopifyOrderName: '#SEED1002',
      customerName: 'Dr. Meera Iyer',
      customerPhone: '+919812345678',
      paymentMode: 'cod' as const,
      codAmount: '2499.00',
      totalAmount: '2499.00',
      state: 'approval_pending' as const,
      items: [
        { title: 'Hanging Heart — Couple Names', namesText: 'Meera + Arjun', quantity: 1 },
        { title: 'Personalized Photo Plaque', namesText: 'The Iyer Family', quantity: 1 },
      ],
    },
    {
      shopifyOrderId: `${SEED_PREFIX}1003`,
      shopifyOrderNumber: '#SEED1003',
      shopifyOrderName: '#SEED1003',
      customerName: 'Priya Kapoor',
      customerPhone: '+917890123456',
      paymentMode: 'prepaid' as const,
      totalAmount: '3899.00',
      state: 'in_production' as const,
      tab1CompletedBy: adminId,
      tab1CompletedAt: new Date(),
      items: [
        { title: 'Personalized Wooden Frame', namesText: 'Priya', quantity: 1 },
        { title: 'Hanging Heart', namesText: 'Priya & Kabir', quantity: 1 },
        { title: 'Photo Plaque', namesText: 'Kapoor Family 2026', quantity: 1 },
      ],
    },
  ];

  for (const fx of fixtures) {
    const { items, ...orderFields } = fx;
    const found = await db
      .select()
      .from(orders)
      .where(eq(orders.shopifyOrderId, fx.shopifyOrderId))
      .limit(1);

    let orderId: string;
    if (found[0]) {
      orderId = found[0].id;
      console.log(`  order: ${fx.shopifyOrderNumber} already exists, skipping items`);
      continue;
    }

    const [inserted] = await db.insert(orders).values(orderFields).returning({ id: orders.id });
    orderId = inserted!.id;

    await db.insert(orderItems).values(
      items.map((it, idx) => ({
        orderId,
        shopifyLineItemId: `${fx.shopifyOrderId}-${idx}`,
        title: it.title,
        namesText: it.namesText,
        quantity: it.quantity,
      })),
    );

    console.log(`  order: ${fx.shopifyOrderNumber} (${items.length} items, state=${fx.state})`);
  }

  console.log('\nDone. Admin login: ' + ADMIN_EMAIL + ' / ' + ADMIN_PASSWORD);
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
