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

This submitted version is consumption-only: it does not display a purchase,
checkout, plan-change, invoice-link, or billing-portal action. Users may use an
existing entitlement and credit balance. When personal digital plans or credit
packs are submitted in a later version, they will use the platform store and
will be enabled only after the matching store products and server verification
are ready. A user with an existing platform subscription can open Apple's or
Google Play's official subscription-management settings; this is not a purchase
or external checkout action. Organization and enterprise billing remains managed
outside the mobile app, and a browser return URL is never treated as proof of payment.

## User-generated content

Users can create text and select their own images. The app is rated 17+ because
story content is user directed. Illegal content, exploitation, infringement,
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
