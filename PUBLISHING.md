# Public release

## Clean new repository

The release helper applies repository ignore rules even to files tracked in an
older checkout, checks an explicit public-path allowlist and scans for common
credential patterns and personal home paths. It never prints matched values.

```sh
python scripts/audit_publication.py
python scripts/audit_publication.py --history
python scripts/audit_publication.py --export
```

The history check may fail on an existing development repository even when the
release files pass. Do not push that history to a clean public repository.
The export creates `exports/public-source.zip` without `.git`, local datasets,
generated metadata, saved analyses, credentials or internal working documents.
It refuses to overwrite a previous archive. Unpack it into a new empty folder,
review the files, initialize a new repository there, and connect that repository
to the intended public remote. Do not copy the original `.git` directory.

Review staged files and commit author/email metadata before pushing. Choose a
license before advertising open-source reuse; no license is selected automatically.
Enable GitHub secret scanning/push protection where available. Rotate any real
credential that was previously committed; deleting history does not revoke it.

The pattern scan is not a guarantee. It cannot identify every secret or decide
whether arbitrary research material should be public. Review new files and do
not override exclusions with `git add -f` without checking their contents.
Dependency vulnerability checks are separate from publication-content scanning.

## GitHub Pages: browser-only analyzer

GitHub Pages serves static HTML, CSS and JavaScript; it does not run Python.
[GitHub Pages documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site).
The current frontend calls `/api`; the development proxy is not part of a
production static build. Uploading the frontend alone would not work.

To offer the analyzer on Pages without a hosted backend:

1. Add browser-local CSV import and dataset indexing instead of server ingestion.
2. Port analysis and synthetic generation to browser-compatible code or a vetted
   browser Python runtime. Run heavy processing in workers to keep charts usable.
3. Replace server files/SQLite with browser-local storage and explicit import/export.
4. Verify numerical parity against existing fixtures and large competition datasets.
5. Configure repository-relative assets and static-safe routing, then deploy only
   the built frontend. No private datasets or development documents belong in it.

This migration is not implemented. The existing local analyzer remains usable.
Do not expose its unauthenticated Python API to the internet as a shortcut.
