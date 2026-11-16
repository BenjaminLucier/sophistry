# Security policy

## Supported versions

Only the latest release receives security fixes.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub:
[Report a vulnerability](https://github.com/BenjaminLucier/sophistry/security/advisories/new).
If you can't use GitHub, email benjaminlucier@gmail.com instead. Please don't open a public
issue or PR for a suspected vulnerability.

You can expect an acknowledgement within 3 working days. Fixes are coordinated
with you, and details are disclosed publicly once a fixed release is available,
or after 90 days at the latest.

## Scope

In scope: the published `@sophistry/*` packages, in particular

- TeX handed to `@sophistry/text`, which KaTeX renders into the page's DOM to
  measure it: markup or script getting through from a formula string.
- Images and fonts loaded by URL: requests going anywhere other than the URL
  you passed.

Out of scope:

- Vulnerabilities in dependencies that don't affect this code. Report them
  upstream; fixes are picked up through Dependabot.

## Safe harbour

Good-faith research that follows this policy, avoids accessing other people's
data, and gives us reasonable time to fix issues will not be pursued by the
maintainers.
