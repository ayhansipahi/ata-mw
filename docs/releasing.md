# Releasing

Releases are published by GitHub Actions ([`publish.yml`](../.github/workflows/publish.yml)) with npm trusted
publishing: no npm token, no OTP, and npm adds provenance on its own. All four packages share one version.

## Each release

1. Set the version, refresh the lockfile, open a pull request and merge it:

   ```bash
   node scripts/set-version.mjs 0.1.2
   npm install
   ```

   `set-version` updates the four `package.json` files and points the adapters at the same `@ata-mw/core`.
   `npm install` refreshes `package-lock.json` (CI's `npm ci` fails if you forget).

2. Tag the merged commit on `main`:

   ```bash
   git switch main && git pull && git tag v0.1.2 && git push origin v0.1.2
   ```

3. Open the `publish` run in the Actions tab. After `verify` passes (tag matches the version and is on `main`,
   typecheck, tests, built-package checks) the `publish` job waits for your approval: **Review deployments**,
   tick `npm`, **Approve**. It then publishes `core` first, then `express`, `hono` and `middy`.

## One-time setup

Do this before the first release that goes through the workflow. An npm trusted publisher that has not
completed a successful publish within 2 days expires and has to be created again.

1. Log in (the commands below need your 2FA):

   ```bash
   npm login
   ```

2. GitHub: **Settings → Environments → New environment**, name it `npm`, enable **Required reviewers** and add
   yourself (leave **Prevent self-review** off if you are the only maintainer). The name must be `npm`.

3. Tell npm to trust this workflow, once per package. Look at what it will do first:

   ```bash
   for p in core express hono middy; do npm trust github @ata-mw/$p --repo ayhansipahi/ata-mw --file publish.yml --env npm --allow-publish --dry-run; done
   ```

   Then run it for real (same command without `--dry-run`, add `-y` to skip the prompts):

   ```bash
   for p in core express hono middy; do npm trust github @ata-mw/$p --repo ayhansipahi/ata-mw --file publish.yml --env npm --allow-publish -y; done
   ```

   Check with `npm trust list @ata-mw/core`. A trust entry cannot be edited: the workflow file name (`publish.yml`)
   and the environment (`npm`) are fixed once created. Delete and recreate it to change them.

4. After the first workflow publish succeeded, close the token route: on npmjs.com open each package,
   **Settings → Publishing access**, choose **Require two-factor authentication and disallow tokens**.
   Trusted publishing keeps working.

## If a run fails

- `ENEEDAUTH` / `Unable to authenticate`: the workflow file name or the environment name does not match the
  trust entry (`npm trust list @ata-mw/core`), or npm in the runner is older than 11.5.1 (the log prints it).
- `tag ... does not match version`: the tag was cut from a commit where `set-version` was not applied.
  Delete the tag (`git push origin :refs/tags/vX.Y.Z`), fix, tag again.
- A publish that already succeeded for some packages cannot be repeated for those (npm versions are immutable).
  Bump to the next patch version and release again.
