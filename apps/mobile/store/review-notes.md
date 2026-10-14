# Lyra Mobile store review notes

## Product scope

Lyra Mobile is a manga creation editor. Users organize stories, characters,
pages, panels, dialogue, and user-selected reference images. AI operations are
always user initiated. Generated results can be reviewed and edited before
confirmation.

## Accounts and deletion

The app uses Amazon Cognito. Account deletion starts in Account > Delete
account. The preflight screen shows personal data, sole-owner organizations,
active personal subscriptions, and confirmed personal assets. A user who is
the only owner of an organization must transfer ownership first.

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

Users can create text and select their own images. Story content is user
directed; the age-rating answers must reflect the submitted app and current
store questionnaire. Illegal content, exploitation, infringement,
and security abuse are prohibited by the terms. AI operations show the data
recipient and request consent before sending story settings or images to
OpenAI. StoryAI proposals and generated-image previews include an in-app
"Report AI-generated content" action. The authenticated Lyra API records a
receipt containing only a fixed category, reason, opaque account ID, and opaque
content record ID; no story text, prompt, image, token, or email is attached.
Organization members can also report inappropriate workspace content or a member
from Organization management. Those reports require active membership and contain
only the organization ID, reporter's opaque account ID, a fixed target category,
and a receipt ID. An authorized safety operator uses the reporter account to follow
up and identify the exact target without putting content into the initial report.
The app requires affirmative acceptance of the current Terms and
Privacy Policy before any authenticated editing or upload feature is available.

## Privacy

- Policy: https://app.lyra-editor.com/privacy.html
- Privacy choices and deletion: https://app.lyra-editor.com/account-deletion.html
- Terms: https://app.lyra-editor.com/terms.html
- Support: https://app.lyra-editor.com/support.html
- Contact: lyra.japan.official@gmail.com

Do not place reviewer credentials in this file. Add them only through the
store's protected review-credential fields.
