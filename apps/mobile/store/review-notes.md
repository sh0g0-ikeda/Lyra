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

Personal digital plans and credit packs use the platform store. Organization
and enterprise billing is managed on the web by owner or billing roles. The
mobile app contains no checkout, plan-change, or billing-portal action for
organization billing and never treats a browser return URL as proof of payment.

## User-generated content

Users can create text and select their own images. The app is rated 17+ because
story content is user directed. Illegal content, exploitation, infringement,
and security abuse are prohibited by the terms. AI operations show the data
recipient and request consent before sending story settings or images to
OpenAI. StoryAI proposals and generated-image previews include an in-app
"Report AI-generated content" action. Reports contain only a fixed category,
reason, and opaque content record ID; no story text, prompt, image, token,
email, or user ID is attached.

## Privacy

- Policy: https://app.lyra-editor.com/privacy.html
- Privacy choices and deletion: https://app.lyra-editor.com/account-deletion.html
- Terms: https://app.lyra-editor.com/terms.html
- Support: https://app.lyra-editor.com/support.html
- Contact: lyra.japan.official@gmail.com

Do not place reviewer credentials in this file. Add them only through the
store's protected review-credential fields.
