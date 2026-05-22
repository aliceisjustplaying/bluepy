# Security Policy

## Supported Versions
Only the latest production release of Bluepy receives security updates.

## Reporting a Vulnerability

**Please don’t discuss security issues in public GitHub issues.** Instead:

1. **GitHub Private Reporting** (preferred):
   - Click "Report a vulnerability" under the Security tab.
2. **Email**:
   - Reach out to me directly at cheeaun@gmail.com

**Include**:
- Steps to reproduce the issue
- Which parts of Bluepy are affected
- How severe you think the impact could be

## Disclosure Policy

**Heads up:** I’m a solo maintainer working on Phanpy in my free time. While I take security seriously, I can’t promise enterprise-grade response times. Here’s how I’ll handle reports:

1. **Confirmation**: I’ll acknowledge reports when possible, but this might take weeks due to limited availability.
2. **Fixing**: Critical bugs will be prioritized, but fixes may take significant time. If it’s urgent, feel free to follow up.
3. **Public Disclosure**: Patched vulnerabilities will be disclosed once the fix is confirmed stable and most users have updated.

## Security Practices

### For Users

- Use Bluepy only with HTTPS AppView and PDS endpoints.
- Treat OAuth sessions and app passwords like passwords.

### For Developers

- **Dependencies**: GitHub Dependabot alerts are enabled for vulnerability monitoring.
- **Code**:
  - Basic input sanitization to prevent XSS.
  - *Planned*: Improvements to client-side storage security (contributions welcome!).
