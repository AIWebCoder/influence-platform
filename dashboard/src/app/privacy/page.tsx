import type { Metadata } from "next";
import Link from "next/link";

import { LegalCallout } from "@/components/legal/LegalCallout";
import { LegalList, LegalParagraph, LegalSection } from "@/components/legal/LegalSection";
import { LegalPageLayout } from "@/components/legal/LegalPageLayout";
import { createLegalMetadata, LEGAL } from "@/lib/legal";

export const metadata: Metadata = createLegalMetadata(
  "Privacy Policy",
  "Learn how MyMultiFlow collects, uses, stores, and protects your data when you use our social media management platform.",
  "/privacy",
);

export default function PrivacyPolicyPage() {
  return (
    <LegalPageLayout
      title="Privacy Policy"
      description={`This Privacy Policy explains how ${LEGAL.productName} ("we", "us", or "our") collects, uses, and safeguards information when you use our social media management platform at ${LEGAL.website}.`}
    >
      <LegalCallout title="Our commitment to your data" variant="accent">
        <LegalParagraph>
          We never sell your personal data. Information is used solely to provide and improve
          platform functionality. You may request deletion of your data at any time. Data obtained
          through Facebook and Instagram integrations is processed in accordance with Meta Platform
          policies and applicable data protection laws.
        </LegalParagraph>
      </LegalCallout>

      <LegalSection id="information-we-collect" title="Information We Collect">
        <LegalParagraph>
          We collect information necessary to operate {LEGAL.productName}, authenticate users,
          connect social media accounts, publish and schedule content, retrieve analytics, and
          manage engagement. The categories of information we may collect include:
        </LegalParagraph>
        <LegalList
          items={[
            "Account and profile information you provide when registering or updating your account.",
            "Connected social media account data authorized through platform integrations.",
            "Content you create, upload, schedule, or publish through the platform.",
            "Usage data related to how you interact with our services.",
            "Technical and device information such as IP address, browser type, and log data.",
            "Communications you send to us, including support requests.",
          ]}
        />
      </LegalSection>

      <LegalSection id="account-information" title="Account Information">
        <LegalParagraph>
          When you create a {LEGAL.productName} account, we collect information such as your name,
          email address, organization details, authentication credentials, role and permissions, and
          account preferences. This information is used to provide secure access, personalize your
          experience, and communicate important service-related updates.
        </LegalParagraph>
      </LegalSection>

      <LegalSection id="connected-social-accounts" title="Connected Social Media Accounts">
        <LegalParagraph>
          When you connect Instagram, Facebook, or other supported social accounts, we receive
          information authorized by you through the respective platform&apos;s OAuth or API
          permissions. This may include account identifiers, profile information, page or business
          account details, media assets, publishing permissions, analytics and engagement metrics,
          comments, messages, and other data required to deliver the features you enable.
        </LegalParagraph>
        <LegalParagraph>
          You can disconnect social accounts at any time through your account settings. Disconnecting
          an account stops future data collection from that platform, subject to our data retention
          practices described below.
        </LegalParagraph>
      </LegalSection>

      <LegalSection id="usage-data" title="Usage Data">
        <LegalParagraph>
          We automatically collect usage data when you interact with the platform, including pages
          visited, features used, actions taken, timestamps, error logs, and performance metrics.
          This helps us maintain service reliability, troubleshoot issues, improve product
          functionality, and understand how our services are used in aggregate.
        </LegalParagraph>
      </LegalSection>

      <LegalSection id="cookies-and-analytics" title="Cookies and Analytics">
        <LegalParagraph>
          We use cookies and similar technologies to keep you signed in, remember preferences,
          secure the platform, and measure product usage. Analytics tools may collect aggregated or
          pseudonymized information about how users navigate and use {LEGAL.productName}.
        </LegalParagraph>
        <LegalParagraph>
          You can control cookies through your browser settings. Disabling certain cookies may limit
          some platform functionality.
        </LegalParagraph>
      </LegalSection>

      <LegalSection id="how-we-use-information" title="How We Use Information">
        <LegalParagraph>We use collected information to:</LegalParagraph>
        <LegalList
          items={[
            "Provide, operate, and maintain the platform and its features.",
            "Authenticate users and manage access controls.",
            "Publish, schedule, and manage social media content on your behalf.",
            "Retrieve analytics, engagement metrics, comments, and messages as authorized.",
            "Improve performance, security, and user experience.",
            "Respond to support requests and communicate service updates.",
            "Comply with legal obligations and enforce our Terms of Service.",
          ]}
        />
        <LegalParagraph>
          We do not use your data for unrelated advertising purposes, and we do not sell personal
          information to third parties.
        </LegalParagraph>
      </LegalSection>

      <LegalSection id="social-media-integrations" title="Social Media Integrations">
        <LegalParagraph>
          {LEGAL.productName} integrates with third-party platforms including Meta (Facebook and
          Instagram) to deliver social media management capabilities. When you authorize a
          connection, we access only the data and permissions you approve.
        </LegalParagraph>
        <LegalParagraph>
          Facebook and Instagram data is processed according to Meta Platform policies, including
          requirements for data use, storage, security, and deletion. We use this data exclusively
          to provide the functionality you request, such as publishing content, retrieving
          analytics, and managing engagement on connected accounts.
        </LegalParagraph>
      </LegalSection>

      <LegalSection id="data-storage-and-security" title="Data Storage and Security">
        <LegalParagraph>
          We implement administrative, technical, and organizational safeguards designed to protect
          your information against unauthorized access, alteration, disclosure, or destruction.
          These measures include access controls, encryption in transit, secure infrastructure
          practices, and monitoring for suspicious activity.
        </LegalParagraph>
        <LegalParagraph>
          No method of transmission or storage is completely secure. While we work to protect your
          data, we cannot guarantee absolute security.
        </LegalParagraph>
      </LegalSection>

      <LegalSection id="data-sharing" title="Data Sharing">
        <LegalParagraph>
          We do not sell your personal information. We may share data only in limited circumstances:
        </LegalParagraph>
        <LegalList
          items={[
            "With service providers who assist in hosting, infrastructure, analytics, or customer support, subject to confidentiality obligations.",
            "With social platforms when you authorize integrations to perform requested actions.",
            "When required by law, regulation, legal process, or governmental request.",
            `To protect the rights, safety, and security of ${LEGAL.productName}, our users, or others.`,
            "In connection with a merger, acquisition, or asset sale, with appropriate notice where required.",
          ]}
        />
      </LegalSection>

      <LegalSection id="third-party-services" title="Third-Party Services">
        <LegalParagraph>
          Our platform relies on third-party services including cloud infrastructure providers,
          authentication systems, analytics tools, and social media APIs. These providers process
          data according to their own privacy policies and our agreements with them. We encourage
          you to review the privacy practices of platforms you connect to {LEGAL.productName}.
        </LegalParagraph>
      </LegalSection>

      <LegalSection id="user-rights" title="User Rights">
        <LegalParagraph>
          Depending on your location, you may have rights regarding your personal data, including
          the right to access, correct, export, restrict processing of, or delete your information.
        </LegalParagraph>
        <LegalParagraph>
          You may request deletion of your account and associated data through your account settings
          or by contacting us. For detailed instructions, see our{" "}
          <Link href="/data-deletion" className="font-medium text-foreground underline-offset-4 hover:underline">
            Data Deletion Instructions
          </Link>
          .
        </LegalParagraph>
        <LegalParagraph>
          To exercise your rights, contact{" "}
          <a
            href={`mailto:${LEGAL.supportEmail}`}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            {LEGAL.supportEmail}
          </a>
          . We will respond within a reasonable timeframe as required by applicable law.
        </LegalParagraph>
      </LegalSection>

      <LegalSection id="data-retention" title="Data Retention">
        <LegalParagraph>
          We retain personal data only for as long as necessary to provide the platform, fulfill
          the purposes described in this policy, comply with legal obligations, resolve disputes,
          and enforce agreements. When you delete your account or request data deletion, we process
          removal according to our data deletion procedures, typically within 30 days, subject to
          legal retention requirements.
        </LegalParagraph>
      </LegalSection>

      <LegalSection id="international-transfers" title="International Transfers">
        <LegalParagraph>
          Your information may be processed and stored in countries other than your own. Where
          required, we implement appropriate safeguards for cross-border data transfers in
          accordance with applicable data protection laws.
        </LegalParagraph>
      </LegalSection>

      <LegalSection id="childrens-privacy" title="Children's Privacy">
        <LegalParagraph>
          {LEGAL.productName} is not intended for individuals under the age of 13 (or the minimum
          age required in your jurisdiction). We do not knowingly collect personal information from
          children. If you believe a child has provided us with personal data, please contact us so
          we can take appropriate action.
        </LegalParagraph>
      </LegalSection>

      <LegalSection id="changes-to-policy" title="Changes To This Policy">
        <LegalParagraph>
          We may update this Privacy Policy from time to time. When we make material changes, we
          will update the &quot;Last updated&quot; date at the top of this page and, where
          appropriate, provide additional notice. Your continued use of the platform after changes
          become effective constitutes acceptance of the updated policy.
        </LegalParagraph>
      </LegalSection>

      <LegalSection id="contact-information" title="Contact Information">
        <LegalParagraph>
          If you have questions about this Privacy Policy or our data practices, contact us at:
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
