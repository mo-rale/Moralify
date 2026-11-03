# Code signing with SignPath

Moralify's installer is currently **unsigned**, so Windows SmartScreen warns about it and Smart App Control (Windows 11) can block it. [SignPath Foundation](https://signpath.org/) signs open source projects for free. This file is the checklist for turning that on. The GitHub workflow (`.github/workflows/release.yml`) is already prepared: it signs only after the setup below is done, and publishes unsigned installers until then.

## 1. Before you apply

- Turn on **multi-factor authentication** for your GitHub account (SignPath requires it for everyone on the project).
- Check the project meets the [SignPath Foundation terms](https://signpath.org/terms): an OSI-approved license (MIT, yes), a public repository, installers built from source by the automated GitHub workflow, and no proprietary components. Moralify bundles FFmpeg (GPL), LibRaw (LGPL/CDDL), libheif (LGPL) and pdf.js (Apache 2.0), which are all open source; SignPath makes the final call.
- The README already has a **Code signing policy** section (team roles and privacy statement). The required attribution line is in an HTML comment there: remove the comment markers once you are approved.

## 2. Apply

Fill in the form at <https://signpath.org/apply> with the project name (Moralify), the repository `https://github.com/mo-rale/Moralify` and the license. Approval is manual and can take a while.

## 3. Set up SignPath (after approval)

1. In SignPath, create the project with the slug **`moralify`**.
2. Add the **GitHub.com** trusted build system to your organization and link it to the project.
3. Add an artifact configuration with the slug `initial` using the contents of `.signpath/artifact-configuration.xml`.
4. Add a signing policy with the slug **`release-signing`** that requires **manual approval** (SignPath's open source rules require it for every release).
5. Create an API token for a user that may submit to that signing policy.

If you choose different slugs, change `project-slug` and `signing-policy-slug` in `.github/workflows/release.yml`.

## 4. Connect GitHub

In the repository: **Settings → Secrets and variables → Actions**

- Secret **`SIGNPATH_API_TOKEN`**: the token from step 3.5.
- Variable **`SIGNPATH_ORGANIZATION_ID`**: your SignPath organization id (shown in SignPath).

## 5. Release

Push a version tag as before. The workflow builds the installer, sends it to SignPath and waits (up to 2 hours) for you to approve the request in SignPath. Approve it, and the signed installer is published on the release together with the code signing policy note. If you do not approve in time, the run fails: approve sooner or re-run it.

## Good to know

- Only the installer file is signed. The program files that the installer unpacks are not signed individually.
- A brand-new signature can still show a SmartScreen warning for a while, until enough people have installed it.
- `latest.yml` (used by auto-update tools) is not published, because signing changes the installer's checksum. Moralify does not auto-update yet.
