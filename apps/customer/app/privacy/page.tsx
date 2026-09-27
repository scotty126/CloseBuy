import Link from "next/link";

export const metadata = { title: "Privacy Policy — CloseBuy" };

/**
 * Companion to /terms — see that file's doc comment for the general
 * reasoning (why it lives here, why it's a first draft). This one is
 * grounded specifically in schema.prisma's real fields and .env.example's
 * real third-party integrations, not a generic template: every processor
 * named below is actually wired into the code (grepped, not assumed), and
 * nothing here promises a right the product doesn't actually implement —
 * there's no self-service account deletion built, for instance, so this
 * says "email us" rather than pointing at a button that doesn't exist.
 */
export default function PrivacyPage() {
  return (
    <div className="flex flex-col gap-6 p-4 pb-10 text-sm leading-relaxed text-ink">
      <div>
        <h1 className="text-xl font-bold text-ink">Privacy Policy</h1>
        <p className="mt-1 text-xs text-muted">Last updated 27 September 2026</p>
      </div>

      <p>
        This Privacy Policy explains what personal information CloseBuy collects across its customer, vendor,
        rider, and admin apps, why, and what your rights over it are. It&apos;s written under the Nigeria Data
        Protection Act 2023.
      </p>

      <Section title="1. What we collect">
        <p>Depending on which of CloseBuy you use:</p>
        <ul className="list-disc pl-5">
          <li><strong>Everyone:</strong> a phone number and/or email address, used to sign you in.</li>
          <li><strong>If you sign in with Google:</strong> the name, email, and profile info Google shares with us for that.</li>
          <li><strong>Customers:</strong> a delivery pin (map coordinates) and landmark description for each order, a contact phone number, and order/payment history.</li>
          <li><strong>Vendors:</strong> your business name, pickup location, description, bank account details (for paying you), and product listings.</li>
          <li><strong>Riders:</strong> your full name, vehicle type, a government ID document you upload for verification, and — only at the moment you accept, collect, or deliver a job — your location.</li>
          <li>
            <strong>Everyone, if something goes wrong:</strong> anything you submit as part of a dispute or a
            reported problem, including photos or other evidence you choose to attach.
          </li>
          <li>
            If you enable push notifications, a notification token tied to your device/browser — not your
            location or identity beyond that.
          </li>
        </ul>
      </Section>

      <Section title="2. Why we use it">
        <p>
          Mainly to run the marketplace itself: matching your order to a vendor and a rider, getting it to you,
          processing payment, and letting vendors and riders get paid. We also use it to prevent fraud, resolve
          disputes fairly, keep financial records we&apos;re legally required to keep, and — only where you&apos;ve
          asked for it — to send you notifications about your orders.
        </p>
      </Section>

      <Section title="3. Location, specifically">
        <p>
          CloseBuy doesn&apos;t track anyone&apos;s location continuously or in the background. A customer&apos;s
          delivery pin is set once, at checkout. A rider&apos;s location is only read at the specific moments
          that matter to a delivery in progress — accepting a job, confirming pickup, confirming delivery — and
          only while the rider app is open. There is no live map showing where a rider currently is.
        </p>
      </Section>

      <Section title="4. Who we share it with">
        <p>We don&apos;t sell your information. We share it with the following, only as needed to run the Service:</p>
        <ul className="list-disc pl-5">
          <li><strong>Termii</strong> — sends the SMS codes used to verify a staff phone number.</li>
          <li><strong>Monnify</strong> — processes card and bank transfer payments, and sends vendor payouts.</li>
          <li><strong>Google</strong> — if you choose to sign in with Google.</li>
          <li><strong>OpenStreetMap (Nominatim)</strong> — looks up a street or area name you type at checkout into a map location; only the text you search for is sent, and only inside the Riverpark area.</li>
          <li>
            <strong>Our hosting providers</strong> — Neon (database), Railway (API server and caching), and
            Netlify (the apps themselves) store and process data on our behalf, under their own security
            commitments, and don&apos;t use it for their own purposes. Some of this infrastructure may be located
            outside Nigeria.
          </li>
          <li>A vendor sees a customer&apos;s delivery pin, landmark, and contact number for orders placed with them — nothing more.</li>
          <li>A rider sees a customer&apos;s and vendor&apos;s pickup/delivery details only for a job they&apos;ve accepted.</li>
        </ul>
      </Section>

      <Section title="5. How long we keep it">
        <p>
          Account information is kept for as long as your account is active. Order, payment, and ledger records
          are kept for longer, for accounting and legal reasons — CloseBuy&apos;s financial ledger is
          append-only by design, meaning past transactions are never edited or deleted, only corrected with a
          new offsetting entry if something needs fixing, the same way a bank statement works.
        </p>
      </Section>

      <Section title="6. Cookies and local storage">
        <p>
          CloseBuy doesn&apos;t use tracking or advertising cookies. Your session and, for the customer app,
          your cart are stored in your browser&apos;s local storage on your own device — this data never leaves
          your device on its own and isn&apos;t visible to us unless it&apos;s sent as part of a normal request
          you make (like viewing your orders).
        </p>
      </Section>

      <Section title="7. Your rights">
        <p>
          You can ask us to access, correct, or delete the personal information we hold about you by emailing{" "}
          <a className="text-primary underline" href="mailto:closebuy.ng@gmail.com">closebuy.ng@gmail.com</a>{" "}
          — there&apos;s no self-service option for this yet, so we handle these requests by hand. We may need
          to keep some information regardless (financial records we&apos;re legally required to retain, or
          information needed to resolve an open dispute) — we&apos;ll tell you if that applies to your request.
        </p>
      </Section>

      <Section title="8. Children">
        <p>CloseBuy accounts (customer, vendor, rider) are intended for people 18 or older.</p>
      </Section>

      <Section title="9. Security">
        <p>
          We use industry-standard measures to protect your information — encrypted connections, hashed
          passwords, and access controls limiting who can see what. No system is perfectly secure, and we
          can&apos;t guarantee absolute security.
        </p>
      </Section>

      <Section title="10. Changes to this policy">
        <p>
          If we make a material change to this policy, we&apos;ll update the date at the top of this page.
        </p>
      </Section>

      <Section title="11. Contact">
        <p>
          Questions about this policy, or to exercise your rights:{" "}
          <a className="text-primary underline" href="mailto:closebuy.ng@gmail.com">closebuy.ng@gmail.com</a>.
        </p>
      </Section>

      <p className="text-xs text-muted">
        See also our <Link href="/terms" className="text-primary underline">Terms of Service</Link>.
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
