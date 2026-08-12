import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';
import { productBrand } from '@/lib/brand';
import styles from '@/components/legal-page.module.css';

export const metadata: Metadata = {
  title: `Privacy Policy | ${productBrand.name}`,
  description: `How ${productBrand.name} collects, uses, protects, and shares information for its AI cofounder workspace.`,
};

const toc = [
  { href: '#scope', label: 'Scope' },
  { href: '#collect', label: 'Information We Collect' },
  { href: '#use', label: 'How We Use Information' },
  { href: '#ai', label: 'AI Processing' },
  { href: '#sharing', label: 'Sharing' },
  { href: '#integrations', label: 'Connected Services' },
  { href: '#cookies', label: 'Cookies' },
  { href: '#retention', label: 'Retention' },
  { href: '#security', label: 'Security' },
  { href: '#rights', label: 'Privacy Rights' },
  { href: '#children', label: 'Children' },
  { href: '#contact', label: 'Contact' },
] as const;

export default function PrivacyPolicyPage() {
  return (
    <LegalPage
      description={`${productBrand.name} is built as a private decision workspace. This Privacy Policy explains what data we collect, how we use it to provide AI cofounder features, how third-party AI and infrastructure providers fit in, and what choices users have.`}
      documentTitle={`${productBrand.name} Privacy Policy`}
      eyebrow="Legal"
      lastUpdated="August 12, 2026"
      relatedHref="/terms"
      relatedLabel="Terms"
      title="Privacy Policy"
      toc={toc}
    >
      <section id="scope">
        <h2>1. Scope</h2>
        <p>
          This Privacy Policy describes how {productBrand.name} (&quot;{productBrand.name},&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) collects, uses, discloses, and protects information when you access or use our websites, applications, AI agents, integrations, billing features, support channels, and related services (collectively, the &quot;Services&quot;).
        </p>
        <p>
          {productBrand.name} provides an AI cofounder and decision assistant workspace. The Services may help you research markets, analyze competitors, prepare outreach, review connected work context, generate plans or artifacts, and maintain a private decision history.
        </p>
        <p>
          If you use {productBrand.name} on behalf of an organization, this Policy applies to both you and that organization. Your organization may have additional internal policies governing your use of {productBrand.name}.
        </p>
      </section>

      <section id="collect">
        <h2>2. Information We Collect</h2>
        <h3>Information you provide</h3>
        <ul>
          <li><strong>Account information:</strong> name, email address, login credentials or authentication identifiers, profile details, role, preferences, and support communications.</li>
          <li><strong>Workspace content:</strong> prompts, messages, files, links, notes, uploaded materials, decisions, feedback, instructions, generated outputs, and other content you submit to or create with {productBrand.name}.</li>
          <li><strong>Billing information:</strong> plan selection, credits, usage records, invoices, subscription status, transaction metadata, and refund requests. We do not store full payment card numbers; payment information is processed by third-party payment processors such as Stripe.</li>
          <li><strong>Communications:</strong> messages you send us for support, product feedback, waitlist requests, sales inquiries, or other communications.</li>
        </ul>

        <h3>Information collected automatically</h3>
        <ul>
          <li><strong>Usage data:</strong> pages viewed, features used, actions taken, session timestamps, agent runs, credit usage, performance events, and diagnostics.</li>
          <li><strong>Device and technical data:</strong> IP address, browser type, operating system, device identifiers, approximate location inferred from IP address, referral URLs, cookies, and similar technologies.</li>
          <li><strong>Security data:</strong> login events, authentication attempts, rate limits, abuse signals, and audit logs.</li>
        </ul>

        <h3>Information from connected services</h3>
        <p>
          If you connect third-party services such as Google Workspace, Gmail, Slack, Notion, Feishu/Lark, or other tools, we may collect the data you authorize {productBrand.name} to access. This may include messages, documents, metadata, calendar details, contact information, file names, file content, or other workspace data, depending on the permissions you grant and the feature you use.
        </p>
        <p>
          You control whether to connect or disconnect these services. We use connected-service data only to provide the features you request, maintain your workspace context, support security, and comply with applicable law.
        </p>
      </section>

      <section id="use">
        <h2>3. How We Use Information</h2>
        <ul>
          <li>Provide, operate, maintain, and improve the Services.</li>
          <li>Authenticate users, secure accounts, prevent fraud, and enforce usage limits.</li>
          <li>Generate AI responses, decision briefs, research plans, summaries, recommendations, and other outputs requested by you.</li>
          <li>Maintain workspace context, conversation history, preferences, and memory features when enabled or required to provide the Services.</li>
          <li>Process credits, subscriptions, billing, invoices, refunds, and customer support requests.</li>
          <li>Analyze performance, debug issues, measure product usage, and improve reliability and user experience.</li>
          <li>Communicate with you about service updates, security notices, support requests, billing, and administrative matters.</li>
          <li>Comply with legal obligations and protect the rights, safety, and integrity of {productBrand.name}, users, and the public.</li>
        </ul>
        <div className={styles.callout}>
          We do not claim ownership of your workspace content. Your inputs and outputs are yours, subject to applicable law and third-party rights.
        </div>
      </section>

      <section id="ai">
        <h2>4. AI Processing and Model Providers</h2>
        <p>
          {productBrand.name} uses AI technologies to provide its core features. Depending on the feature, your prompts, files, connected-service content, metadata, and generated outputs may be transmitted to third-party AI model providers or infrastructure providers for processing.
        </p>
        <p>
          These providers may include OpenAI, Anthropic, Google, OpenRouter, cloud hosting providers, vector database providers, observability providers, and other vendors that help us deliver the Services. We may update our providers as the Services evolve.
        </p>
        <ul>
          <li>We send only the information reasonably necessary to provide the requested feature, debug the Services, secure the platform, or comply with law.</li>
          <li>We do not sell your workspace content.</li>
          <li>We do not use Google Workspace API data to develop, improve, or train generalized AI or machine learning models.</li>
          <li>We do not use your private workspace content to train public AI models unless you explicitly opt in or the data has been aggregated or de-identified so it cannot reasonably identify you or your organization.</li>
        </ul>
        <p>
          AI outputs can be inaccurate, incomplete, offensive, or unsuitable for your situation. You are responsible for reviewing outputs before relying on them or sharing them externally.
        </p>
      </section>

      <section id="sharing">
        <h2>5. How We Share Information</h2>
        <p>We may share information in the following circumstances:</p>
        <ul>
          <li><strong>Service providers:</strong> vendors that host infrastructure, process payments, provide authentication, deliver email, run analytics, support AI processing, monitor security, or provide customer support.</li>
          <li><strong>Connected services:</strong> third-party services you choose to connect, only as needed to provide the connected feature or complete your requested action.</li>
          <li><strong>Team or organization accounts:</strong> if you join a team workspace, owners or administrators may access certain workspace activity, user management details, billing data, usage data, and content according to the team settings and plan.</li>
          <li><strong>Legal and safety:</strong> when required by law, legal process, or good-faith belief that disclosure is necessary to protect rights, safety, security, or prevent fraud or abuse.</li>
          <li><strong>Business transfers:</strong> in connection with a merger, financing, acquisition, reorganization, bankruptcy, or sale of assets.</li>
          <li><strong>With your consent:</strong> when you authorize us to share information or direct us to make content public.</li>
        </ul>
        <p>
          Your private tasks, projects, files, playbooks, generated artifacts, and decision history are private by default. They become visible to others only if you share them, publish them, invite collaborators, connect a team workspace, or otherwise authorize disclosure.
        </p>
      </section>

      <section id="integrations">
        <h2>6. Connected Services and Third-Party Links</h2>
        <p>
          {productBrand.name} may allow you to connect external accounts or open third-party websites. Third-party services operate under their own terms and privacy policies. We are not responsible for their privacy practices.
        </p>
        <p>
          You may revoke {productBrand.name}&apos;s access to a connected service through {productBrand.name} settings or through the third-party provider&apos;s account permissions page. Some historical data may remain in backups or logs for a limited period as described in this Policy.
        </p>
      </section>

      <section id="cookies">
        <h2>7. Cookies and Analytics</h2>
        <p>
          We use cookies and similar technologies to authenticate users, remember preferences, secure sessions, understand how the Services are used, and improve performance. You can control cookies through your browser settings, though blocking some cookies may prevent parts of the Services from functioning.
        </p>
        <p>
          We may use analytics and monitoring tools to understand product usage, diagnose errors, and improve reliability. Where feasible, we limit analytics data to product and technical signals rather than the substance of your private workspace content.
        </p>
        <p>
          We may also use privacy-masked session replay and interaction analytics to understand navigation, clicks, scrolling, and product usability. We configure these tools to mask form inputs and private discussion content, and we do not intentionally record passwords, payment card details, private prompts, message text, attachment names, or generated responses in session replay.
        </p>
      </section>

      <section id="retention">
        <h2>8. Data Retention</h2>
        <p>
          We retain personal information for as long as needed to provide the Services, maintain your account, comply with legal obligations, resolve disputes, enforce agreements, prevent fraud, and support legitimate business purposes.
        </p>
        <p>
          Workspace content is retained while your account or workspace is active unless you delete it or configure a shorter retention period. If you delete your account, we will delete or de-identify account data within a reasonable period, subject to backups, legal requirements, security logs, billing records, and other legitimate retention needs.
        </p>
      </section>

      <section id="security">
        <h2>9. Security</h2>
        <p>
          We use administrative, technical, and organizational safeguards designed to protect information. These may include access controls, encryption in transit, logging, authentication controls, and vendor security review. No method of transmission or storage is completely secure, and we cannot guarantee absolute security.
        </p>
      </section>

      <section id="rights">
        <h2>10. Your Privacy Choices and Rights</h2>
        <p>
          Depending on where you live, you may have rights to access, correct, delete, export, or restrict certain uses of your personal information. You may also have the right to object to certain processing or withdraw consent where processing is based on consent.
        </p>
        <ul>
          <li>You can update some account information in your profile settings.</li>
          <li>You can disconnect integrations through {productBrand.name} or the relevant provider.</li>
          <li>You can request deletion or export of personal information by contacting us.</li>
          <li>You can unsubscribe from non-essential marketing communications using the instructions in those messages.</li>
        </ul>
        <p>
          We may ask you to verify your identity before completing a request. We may deny or limit requests where permitted by law.
        </p>
      </section>

      <section id="international">
        <h2>11. International Transfers</h2>
        <p>
          {productBrand.name} and our service providers may process information in countries other than where you live. These countries may have data protection laws different from those in your jurisdiction. Where required, we use appropriate safeguards for international transfers.
        </p>
      </section>

      <section id="children">
        <h2>12. Children&apos;s Privacy</h2>
        <p>
          The Services are not intended for children under 18. We do not knowingly collect personal information from anyone under 18. If you believe a child has provided personal information to us, please contact us and we will take appropriate steps.
        </p>
      </section>

      <section id="changes">
        <h2>13. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. If we make material changes, we will update the &quot;Last updated&quot; date and may provide additional notice through the Services or by email. Your continued use of the Services after the updated Policy becomes effective means you acknowledge the updated Policy.
        </p>
      </section>

      <section id="contact">
        <h2>14. Contact</h2>
        <p>
          If you have questions or requests about this Privacy Policy, contact us at <a href={`mailto:${productBrand.supportEmail}`}>{productBrand.supportEmail}</a>.
        </p>
      </section>
    </LegalPage>
  );
}
