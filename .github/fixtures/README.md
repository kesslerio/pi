# Firstmate SDK v1.2 catalog fixture

`firstmate-sdk-v1.2-model-data.tar.gz` contains the exact public provider catalog
JSON and generation manifest used by the accepted SDK build and full test suite.
CI restores it only for PRs targeting `firstmate-sdk-v1.2`, then runs the normal
`build:offline`, check, daemon build, and complete test suite. Main keeps live
catalog generation. The catalog is a release build input, not a runtime change.

The existing Nix catalog pin compiles this release but predates the tested
Anthropic Haiku 5.5 entry and Sonnet 5.5 cache price. Live catalog generation now
includes an OpenCode Go API that this release does not implement. Neither input
reproduces the accepted release's full build and test contract.

Provenance SHA-256 identifiers:

- Accepted SDK frozen manifest: `4066bb0c53703900fa776ff94d7a6f707da8ca62d285ed66bf7960aae258fe50`
- SDK provenance: `62c93dc8bb1599aa9e32cfd3881299a48fb25c11e65a3e26353b9ac78709fb4b`
- SDK acceptance receipt (`sdk-acceptance.json`): `d8aa6966ba852334d7804d3d508b011e36293ba665d80b336bd50c9a75c7aab0`
- Acceptance evidence (`acceptance-evidence.json`, whose `acceptance_sha256`
  references that receipt): `c1aecd6624a200697206b69e54d3d22c2f40e849afab0c75c42e26e7935b7575`
- Model structure: `2c88c6b129a59cef02b34f4d964d3df80a9bbd79dec2459b5311a3f299a229d2`

All 43 archive members match the accepted SDK provenance byte counts and hashes.
They are regular files directly under `data/`: the generation manifest and its
42 provider JSON files. There are no links, executable files, absolute paths,
parent traversal paths, credentials, operator paths, or logs. Radius metadata's
`credential: "radius"` is a public provider-routing label, not a secret.

The adjacent checksum is verified before extraction into the fixed provider
source directory. The existing `check:model-data` in `build:offline` then checks
the schema, provider set, model structure, and every JSON content hash against
the embedded generation manifest. No validation or test expectations are relaxed.

The archive uses sorted member names, file mode 0644, zero timestamps and
owner/group IDs, empty owner/group names, and an empty gzip filename. To recreate
it, use those deterministic archive settings with the accepted artifact's exact
`dist/providers/data/` files. Do not regenerate from current catalog services or
edit individual model values. Replacing this fixture requires acceptance of the
complete replacement catalog and an updated checksum and provenance record.
