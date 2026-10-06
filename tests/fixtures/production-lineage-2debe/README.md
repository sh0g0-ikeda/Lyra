# Frozen production-lineage fixture

These SQL files are verbatim from migrations/ at production commit
2debe8c3c22633ed077e7b189ddcfa8b209a00dc. They intentionally preserve the old
filenames and contents, including gaps in numbering. They are test fixtures,
never a production migration directory. manifest.json records SHA-256 digests.

Tests apply these files only to fresh disposable PostgreSQL schemas, insert
synthetic data and then run the candidate's forward compatibility bridge. No
live production data or credentials are included.
