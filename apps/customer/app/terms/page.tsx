import Link from "next/link";

export const metadata = { title: "Terms of Service — CloseBuy" };

/**
 * screens-navigation.md has no entry for this yet — added 2026-09-27,
 * needed before real public launch and before Google OAuth can leave
 * "Testing" mode (CLAUDE.md's roadmap). Hosted here (the customer app)
 * since it's the one CloseBuy surface a member of the public reaches
 * without already having a staff account; the vendor and rider apps link
 * back to this same page rather than duplicating it.
 *
 * Written to describe what this specific system actually does — the
 * commission split, escrow-holding window, service area, and so on are
 * real values from apps/api/prisma/seed.ts's Config defaults, not generic
 * placeholder numbers — but they're still admin-adjustable in practice, so
 * this deliberately says "currently" rather than promising a fixed number
 * forever. **This is a first draft, not reviewed by a lawyer** — say so
 * plainly rather than implying otherwise; flagged again in CLAUDE.md.
 */
export default function TermsPage() {
  return (
    <div className="flex flex-col gap-6 p-4 pb-10 text-sm leading-relaxed text-ink">
      <div>
        <h1 className="text-xl font-bold text-ink">Terms of Service</h1>
        <p className="mt-1 text-xs text-muted">Last updated 27 September 2026</p>
      </div>

      <p>
        These Terms govern your use of CloseBuy — the customer, vendor, and rider apps, and the CloseBuy website
        and API behind them (together, the &ldquo;Service&rdquo;). CloseBuy operates as a local delivery
        marketplace serving the Riverpark neighbourhood. By creating an account, placing an order, or applying
        to sell or deliver through CloseBuy, you agree to these Terms.
      </p>

      <Section title="1. Who CloseBuy is">
        <p>
          CloseBuy is operated by an individual based in Nigeria, trading as &ldquo;CloseBuy&rdquo; — there is no
          separate registered company behind it at this time. Contact details are at the bottom of this page.
        </p>
      </Section>

      <Section title="2. Accounts">
        <p>
          You can browse CloseBuy and place an order without an account. Creating one — as a customer, vendor,
          or rider — requires a working phone number or email address, which we verify (by SMS code, email
          verification, or by signing in with Google). Each of the four roles (customer, vendor, rider, admin)
          is a separate account, even for the same person and the same phone number or email — you can hold more
          than one.
        </p>
        <p>
          You&apos;re responsible for keeping your account credentials to yourself and for everything that
          happens under your account. Admin accounts are never created through sign-up — they&apos;re set up
          directly by CloseBuy.
        </p>
      </Section>

      <Section title="3. Placing an order">
        <p>
          Orders can only be placed for delivery within, or pickup from, the Riverpark service area — an address
          outside it will be refused at checkout. Prices, stock, and availability shown at checkout are what a
          vendor has entered and can change at any time; the price you&apos;re actually charged is fixed once
          your order is placed.
        </p>
        <p>
          You can pay by card or bank transfer through our payment processor, or by cash on delivery where a
          vendor offers it. For cash orders, you pay the rider the exact amount shown at checkout on handoff.
        </p>
        <p>
          A vendor can decline your order (for example, if something&apos;s actually out of stock) — you&apos;re
          refunded in full if that happens, and they have a short window to respond before it&apos;s treated as
          declined automatically.
        </p>
      </Section>

      <Section title="4. Cancellations, refunds, and problems with an order">
        <p>
          You can cancel an order yourself, free of charge, for as long as it&apos;s still waiting on the vendor
          to accept it. Once a vendor has started preparing your order, cancelling isn&apos;t self-service any
          more — use &ldquo;Report a problem&rdquo; on your order&apos;s tracking page instead, and we&apos;ll
          look into it.
        </p>
        <p>
          Money for an order is held rather than paid out immediately, so that a genuine problem can still be put
          right — currently for up to 48 hours after delivery, unless you report a problem sooner, in which case
          it stays held until that&apos;s resolved. We may resolve a reported problem with a full refund, a
          partial refund, or by rejecting it with a reason, depending on what actually happened.
        </p>
      </Section>

      <Section title="5. If you're a vendor">
        <p>
          Selling through CloseBuy requires an application, which we review before you can go live. You&apos;re
          responsible for the accuracy of what you list — description, price, and stock — and for having orders
          genuinely ready within the window you&apos;re given to accept them.
        </p>
        <p>
          CloseBuy takes a commission on what you sell — currently 5% on pickup orders and 10% on delivery
          orders, calculated on the goods total, not including the delivery fee — and this can change; you&apos;ll
          be able to see the current rate in the vendor app. You request payouts yourself when you want to
          withdraw your balance; we never move money to your account without you asking first. Bank details you
          provide for payouts are self-reported and used only to send you money you&apos;re owed.
        </p>
      </Section>

      <Section title="6. If you're a rider">
        <p>
          Riding for CloseBuy also requires an application and an ID document, which we review before you can go
          on duty. When you deliver a cash-on-delivery order, that cash belongs to CloseBuy until you hand it
          back — we track what you&apos;re holding, and won&apos;t offer you further cash jobs past a certain
          balance until you&apos;ve handed some back.
        </p>
        <p>
          We only ever read your location at the specific moments that matter — accepting a job, confirming
          pickup, confirming delivery — while the app is open in front of you. CloseBuy doesn&apos;t track your
          location continuously or in the background.
        </p>
      </Section>

      <Section title="7. Ratings">
        <p>
          After a delivery is complete, you can rate the vendor (and, for a delivery order, the rider) once, and
          edit that rating for 24 hours afterward. Please rate honestly — ratings are shown publicly and affect
          real people&apos;s livelihoods.
        </p>
      </Section>

      <Section title="8. Conduct we don't allow">
        <p>
          Don&apos;t use CloseBuy to defraud another user, harass a vendor or rider, submit false information on
          an application, misuse a promotion, or attempt to bypass the app to transact with a vendor or rider
          directly to avoid it. We can suspend an account that does this — a suspension always comes with a
          reason and can be reversed if it was made in error.
        </p>
      </Section>

      <Section title="9. What CloseBuy is (and isn't) responsible for">
        <p>
          CloseBuy connects customers, vendors, and riders — vendors are responsible for what they sell, and
          riders for how they carry out a delivery. We do our best to catch problems (stock running out,
          incorrect handoff codes, a failed delivery) and step in when something goes wrong, but we can&apos;t
          guarantee a vendor&apos;s food or goods are exactly as described, or that a delivery will always be on
          time.
        </p>
        <p>
          To the extent the law allows, CloseBuy isn&apos;t liable for indirect losses arising from using the
          Service. Nothing here limits liability that can&apos;t legally be limited.
        </p>
      </Section>

      <Section title="10. Changes to these Terms">
        <p>
          We may update these Terms as CloseBuy changes. If we make a material change, we&apos;ll update the date
          at the top of this page. Continuing to use CloseBuy after a change means you accept the updated Terms.
        </p>
      </Section>

      <Section title="11. Governing law">
        <p>These Terms are governed by the laws of the Federal Republic of Nigeria.</p>
      </Section>

      <Section title="12. Contact">
        <p>
          Questions about these Terms: <a className="text-primary underline" href="mailto:closebuy.ng@gmail.com">closebuy.ng@gmail.com</a>.
        </p>
      </Section>

      <p className="text-xs text-muted">
        See also our <Link href="/privacy" className="text-primary underline">Privacy Policy</Link>.
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}
