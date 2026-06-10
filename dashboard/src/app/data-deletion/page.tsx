import type { Metadata } from "next";
import Link from "next/link";

import { LegalCallout } from "@/components/legal/LegalCallout";
import { LegalList, LegalParagraph, LegalSection } from "@/components/legal/LegalSection";
import { LegalPageLayout } from "@/components/legal/LegalPageLayout";
import { createLegalMetadata, LEGAL } from "@/lib/legal";

export const metadata: Metadata = createLegalMetadata(
  "Data Deletion Instructions",
  "Learn how to request deletion of your MyMultiFlow account and associated data, including Facebook and Instagram integration data.",
  "/data-deletion",
);

export default function DataDeletionPage() {
  return (
    <LegalPageLayout
      title="Data Deletion Instructions"
      description={`This page explains how users of ${LEGAL.productName} can request deletion of their account and associated data, including information obtained through connected Facebook and Instagram accounts.`}
    >
      <LegalSection id="overview" title="Overview">
        <LegalParagraph>
          Users may request deletion of their {LEGAL.productName} account and all associated data at
          any time. We process deletion requests in accordance with applicable privacy laws and Meta
          Platform requirements for apps that access Facebook and Instagram data.
        </LegalParagraph>
      </LegalSection>

      <LegalCallout title="Facebook and Instagram users" variant="accent">
        <LegalParagraph>
          If you connected a Facebook or Instagram account to {LEGAL.productName}, you may request
          deletion of any data associated with those connected accounts through the same process
          described on this page. This includes profile identifiers, tokens, published content,
          scheduled posts, analytics, engagement data, comments, and messages stored by our
          platform in connection with your authorized integrations.
        </LegalParagraph>
        <LegalParagraph>
          Disconnecting your account in Facebook or Instagram settings does not automatically delete
          data already stored in {LEGAL.productName}. Please submit a deletion request using one of
          the methods below to ensure complete removal from our systems.
        </LegalParagraph>
      </LegalCallout>

      <LegalSection id="deletion-methods" title="How To Request Deletion">
        <LegalParagraph>
          You can request deletion of your account and associated data using either of the following
          methods:
        </LegalParagraph>
        <LegalList
          ordered
          items={[
            <>
              <strong className="text-foreground">Inside the application:</strong> Sign in to your
              {LEGAL.productName} account, navigate to account settings, and use the account deletion
              option. Follow the on-screen instructions to confirm your request.
            </>,
            <>
              <strong className="text-foreground">By email:</strong> Send a deletion request to{" "}
              <a
                href={`mailto:${LEGAL.supportEmail}?subject=Data%20Deletion%20Request`}
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                {LEGAL.supportEmail}
              </a>{" "}
              from the email address associated with your account. Include your full name, account
              email, and any connected social account usernames to help us locate your data.
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection id="what-is-deleted" title="What Data Will Be Deleted">
        <LegalParagraph>
          Upon confirmation of your deletion request, we will delete or anonymize the following
          categories of data associated with your account, where applicable:
        </LegalParagraph>
        <LegalList
          items={[
            "Account profile information (name, email, organization details, and preferences).",
            "Authentication records and session data linked to your account.",
            "Connected social account tokens, identifiers, and integration metadata.",
            "Content you created, uploaded, scheduled, or published through the platform.",
            "Analytics, engagement metrics, comments, and messages retrieved from connected accounts.",
            "Operational logs and support communications tied to your account, subject to legal retention requirements.",
          ]}
        />
        <LegalParagraph>
          Aggregated or de-identified data that cannot reasonably be linked to you may be retained
          for analytics and service improvement purposes.
        </LegalParagraph>
      </LegalSection>

      <LegalSection id="connected-social-accounts" title="Connected Social Account Data Removal">
        <LegalParagraph>
          When your deletion request is processed, we revoke and remove stored access tokens and
          delete data obtained from connected Facebook, Instagram, and other social platforms
          associated with your account. This includes cached profile information, publishing
          history, scheduled content, and engagement data stored within {LEGAL.productName}.
        </LegalParagraph>
        <LegalParagraph>
          Content already published to third-party platforms prior to deletion may remain on those
          platforms according to their own policies. You may need to remove published content
          directly on the respective social platform if desired.
        </LegalParagraph>
      </LegalSection>

      <LegalSection id="analytics-and-content" title="Analytics and Stored Content Removal">
        <LegalParagraph>
          Historical analytics, performance reports, engagement metrics, media assets, drafts, and
          scheduled posts stored in {LEGAL.productName} will be deleted as part of the account
          deletion process. Backups containing your data will be purged according to our backup
          retention cycle, typically within 30 days of processing your request.
        </LegalParagraph>
      </LegalSection>

      <LegalSection id="deletion-timeframe" title="Expected Deletion Timeframe">
        <LegalParagraph>
          We aim to complete account and data deletion within <strong className="text-foreground">30 days</strong> of
          receiving and verifying your request. In some cases, deletion may take longer due to
          backup systems, legal obligations, or technical constraints. We will notify you if an
          extended timeframe is required.
        </LegalParagraph>
      </LegalSection>

      <LegalSection id="confirmation-process" title="Confirmation Email Process">
        <LegalParagraph>
          After you submit a deletion request, we will send a confirmation email to the address
          associated with your account. This email acknowledges receipt of your request and may
          include additional verification steps to protect your account from unauthorized deletion.
        </LegalParagraph>
        <LegalParagraph>
          Once deletion is complete, we will send a final confirmation email stating that your
          account and associated data have been removed from our active systems, subject to any
          limited retention required by law.
        </LegalParagraph>
      </LegalSection>

      <LegalSection id="related-policies" title="Related Policies">
        <LegalParagraph>
          For more information about how we collect and use data, see our{" "}
          <Link href="/privacy" className="font-medium text-foreground underline-offset-4 hover:underline">
            Privacy Policy
          </Link>{" "}
          and{" "}
          <Link href="/terms" className="font-medium text-foreground underline-offset-4 hover:underline">
            Terms of Service
          </Link>
          .
        </LegalParagraph>
      </LegalSection>

      <LegalSection id="contact-information" title="Contact Information">
        <LegalParagraph>
          If you have questions about data deletion or need assistance with your request, contact:
        </LegalParagraph>
        <LegalParagraph>
          <strong className="text-foreground">{LEGAL.productName}</strong>
          <br />
          Email:{" "}
          <a
            href={`mailto:${LEGAL.supportEmail}?subject=Data%20Deletion%20Request`}
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
