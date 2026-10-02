# Four-tab and page-step selector migration

The helpers now enter Manga / Assets / My Page / Guide rather than the retired
Story / Characters / Pages tab layout. The Story/Pages helpers use the real Manga
workflow steps. A pre-existing fixture episode must be selected before open-pages;
creation scenarios may instead create/select it in the current run.

Page controls are grouped under page-step-design, page-step-settings, and
page-step-create. Paid page actions require the generation_quotes capability and
an explicit page-quote-accept action. There is no old paid-endpoint fallback.
Scenario 16 now exercises quote fingerprint/expiry conflict handling. Never pass
a PageRecord timestamp as expected_revision: the quote revision is a server hash.

These YAML selector changes have not been run on a native device. The environment
labels, fixture hierarchy selection, modal timing, staged credit budget, and
platform-specific native controls still require a supervised staging execution.
Do not count static parsing or unit tests as native E2E success.
