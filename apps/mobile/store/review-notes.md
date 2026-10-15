# Lyra Mobile store review notes

## Product scope

Lyra Mobile is a manga creation editor. Users organize stories, characters,
pages, panels, dialogue, and user-selected reference images in personal or
organization workspaces.

## Accounts and deletion

The app uses Amazon Cognito. To delete an account, open My Page (Account) >
Delete account. The app requires Cognito reauthentication, then shows a
preflight summary of the deletion effects, including personal data,
sole-owner organizations, active personal subscriptions, and confirmed
personal assets. A user who is the only owner of an organization must transfer
ownership first. The user must enter DELETE to start deletion.

## Billing

Personal users can purchase eligible subscriptions and credit packs through
Apple In-App Purchase on iOS and Google Play Billing on Android. The app displays
only products returned by the Lyra server for the current platform. The final
price and subscription terms are shown by the platform store before purchase.
Lyra verifies each purchase or restore with the platform on its server before
updating the account's entitlement or credit balance. Repeating receipt
verification does not grant the same purchase twice.

Existing platform subscriptions can open the official Apple or Google Play
subscription-management settings. Account deletion does not cancel a store
subscription; the deletion flow explains how to manage it before proceeding.
Organization and enterprise billing remains managed outside the mobile app.
A browser return URL is never accepted as proof of payment.

## User-generated content

Users can create story text and select their own reference images. Before an
AI generation sends entered story settings or a selected character image, the
confirmation message identifies OpenAI as the AI-processing recipient and asks
the user to continue. Generated image previews and StoryAI proposals include a
Report AI-generated content action; the user confirms before the report is
submitted. The app links to its Terms and Privacy Policy from the account
experience.

## Privacy

- Policy: https://app.lyra-editor.com/privacy.html
- Privacy choices and deletion: https://app.lyra-editor.com/account-deletion.html
- Terms: https://app.lyra-editor.com/terms.html
- Support: https://app.lyra-editor.com/support.html
- Contact: lyra.japan.official@gmail.com
