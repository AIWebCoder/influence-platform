import type { Metadata } from "next";
import Link from "next/link";

import { LegalList, LegalParagraph, LegalSection } from "@/components/legal/LegalSection";
import { LegalPageLayout } from "@/components/legal/LegalPageLayout";
import { createLegalMetadata, LEGAL } from "@/lib/legal";

export const metadata: Metadata = createLegalMetadata(
  "Terms of Service",
  "Read the Terms of Service governing your use of the MyMultiFlow social media management platform.",
  "/terms",
);

export default function TermsOfServicePage() {
  return (
    <LegalPageLayout
      title="Terms of Service"
      description={`These Terms of Service ("Terms") govern your access to and use of ${LEGAL.productName}, a social media management platform operated at ${LEGAL.website}. By using our services, you agree to these Terms.`}
    >
      <LegalSection id="acceptance-of-terms" title="Acceptance of Terms">
        <LegalParagraph>
          By creating an account, accessing, or using {LEGAL.productName}, you agree to be bound by
          these Terms and our{" "}
          <Link href="/privacy" className="font-medium text-foreground underline-offset-4 hover:underline">
            Privacy Policy
          </Link>
          . If you do not agree, you may not use the platform.
        </LegalParagraph>
        <LegalParagraph>
          If you are using the platform on behalf of an organization, you represent that you have
          authority to bind that organization to these Terms.
        </LegalParagraph>
      </LegalSection>

      <LegalSection id="service-description" title="Service Description">
        <LegalParagraph>
          {LEGAL.productName} is a social media management platform that enables users to connect
          social media accounts, publish and schedule content, retrieve analytics and engagement
          metrics, manage comments and messages, and administer connected accounts.
        </LegalParagraph>
        <LegalParagraph>
          Features may vary based on your subscription plan, connected platforms, and API
          availability. We may add, modify, or discontinue features at our discretion.
        </LegalParagraph>
      </LegalSection>

      <LegalSection id="user-accounts" title="User Accounts">
        <LegalParagraph>
          You are responsible for maintaining the confidentiality of your account credentials and for
          all activity that occurs under your account. You must provide accurate registration
          information and keep it up to date.
        </LegalParagraph>
        <LegalParagraph>
          You must notify us promptly at{" "}
          <a
            href={`mailto:${LEGAL.supportEmail}`}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            {LEGAL.supportEmail}
          </a>{" "}
          if you suspect unauthorized access to your account.
        </LegalParagraph>
      </LegalSection>

      <LegalSection id="connected-social-accounts" title="Connected Social Accounts">
        <LegalParagraph>
          To use certain features, you must connect third-party social media accounts such as
          Instagram or Facebook. By connecting an account, you authorize {LEGAL.productName} to
          access and process data from that platform as permitted by you and required to deliver
          requested functionality.
        </LegalParagraph>
        <LegalParagraph>
          You are responsible for ensuring you have the rights and permissions necessary to connect
          and manage each social account through our platform, including compliance with the terms
          and policies of the respective social platforms.
        </LegalParagraph>
      </LegalSection>

      <LegalSection id="user-responsibilities" title="User Responsibilities">
        <LegalParagraph>You agree to:</LegalParagraph>
        <LegalList
          items={[
            "Use the platform only for lawful purposes and in compliance with applicable laws and regulations.",
            "Comply with the terms, policies, and community guidelines of connected social platforms.",
            "Ensure that content you publish or schedule does not infringe third-party rights or violate platform rules.",
            "Maintain appropriate permissions for any accounts, pages, or assets you manage through the platform.",
            "Use reasonable efforts to keep your account and connected integrations secure.",
          ]}
        />
      </LegalSection>

      <LegalSection id="prohibited-uses" title="Prohibited Uses">
        <LegalParagraph>You may not use {LEGAL.productName} to:</LegalParagraph>
        <LegalList
          items={[
            "Violate any applicable law, regulation, or third-party rights.",
            "Publish spam, misleading content, malware, or harmful material.",
            "Attempt to gain unauthorized access to systems, accounts, or data.",
            "Reverse engineer, scrape, or abuse platform APIs beyond permitted use.",
            "Interfere with or disrupt the integrity or performance of the service.",
            "Use the platform for harassment, hate speech, or illegal activity.",
            "Resell or sublicense the service without our written consent.",
          ]}
        />
        <LegalParagraph>
          We reserve the right to suspend or terminate access for violations of these Terms or
          connected platform policies.
        </LegalParagraph>
      </LegalSection>

      <LegalSection id="content-ownership" title="Content Ownership">
        <LegalParagraph>
          You retain ownership of content you create, upload, or authorize for publication through
          {LEGAL.productName}. By using the platform, you grant us a limited license to host,
          process, transmit, and display your content solely as necessary to provide the services
          you request.
        </LegalParagraph>
        <LegalParagraph>
          We do not claim ownership of your social media content or connected account data beyond
          what is required to operate the platform.
        </LegalParagraph>
      </LegalSection>

      <LegalSection id="api-usage" title="API Usage">
        <LegalParagraph>
          {LEGAL.productName} interacts with third-party APIs, including Meta Platform APIs for
          Facebook and Instagram. Your use of these integrations is subject to the applicable API
          terms, rate limits, permissions, and policies of each platform.
        </LegalParagraph>
        <LegalParagraph>
          We are not responsible for changes, outages, or restrictions imposed by third-party
          platforms that may affect service availability or functionality.
        </LegalParagraph>
      </LegalSection>

      <LegalSection id="service-availability" title="Service Availability">
        <LegalParagraph>
          We strive to provide reliable service but do not guarantee uninterrupted or error-free
          operation. The platform may be temporarily unavailable due to maintenance, updates,
          infrastructure issues, or factors outside our control, including third-party API
          disruptions.
        </LegalParagraph>
        <LegalParagraph>
          Scheduled maintenance will be communicated when practicable. We may modify or discontinue
          any part of the service with reasonable notice where possible.
        </LegalParagraph>
      </LegalSection>

      <LegalSection id="limitation-of-liability" title="Limitation of Liability">
        <LegalParagraph>
          To the maximum extent permitted by law, {LEGAL.productName} and its operators shall not be
          liable for any indirect, incidental, special, consequential, or punitive damages, or any
          loss of profits, revenue, data, or goodwill arising from your use of the platform.
        </LegalParagraph>
        <LegalParagraph>
          Our total liability for any claim arising out of or relating to these Terms or the service
          shall not exceed the amount you paid us for the service in the twelve (12) months
          preceding the event giving rise to the claim, or one hundred U.S. dollars (USD $100) if no
          fees were paid.
        </LegalParagraph>
        <LegalParagraph>
          Some jurisdictions do not allow certain limitations of liability, so some of the above
          limitations may not apply to you.
        </LegalParagraph>
      </LegalSection>

      <LegalSection id="termination" title="Termination">
        <LegalParagraph>
          You may stop using the platform and request account deletion at any time. We may suspend
          or terminate your access if you violate these Terms, pose a security risk, or if required
          by law or platform policy.
        </LegalParagraph>
        <LegalParagraph>
          Upon termination, your right to use the platform ceases. Provisions that by their nature
          should survive termination will remain in effect. Data deletion is handled according to
          our{" "}
          <Link href="/data-deletion" className="font-medium text-foreground underline-offset-4 hover:underline">
            Data Deletion Instructions
          </Link>
          .
        </LegalParagraph>
      </LegalSection>

      <LegalSection id="changes-to-service" title="Changes To Service">
        <LegalParagraph>
          We may update these Terms from time to time. When we make material changes, we will update
          the &quot;Last updated&quot; date and provide notice as appropriate. Continued use of the
          platform after changes take effect constitutes acceptance of the revised Terms.
        </LegalParagraph>
      </LegalSection>

      <LegalSection id="governing-law" title="Governing Law">
        <LegalParagraph>
          These Terms are governed by and construed in accordance with applicable laws, without
          regard to conflict of law principles. Any disputes arising from these Terms or your use of
          the platform shall be resolved in the courts of competent jurisdiction, unless otherwise
          required by mandatory local law.
        </LegalParagraph>
      </LegalSection>

      <LegalSection id="contact-information" title="Contact Information">
        <LegalParagraph>
          For questions about these Terms, contact us at:
        </LegalParagraph>
        <LegalParagraph>
          <strong className="text-foreground">{LEGAL.productName}</strong>
          <br />
          Email:{" "}
          <a
            href={`mailto:${LEGAL.supportEmail}`}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            {LEGAL.supportEmail}
          </a>
          <br />
          Website:{" "}
          <a
            href={LEGAL.website}
            className="font-medium text-foreground underline-offset-4 hover:underline"
            rel="noopener noreferrer"
            target="_blank"
          >
            {LEGAL.website}
          </a>
        </LegalParagraph>
      </LegalSection>
    </LegalPageLayout>
  );
}
