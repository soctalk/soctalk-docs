# Users and roles

How MSSP admins create users, assign roles, hand out the customer portal, and rotate passwords. This is the operator-facing companion to [Internal Auth](/reference/internal-auth) (the protocol-level reference) and [Security Model](/reference/security-model) (the role × resource matrix).

## Role catalog

| Role | Scope | Sees |
|---|---|---|
| `platform_admin` | install-wide | every tenant, every setting |
| `mssp_admin` | install-wide | every tenant, every setting |
| `analyst` | install-wide (cross-tenant) | every tenant's investigations and reviews — the MSSP-side analyst working across customers. Read-only on most settings |
| `tenant_admin` | tenant-scoped | One customer's everything (settings, users, agents). Auto-provisioned during tenant onboarding by the runtime's `_mint_tenant_admin_user` flow |
| `customer_viewer` | tenant-scoped | the customer's own SOC dashboard, read-only |

The first three (`platform_admin`, `mssp_admin`, `analyst`) are MSSP-side and cross-tenant. `tenant_admin` and `customer_viewer` are tenant-scoped: `tenant_admin` is the customer's own admin (manages their analysts), `customer_viewer` is the read-only customer-portal role for end-customer staff.

The initial admin is created inline by the API pod's init command (driven by `install.bootstrapAdmin.email` and `install.bootstrapAdmin.password` in the chart values) as an `mssp_admin` with `must_change=false`. The [setup wizard](/setup-wizard) populates those values during first boot. There is no separate `python -m soctalk.core.provisioning.bootstrap` module — that path was documented in earlier drafts but does not exist.

## Creating an MSSP user

> **Status:** the user-create / invite / disable surface is **not yet implemented** in this release. The only user-management endpoint mounted today is the admin password reset (`POST /api/mssp/users/{id}/password/reset`). Until the create flow ships, provision users directly against the database with the included CLI:

```bash
kubectl -n soctalk-system exec -it deploy/soctalk-system-api -- \
  soctalk-auth set-password newanalyst@your-mssp.example
```

`soctalk-auth set-password` prompts for a password (or reads from `SOCTALK_PASSWORD`), sets it for the named user if the row exists, and audits the change as `auth.password.reset.admin`. **It does not create rows** — the user row must already exist (provisioned by the bootstrap Job, or inserted via Postgres directly while the create endpoint is in flight).

Tracking issue: user create / invite / disable / role-change CRUD via the MSSP UI.

## Creating a customer viewer

`customer_viewer` is the only role with **tenant-side** scope. The MSSP UI panel for inviting customer viewers is not yet built; today this requires direct DB inserts plus a `soctalk-auth set-password` for the initial credential. Wait for the user-management surface to ship before relying on `customer_viewer` widely.

The customer's portal URL is `https://<customer-host>/` where `<customer-host>` comes from `ingress.hostnames.customer` in the chart values (typically `<slug>.customers.your-mssp.example`). Share that URL with the customer along with the credential.

## Password reset (self-service)

Not implemented in this release. There is no "Forgot password" flow or email delivery on the login page. Users have to ask an admin to reset their password (see below).

## Password reset (admin-forced)

If the customer can't access their inbox or you're operating offline:

```bash
curl -X POST 'https://mssp.your-mssp.example/api/mssp/users/<user-id>/password/reset' \
  -b cookies.jar
```

The response contains a new `temporary_password` flagged `must_change=true`. Share it; the user picks a new password on first sign-in.

This endpoint requires `mssp_admin` or `platform_admin`.

## Disabling a user

There is no user-disable surface in this release — neither a UI action nor an API endpoint, and the data model does not track a `disabled_at` flag. Workaround while the disable surface is in flight:

- **Force a password change** the user doesn't know: `kubectl exec deploy/soctalk-system-api -- soctalk-auth set-password user@example`.
- Then set `revoked_at = now()` on every row in `sessions` where `user_id = <id>` (rotating the JWT signing key does **not** revoke DB-backed cookie sessions; the auth middleware checks the DB row).

Neither is reversible without similar friction. A real disable / re-enable surface is on the roadmap.

## Impersonation / tenant context switch

MSSP-side users (`platform_admin`, `mssp_admin`, `analyst`) can scope their session to a specific tenant via `POST /api/auth/assume-tenant`. The UI surfaces this as the **Tenant: \<name\>** chip in the top-right of the [MSSP UI](/mssp-ui) — clicking a tenant pins the session to that customer's view; the **Clear** button drops back to cross-tenant scope. The change is recorded in the audit log (`auth.assume_tenant`); subsequent state-changing actions during that scope appear in the audit trail as performed by the original user while the session was bound to that tenant.

This is **not** an impersonation of a different user (the session identity stays the same). A "take over a specific user's session" surface (`<admin> on behalf of <analyst>`) is on the roadmap.

## Sessions

| Session storage | Cookie name | Lifetime |
|---|---|---|
| MSSP UI session | `soctalk_session` | 12 h absolute + 30 min idle |
| Customer portal session | `soctalk_session` | 12 h absolute + 30 min idle |
| Wizard session | `soctalk_session` | until wizard exits |

`POST /api/auth/logout` revokes the current session only. To revoke all sessions for a user (e.g., after a credential leak) today, set `revoked_at` directly on every `sessions` row for that user in Postgres — there is no admin API for bulk revocation in this release. JWT signing key rotation does **not** revoke DB-backed cookie sessions; the lookup is on the DB row, not the JWT signature.

A read-only session inventory (`GET /api/auth/sessions`) is on the roadmap.

## SSO / proxy auth

The runtime supports `SOCTALK_AUTH_MODE=proxy`, where SocTalk trusts upstream identity headers (`X-Forwarded-User`, `X-Forwarded-Email`, `X-Forwarded-Groups`) from an OIDC proxy (OAuth2-Proxy, Keycloak, Dex). It is **not yet exposed as a chart values knob** — set the env var directly on the `soctalk-system-api` Deployment after install and configure trusted proxy CIDRs.

In proxy mode the password-based auth routers (`/api/auth/login`, `/api/auth/password/change`, the admin password reset) are not mounted — clients get a 404, not a 405. The chart's bootstrap init still seeds the Organization row and (if `install.bootstrapAdmin.password` is set) the `mssp_admin` user. **Keep setting `bootstrapAdmin` even in proxy mode** — JIT user provisioning on first authenticated request is not implemented, so without the seeded user (matched by email to your IdP identity) no proxy-authenticated request can resolve to a user row.

A configurable IdP-group → SocTalk-role mapping (group claim parsing, env-var-driven assignments) is on the roadmap. Today, role assignment in proxy mode happens at user creation in the database; the runtime trusts the upstream identity headers but does not auto-promote based on group membership.

Full details: [Internal Auth](/reference/internal-auth).

## Audit

Every user-management action is recorded in the audit log: create, role change, password reset (self + admin), disable/enable. Filter the [Audit log](/mssp-ui#audit-log) by Event Type to review.
