import Link from "next/link";
import { QaliSuiteMark } from "@/components/qalisuite-logo";

export const metadata = {
  title: "Privacy Policy | QaliSuite",
  description: "QaliSuite privacy policy — how we collect, use, and protect your data",
};

function Section({ title, children }) {
  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-foreground mb-3">{title}</h2>
      <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">{children}</div>
    </div>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <nav className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border/50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link href="/"><QaliSuiteMark size="sm" /></Link>
          <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Log in
          </Link>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <div className="mb-10">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">Privacy Policy</h1>
          <p className="mt-2 text-sm text-muted-foreground">Effective Date: 24 March 2026</p>
          <p className="mt-1 text-sm text-muted-foreground">Last Updated: 24 March 2026</p>
        </div>

        <div className="text-sm text-muted-foreground leading-relaxed mb-8">
          <p>
            QaliSuite is a product of <strong className="text-foreground">Qalibrated Systems Ltd</strong>, a company registered in Kenya.
            This Privacy Policy explains how we collect, use, store, and protect your personal data when you use the QaliSuite platform.
            By using QaliSuite, you agree to the practices described in this policy.
          </p>
        </div>

        <Section title="1. Information We Collect">
          <p><strong className="text-foreground">Account Information:</strong> Name, email address, phone number, and authentication credentials when you create an account or accept a portal invite.</p>
          <p><strong className="text-foreground">Employee Data:</strong> When your employer uses QaliSuite for HR management, we process employee information including personal details (name, national ID, KRA PIN, NSSF/SHIF numbers), employment details (department, designation, hire date), compensation and payroll data, leave balances and requests, attendance records, and uploaded documents (ID copies, certificates).</p>
          <p><strong className="text-foreground">Financial Data:</strong> Invoice, expense, bill, and payment records created by your organisation in the course of business operations.</p>
          <p><strong className="text-foreground">Usage Data:</strong> IP address, browser type, device information, and interaction patterns to maintain security and improve the service.</p>
        </Section>

        <Section title="2. How We Use Your Information">
          <p>We use the information collected to:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Provide and operate the QaliSuite platform and its modules (inventory, invoicing, accounting, HR, payroll, projects)</li>
            <li>Process payroll, calculate statutory deductions (PAYE, NSSF, SHIF, AHL), and generate compliance reports</li>
            <li>Manage employee records, leave requests, attendance, and benefits</li>
            <li>Generate financial reports, tax filings, and audit trails</li>
            <li>Send transactional notifications (portal invites, password resets, payslip availability)</li>
            <li>Maintain security, prevent fraud, and enforce our terms of service</li>
          </ul>
          <p>We do <strong className="text-foreground">not</strong> sell your personal data to third parties. We do not use your data for advertising.</p>
        </Section>

        <Section title="3. Data Processing and Legal Basis">
          <p>We process your personal data under the following legal bases as defined by the Kenya Data Protection Act, 2019:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Contractual necessity:</strong> To provide the services your organisation has subscribed to</li>
            <li><strong className="text-foreground">Legal obligation:</strong> To comply with Kenyan tax, employment, and statutory reporting requirements (KRA, NSSF, SHIF, AHL)</li>
            <li><strong className="text-foreground">Legitimate interest:</strong> To maintain platform security, prevent fraud, and improve our services</li>
            <li><strong className="text-foreground">Consent:</strong> For optional communications and marketing, which you may withdraw at any time</li>
          </ul>
        </Section>

        <Section title="4. Data Sharing">
          <p>We share your data only in the following circumstances:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Your employer:</strong> Employee data is accessible to authorised users within your organisation based on their role (Admin, HR, Manager)</li>
            <li><strong className="text-foreground">Service providers:</strong> We use trusted third-party providers for hosting (Hetzner/Vercel), database (MongoDB Atlas), email delivery (Resend), file storage (Cloudinary), and authentication (Google OAuth). These providers are bound by data processing agreements</li>
            <li><strong className="text-foreground">Statutory authorities:</strong> When required by Kenyan law (e.g., KRA for PAYE/P9A reporting, NSSF, SHIF remittance data)</li>
            <li><strong className="text-foreground">Legal requirements:</strong> If compelled by court order or to protect our legal rights</li>
          </ul>
        </Section>

        <Section title="5. Data Security">
          <p>We implement appropriate technical and organisational measures to protect your data:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>All data transmitted over HTTPS with TLS encryption</li>
            <li>Passwords are hashed using bcrypt — we never store plain-text passwords</li>
            <li>Role-based access control — employees only see their own data; HR/Admin access is gated by role</li>
            <li>Multi-tenant data isolation — each company's data is scoped by company ID</li>
            <li>Database access restricted by IP whitelist</li>
            <li>Sensitive fields (bank account numbers, M-Pesa numbers) are masked in exports</li>
          </ul>
          <p>No system is 100% secure. If we discover a data breach affecting your personal data, we will notify affected users and the Office of the Data Protection Commissioner as required by the Kenya Data Protection Act.</p>
        </Section>

        <Section title="6. Data Retention">
          <p>We retain your data for as long as your organisation maintains an active QaliSuite account, plus:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Payroll and tax records:</strong> 7 years after the relevant tax year (KRA requirement)</li>
            <li><strong className="text-foreground">Employment records:</strong> 7 years after termination of employment</li>
            <li><strong className="text-foreground">Financial records:</strong> 7 years (Companies Act, 2015)</li>
            <li><strong className="text-foreground">Account data:</strong> Deleted within 90 days of account closure upon request</li>
          </ul>
        </Section>

        <Section title="7. Your Rights">
          <p>Under the Kenya Data Protection Act, 2019, you have the right to:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Access</strong> your personal data held by us</li>
            <li><strong className="text-foreground">Rectify</strong> inaccurate or incomplete data</li>
            <li><strong className="text-foreground">Delete</strong> your data (subject to legal retention requirements)</li>
            <li><strong className="text-foreground">Object</strong> to processing of your data for specific purposes</li>
            <li><strong className="text-foreground">Data portability</strong> — receive your data in a structured, machine-readable format</li>
            <li><strong className="text-foreground">Withdraw consent</strong> for optional processing at any time</li>
          </ul>
          <p>To exercise these rights, contact us at <a href="mailto:privacy@qalisuite.com" className="text-primary hover:underline">privacy@qalisuite.com</a>. We will respond within 30 days.</p>
        </Section>

        <Section title="8. Cookies">
          <p>QaliSuite uses essential cookies for authentication and session management. We do not use tracking cookies, advertising cookies, or analytics cookies. No cookie consent banner is required as we only use strictly necessary cookies.</p>
        </Section>

        <Section title="9. Children's Privacy">
          <p>QaliSuite is a business platform not directed at individuals under the age of 18. We do not knowingly collect personal data from children.</p>
        </Section>

        <Section title="10. International Data Transfers">
          <p>Your data may be processed on servers located outside Kenya (cloud infrastructure in Europe and the United States). Where data is transferred outside Kenya, we ensure appropriate safeguards are in place as required by the Kenya Data Protection Act, including contractual obligations with our service providers.</p>
        </Section>

        <Section title="11. Changes to This Policy">
          <p>We may update this Privacy Policy from time to time. Material changes will be communicated via email or an in-app notification. The "Last Updated" date at the top of this page indicates when the policy was last revised. Continued use of QaliSuite after changes constitutes acceptance of the updated policy.</p>
        </Section>

        <Section title="12. Contact Us">
          <p>If you have questions, concerns, or requests regarding this Privacy Policy or how we handle your personal data:</p>
          <div className="mt-3 rounded-lg border border-border bg-card p-4 space-y-2 text-sm">
            <p className="font-medium text-foreground">Qalibrated Systems Ltd</p>
            <p>Email: <a href="mailto:privacy@qalisuite.com" className="text-primary hover:underline">privacy@qalisuite.com</a></p>
            <p>Phone: <a href="tel:+254714999996" className="text-primary hover:underline">+254 714 999 996</a></p>
            <p>Address: Nairobi, Kenya</p>
          </div>
          <p className="mt-3">You also have the right to lodge a complaint with the <strong className="text-foreground">Office of the Data Protection Commissioner (ODPC)</strong> of Kenya if you believe your data protection rights have been violated.</p>
        </Section>

        {/* Footer */}
        <div className="mt-12 pt-6 border-t border-border text-center">
          <p className="text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} Qalibrated Systems Ltd. All rights reserved.
          </p>
        </div>
      </main>
    </div>
  );
}
