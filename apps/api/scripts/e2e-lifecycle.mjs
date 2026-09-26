// End-to-end order-to-delivery smoke test, driven through the real HTTP API (no browser). Two phases:
//
//   node apps/api/scripts/e2e-lifecycle.mjs setup
//       Creates a test vendor + rider through the real signup/apply flow. Both land `pending`, and ONLY an
//       admin can approve them (admins are never self-created) — do that on the admin app's Applications page.
//   node apps/api/scripts/e2e-lifecycle.mjs run
//       Once both are approved: guest COD checkout -> vendor accept -> ready -> rider claim -> collection
//       code -> delivery code + exact cash -> DELIVERED, with the guards (wrong codes, wrong cash, double
//       claim, idempotent replay) and the books (stock, rider cash balance, escrow held) checked at each step.
//
// Point it somewhere else with E2E_API_URL. It defaults to the live API because that's where it's needed
// (local dev can't reach the database — see CLAUDE.md), which means it WRITES REAL ROWS: two test accounts,
// two products, and one order per `run`. The vendor is closed and the rider taken off duty at the end. The
// order then sits in DELIVERED until the escrow-release timer moves it to COMPLETED (48h).
//
// Credentials for the two test accounts are generated once and kept in the OS temp dir, never in the repo.
//
// Bodyless POSTs deliberately send NO Content-Type: that is what the fixed api-client does, and the old
// client's `Content-Type: application/json` on an empty body is what made Fastify answer 400.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const API = process.env.E2E_API_URL ?? "https://closebuy-api-production.up.railway.app";
const STATE_FILE = join(tmpdir(), "closebuy-e2e-state.json");
const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
const save = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

const LAT = 8.98, LNG = 7.337; // inside the traced Riverpark polygon (same point that worked for checkout before)

let failures = 0;
const ok = (cond, msg, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${msg}${extra ? "  — " + extra : ""}`);
  if (!cond) failures++;
  return cond;
};
const head = (t) => console.log(`\n== ${t} ==`);

async function call(method, path, { token, body, headers } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
  return { status: res.status, json };
}

async function login(role) {
  const { email, password } = state[role];
  let r = await call("POST", "/auth/staff/register", { body: { email, password, role } });
  if (r.status >= 400) r = await call("POST", "/auth/staff/login", { body: { email, password, role } });
  if (r.status >= 400) throw new Error(`${role} auth failed: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.accessToken;
}

async function setup() {
  head("SETUP — create test vendor + rider through the real signup flow");
  state.vendor ??= { email: "claude-e2e-vendor@example.com", password: randomBytes(12).toString("base64url") };
  state.rider ??= { email: "claude-e2e-rider@example.com", password: randomBytes(12).toString("base64url") };
  save();

  const vt = await login("vendor");
  ok(!!vt, "vendor account registered/signed in", state.vendor.email);

  const cats = await call("GET", "/categories");
  const category = cats.json.categories.find((c) => c.name === "Food & Groceries") ?? cats.json.categories[0];
  state.categoryId = category.id;

  let me = await call("GET", "/vendors/me", { token: vt });
  if (me.status === 404) {
    const applied = await call("POST", "/vendors", {
      token: vt,
      body: {
        businessName: "E2E Test Vendor (delete me)",
        categoryId: category.id,
        description: "Automated end-to-end test account — safe to ignore/remove.",
        pickupLat: LAT, pickupLng: LNG,
        pickupLandmark: "E2E test landmark, Riverpark",
        pickupPhone: "+2348099990001",
      },
    });
    ok(applied.status === 201, "vendor application submitted (pending)", `HTTP ${applied.status}`);
    me = await call("GET", "/vendors/me", { token: vt });
  }
  state.vendor.id = me.json.vendor.id;
  ok(true, "vendor profile", `${me.json.vendor.id} status=${me.json.vendor.status}`);

  // A pending vendor may prepare its storefront (US-V-02) — so products and "open" can be set before approval.
  const products = await call("GET", "/vendors/me/products", { token: vt });
  if (products.json.products.length === 0) {
    const sample = await call("GET", "/vendors/69633a08-dd8e-4b17-a9ef-af5b834eda61/products"); // borrow a real image URL
    const image = sample.json.products.find((p) => p.images?.length)?.images[0];
    for (const [name, priceMinor] of [["E2E Test Drink", 50000], ["E2E Test Snack", 120000]]) {
      const p = await call("POST", "/vendors/me/products", {
        token: vt,
        body: { categoryId: category.id, name, priceMinor, images: [image], stock: 50 },
      });
      ok(p.status === 201, `product created: ${name}`, `HTTP ${p.status}`);
    }
  }
  const upd = await call("PATCH", "/vendors/me", { token: vt, body: { isOpen: true } });
  ok(upd.status === 200, "vendor set open", `HTTP ${upd.status}`);

  const rt = await login("rider");
  ok(!!rt, "rider account registered/signed in", state.rider.email);
  let rme = await call("GET", "/riders/me", { token: rt });
  if (rme.status === 404) {
    const applied = await call("POST", "/riders", {
      token: rt,
      body: { fullName: "E2E Test Rider", vehicleType: "motorcycle", idDocumentUrl: "https://example.com/e2e-id.jpg" },
    });
    ok(applied.status === 201, "rider application submitted (pending)", `HTTP ${applied.status}`);
    rme = await call("GET", "/riders/me", { token: rt });
  }
  state.rider.id = rme.json.rider.id;
  ok(true, "rider profile", `${rme.json.rider.id} status=${rme.json.rider.status}`);
  save();

  console.log("\n>>> NEXT: approve BOTH pending applications in the admin app (Applications page), then tell me. <<<");
}

async function run() {
  head("PRECONDITIONS");
  const vt = await login("vendor");
  const rt = await login("rider");
  const vme = (await call("GET", "/vendors/me", { token: vt })).json.vendor;
  const rme = (await call("GET", "/riders/me", { token: rt })).json.rider;
  if (!ok(vme.status === "approved", "vendor is approved", vme.status) || !ok(rme.status === "approved", "rider is approved", rme.status)) {
    console.log("\nStill waiting on approval — nothing further attempted.");
    process.exit(2);
  }

  // The previous run closed the vendor on its way out; checkout refuses a closed vendor.
  const open = await call("PATCH", "/vendors/me", { token: vt, body: { isOpen: true } });
  ok(open.status === 200, "vendor opened for the test", `HTTP ${open.status}`);

  const products = (await call("GET", `/vendors/${vme.id}/products`)).json.products;
  const drink = products.find((p) => p.name === "E2E Test Drink");
  const snack = products.find((p) => p.name === "E2E Test Snack");
  ok(!!drink && !!snack, "vendor is publicly browsable with its products", `${products.length} products`);
  const stockBefore = { drink: drink.stock, snack: snack.stock };

  const riderBefore = (await call("GET", "/riders/me/earnings", { token: rt })).json;
  const vendorBefore = (await call("GET", "/vendors/me/earnings", { token: vt })).json;

  head("RIDER goes on duty");
  const duty = await call("PATCH", "/riders/me/duty", { token: rt, body: { onDuty: true } });
  ok(duty.status === 200 && duty.json.rider.onDuty === true, "rider on duty", `HTTP ${duty.status}`);

  head("CUSTOMER places a guest cash-on-delivery order (2 drinks + 1 snack)");
  const idem = randomBytes(8).toString("hex");
  const checkoutBody = {
    vendorId: vme.id,
    items: [{ productId: drink.id, quantity: 2 }, { productId: snack.id, quantity: 1 }],
    fulfilmentType: "delivery",
    deliveryLat: LAT, deliveryLng: LNG, deliveryLandmark: "Blue gate beside the E2E test shop",
    paymentMethod: "cash_on_delivery",
    contactPhone: "+2348099990002",
  };
  const co = await call("POST", "/checkout", { headers: { "Idempotency-Key": idem }, body: checkoutBody });
  if (!ok(co.status === 201, "checkout accepted", `HTTP ${co.status} ${co.status !== 201 ? JSON.stringify(co.json) : ""}`)) process.exit(1);
  const order = co.json.order;
  const token = co.json.trackingToken;
  const expectedSubtotal = 2 * 50000 + 120000;
  ok(order.status === "PAID", "COD order goes straight to PAID", order.status);
  ok(order.subtotalMinor === expectedSubtotal, "server computed the subtotal from DB prices", `${order.subtotalMinor} (expected ${expectedSubtotal})`);
  ok(order.deliveryFeeMinor > 0 && order.totalMinor === order.subtotalMinor + order.deliveryFeeMinor - (order.discountMinor ?? 0), "total = subtotal + delivery fee", `total ${order.totalMinor}`);
  const replay = await call("POST", "/checkout", { headers: { "Idempotency-Key": idem }, body: checkoutBody });
  ok(replay.json?.order?.id === order.id, "same Idempotency-Key returns the same order, not a second one");

  const track0 = (await call("GET", `/orders/track/${token}`)).json.order;
  ok(track0.status === "PAID", "guest tracking link works without any account", track0.status);

  head("VENDOR accepts and prepares");
  let vorders = (await call("GET", "/vendors/me/orders", { token: vt })).json.orders;
  const vorder = vorders.find((o) => o.id === order.id);
  ok(!!vorder && vorder.status === "PAID", "order appears in the vendor's queue", vorder?.status);
  const notifs = (await call("GET", "/notifications", { token: vt })).json.notifications ?? [];
  ok(notifs.some((n) => n.type === "order_paid"), "vendor was notified (order_paid)");

  const acc = await call("POST", `/orders/${order.id}/accept`, { token: vt }); // bodyless, no content-type
  ok(acc.status === 200, "vendor accept (bodyless POST)", `HTTP ${acc.status}`);
  const stockAfter = (await call("GET", `/vendors/${vme.id}/products`)).json.products;
  ok(stockAfter.find((p) => p.id === drink.id).stock === stockBefore.drink - 2 && stockAfter.find((p) => p.id === snack.id).stock === stockBefore.snack - 1,
    "stock decremented atomically on accept", `drink ${stockBefore.drink}->${stockAfter.find((p) => p.id === drink.id).stock}, snack ${stockBefore.snack}->${stockAfter.find((p) => p.id === snack.id).stock}`);
  ok((await call("GET", `/orders/track/${token}`)).json.order.status === "PREPARING", "customer sees PREPARING");

  const early = await call("GET", "/riders/me/offers", { token: rt });
  ok(!early.json.offers.some((o) => o.id === order.id), "not offered to riders while still PREPARING");

  const ready = await call("POST", `/orders/${order.id}/ready`, { token: vt });
  ok(ready.status === 200, "vendor mark-ready (bodyless POST)", `HTTP ${ready.status}`);
  vorders = (await call("GET", "/vendors/me/orders", { token: vt })).json.orders;
  const readyOrder = vorders.find((o) => o.id === order.id);
  ok(readyOrder.status === "READY_FOR_PICKUP", "status READY_FOR_PICKUP", readyOrder.status);
  const collectionCode = readyOrder.collectionCode;
  ok(/^\d{6}$/.test(collectionCode ?? ""), "vendor sees a 6-digit collection code", collectionCode);
  ok(!("deliveryCode" in readyOrder), "vendor is NOT given the customer's delivery code");

  head("RIDER claims the job");
  const offers = (await call("GET", "/riders/me/offers", { token: rt })).json.offers;
  const offer = offers.find((o) => o.id === order.id);
  ok(!!offer, "job appears in the open pool", `${offers.length} open`);
  ok(!!offer && !("collectionCode" in offer) && !("deliveryCode" in offer), "offer never exposes either handoff code to the rider");
  const claim = await call("POST", `/riders/me/offers/${order.id}/accept`, { token: rt }); // bodyless
  ok(claim.status === 200, "rider accept (bodyless POST)", `HTTP ${claim.status}`);
  const claim2 = await call("POST", `/riders/me/offers/${order.id}/accept`, { token: rt });
  ok(claim2.status === 409, "a second claim of the same job is refused", `HTTP ${claim2.status}`);
  const tr1 = (await call("GET", `/orders/track/${token}`)).json.order;
  ok(tr1.status === "RIDER_ASSIGNED" && tr1.rider?.fullName === "E2E Test Rider", "customer sees the assigned rider", tr1.rider?.fullName);

  head("HANDOFF 1 — vendor -> rider (collection code)");
  const badCol = await call("POST", `/orders/${order.id}/confirm-collection`, { token: rt, body: { code: collectionCode === "000000" ? "111111" : "000000" } });
  ok(badCol.status === 400, "wrong collection code is rejected", `HTTP ${badCol.status}`);
  const goodCol = await call("POST", `/orders/${order.id}/confirm-collection`, { token: rt, body: { code: collectionCode } });
  ok(goodCol.status === 200 && goodCol.json.order.status === "IN_TRANSIT", "right code -> IN_TRANSIT", `HTTP ${goodCol.status}`);

  head("HANDOFF 2 — rider -> customer (delivery code + cash)");
  const tr2 = (await call("GET", `/orders/track/${token}`)).json.order;
  const deliveryCode = tr2.deliveryCode;
  ok(/^\d{6}$/.test(deliveryCode ?? ""), "customer's tracking page shows the delivery code", deliveryCode);
  const badDel = await call("POST", `/orders/${order.id}/confirm-delivery`, { token: rt, body: { code: deliveryCode === "000000" ? "111111" : "000000", cashCollectedMinor: order.totalMinor } });
  ok(badDel.status === 400, "wrong delivery code is rejected", `HTTP ${badDel.status}`);
  const badCash = await call("POST", `/orders/${order.id}/confirm-delivery`, { token: rt, body: { code: deliveryCode, cashCollectedMinor: order.totalMinor - 100 } });
  ok(badCash.status === 400 && badCash.json?.error?.code === "CASH_MISMATCH", "cash that doesn't match the total is rejected", `HTTP ${badCash.status}`);
  const still = (await call("GET", `/orders/track/${token}`)).json.order;
  ok(still.status === "IN_TRANSIT", "failed attempts left the order untouched", still.status);
  const goodDel = await call("POST", `/orders/${order.id}/confirm-delivery`, { token: rt, body: { code: deliveryCode, recipientName: "E2E Customer", cashCollectedMinor: order.totalMinor } });
  ok(goodDel.status === 200 && goodDel.json.order.status === "DELIVERED", "right code + exact cash -> DELIVERED", `HTTP ${goodDel.status}`);

  head("BOOKS — money and state after delivery");
  const final = (await call("GET", `/orders/track/${token}`)).json.order;
  ok(final.status === "DELIVERED", "customer sees DELIVERED", final.status);
  const stepStatuses = final.transitions.map((t) => t.toStatus);
  console.log("  transition history:", stepStatuses.join(" -> "));
  ok(JSON.stringify(stepStatuses) === JSON.stringify(["PENDING_PAYMENT", "PAID", "PREPARING", "READY_FOR_PICKUP", "RIDER_ASSIGNED", "IN_TRANSIT", "DELIVERED"]), "append-only transition history is complete and in order");
  ok(final.transitions.map((t) => t.actorType).join() === "customer,system,vendor,vendor,rider,rider,rider", "each step is attributed to the right actor", final.transitions.map((t) => t.actorType).join(","));
  const riderAfter = (await call("GET", "/riders/me/earnings", { token: rt })).json;
  ok(riderAfter.cashBalanceMinor - riderBefore.cashBalanceMinor === order.totalMinor, "rider now owes the platform the cash collected", `+${riderAfter.cashBalanceMinor - riderBefore.cashBalanceMinor} (total ${order.totalMinor})`);
  ok(riderAfter.pendingMinor - riderBefore.pendingMinor === order.deliveryFeeMinor, "rider's delivery fee is pending (clears at COMPLETED)", `+${riderAfter.pendingMinor - riderBefore.pendingMinor}`);
  const vendorAfter = (await call("GET", "/vendors/me/earnings", { token: vt })).json;
  console.log("  vendor earnings before/after:", JSON.stringify({ pendingMinor: vendorBefore.pendingMinor, clearedMinor: vendorBefore.clearedMinor }), "->", JSON.stringify({ pendingMinor: vendorAfter.pendingMinor, clearedMinor: vendorAfter.clearedMinor }));
  ok(vendorAfter.clearedMinor === vendorBefore.clearedMinor, "vendor is NOT paid yet — escrow is held until the release window passes");

  state.lastOrder = { id: order.id, token, totalMinor: order.totalMinor };
  save();

  head("TIDY — close the test vendor so it doesn't look like a live store");
  await call("PATCH", "/vendors/me", { token: vt, body: { isOpen: false } });
  await call("PATCH", "/riders/me/duty", { token: rt, body: { onDuty: false } });
  console.log("  vendor closed, rider off duty");
}

const phase = process.argv[2];
try {
  if (phase === "setup") await setup();
  else if (phase === "run") await run();
  else { console.log("usage: node apps/api/scripts/e2e-lifecycle.mjs setup|run"); process.exit(1); }
} catch (e) {
  console.error("\nABORTED:", e.message);
  process.exit(1);
}
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
