# Users and roles

How roles work, who can do what, and how admins create users, hand out the customer portal, and rotate passwords. For a click-through of provisioning and the user lifecycle with screenshots, see [Managing users: a walkthrough](/manage-users). See [Internal Auth](/reference/internal-auth) for the protocol-level reference and [Security Model](/reference/security-model) for the role by resource matrix.

## How access is decided

Access is moving to a capability model. Each role is a named bundle of capabilities, and the surfaces built or reworked for it (the operate and review flow, chat, tenant self-service for engagements, authorization facts, and users) ask for the capability they need rather than for a specific role. On those routes, adding a role is a matter of defining its bundle; the call sites do not change. Other routes still gate on role or audience directly, including MSSP tenant management, LLM and branding configuration, the admin password reset, and several dashboard, analytics, and investigation routes. Those are updated by hand when roles change. Treat capability-based access as the direction, not as universal today.

Roles are organised into tiers, and the same operating tiers exist on both sides of the business:

- **operate**: work the queue. View and triage investigations, review the AI's verdicts, decide, approve standard-blast proposals, use chat.
- **authorize risk**: everything operate can do, plus declare pentest engagements, curate authorization facts, and sign off high-blast actions that write to an external system.
- **configure**: everything the manager can do, plus the settings that role controls, and user management.

A higher tier holds every capability of the tier below it. The tenant side adds one more tier below operate, a read-only stakeholder (`customer_viewer`) that can see but not act; the MSSP side has no equivalent, since its lowest role (`analyst`) already operates.

Audience is a separate wall on top of the tiers. MSSP roles hold only MSSP capabilities and tenant roles hold only tenant capabilities; the two sets never overlap. A capability guard checks the capability and the audience together, so an MSSP capability can never satisfy a tenant route and the reverse. This is why `platform_admin`, for example, holds every MSSP capability but none of the tenant ones.

## Role catalog

**MSSP side** (staff of the provider; `tenant_id` is null):

| Role | Tier | Can do |
|---|---|---|
| `platform_admin` | configure (super) | Every MSSP capability, install-wide. |
| `mssp_admin` | configure | Configure the system, manage users, plus everything below. |
| `mssp_manager` | authorize risk | Declare engagements, curate authorization facts, sign off high-blast actions, plus operate. |
| `analyst` | operate | Triage investigations, review verdicts, decide, chat. Works one customer at a time by pinning a tenant (see Impersonation below); read-only on settings. |

**Tenant side** (staff of a customer; `tenant_id` set; scoped to that one tenant):

| Role | Tier | Can do |
|---|---|---|
| `tenant_admin` | configure | Manage their own org's users and their own LLM settings, plus everything below. Auto-provisioned during tenant onboarding by the runtime's `_mint_tenant_admin_user` flow. |
| `tenant_manager` | authorize risk | Declare their own pentest engagements, assert authorization facts (which land for MSSP review before they take effect), sign off high-blast actions, plus operate. |
| `tenant_analyst` | operate | Work their own tenant's SOC: triage, review verdicts, decide, approve standard-blast proposals, chat. This is the co-managed-SOC role, the tenant-side mirror of `analyst`. |
| `customer_viewer` | view only | Read-only stakeholder. Sees the customer's own SOC dashboard and investigations, but cannot act on them and cannot open the review queue. |

The `tenant_admin` "configure" tier is narrow: over the manager it adds its own-org LLM configuration and user management, and nothing else. Branding and integrations stay on the MSSP side.

The initial admin is created inline by the API pod's init command (driven by `install.bootstrapAdmin.email` and `install.bootstrapAdmin.password` in the chart values) as an `mssp_admin` with `must_change=false`. The [setup wizard](/setup-wizard) populates those values during first boot.

## The customer-viewer and tenant-analyst split

`customer_viewer` and `tenant_analyst` are both tenant-side, but they are different jobs. `customer_viewer` watches: dashboards and investigation status, nothing more. It cannot decide reviews, use chat, or list the pending-review queue. `tenant_analyst` operates: it runs the customer's own SOC on their own tenant's alerts. Give viewers to people who need visibility and analysts to people who do the work.

The pending-review queue is gated accordingly. Listing or opening a review requires review authority, held by MSSP `analyst` and above and by `tenant_analyst` and above. A tenant operator sees only their own tenant's queue. Cross-tenant review reads are limited to `platform_admin`, `mssp_admin`, and `mssp_manager`; an MSSP `analyst` reads a tenant's queue once pinned to it.

## Creating tenant users

A `tenant_admin` provisions its own org's logins. This is what makes the tenant roles usable; without it, a tenant would only have the single admin created at onboarding.

In the customer UI, open **Users** in the sidebar (visible only to `tenant_admin`), then **Add user**: enter an email, pick a role, and submit. The panel returns a one-time temporary password. Copy it and hand it to the user out of band; it is shown once and is never retrievable in plaintext. The user is asked to change it on first sign-in.

The same is available on the API:

```bash
curl -X POST 'https://<customer-host>/api/tenant/users' \
  -b cookies.jar -H 'Content-Type: application/json' \
  -d '{"email":"analyst@customer.example","role":"tenant_analyst"}'
```

Notes:

- The assignable roles are `customer_viewer`, `tenant_analyst`, `tenant_manager`, and `tenant_admin`. An MSSP role cannot be assigned here; the request is rejected. This is the audience wall.
- The new user is always placed in the caller's own tenant. The tenant is taken from the caller's session, never from the request body, and the database enforces it, so a tenant admin can only ever create users in its own tenant.
- A duplicate email is rejected. Emails are unique across the whole install.
- `GET /api/tenant/users` lists the tenant's own users. Both endpoints require the `tenant_manage_users` capability, which only `tenant_admin` holds.

The customer's portal is reached at a per-tenant host. The fixed hostname comes from `ingress.hostnames.customer` in the chart values, and slug-driven per-tenant hosts come from `ingress.tenantWildcard`. See the [install docs](/install) for the hostname layout.

## Creating MSSP staff users

An `mssp_admin` or `platform_admin` provisions MSSP staff logins from the **Staff Users** panel in the [MSSP UI](/mssp-ui), or on the API. The shape mirrors the tenant side.

```bash
curl -X POST 'https://mssp.your-mssp.example/api/mssp/users' \
  -b cookies.jar -H 'Content-Type: application/json' \
  -d '{"email":"analyst@your-mssp.example","role":"analyst"}'
```

Notes:

- The assignable roles are `analyst`, `mssp_manager`, `mssp_admin`, and `platform_admin`. A tenant role cannot be assigned here (the audience wall). Assigning `platform_admin` is allowed only if the caller is already a `platform_admin`.
- The new user is MSSP-side (`tenant_id` is null). These endpoints only ever operate on MSSP staff rows, so a tenant user can never be reached through them.
- The response carries a one-time temporary password; the user changes it on first sign-in. A duplicate email is rejected.
- `GET /api/mssp/users` lists staff. All of these require the `manage_users` capability, held only by `mssp_admin` and `platform_admin`.

`soctalk-auth set-password` (the CLI) still exists for the bootstrap and offline cases: it sets a password for an existing user, clears `must_change`, and audits the change, but does not create the user row and does not revoke sessions.

## Changing a role, deactivating, reactivating

Both sides expose the same lifecycle. On the tenant side a `tenant_admin` manages its own org; on the MSSP side an `mssp_admin`/`platform_admin` manages staff.

- **Change a role**: pick a new role from the row's selector, or `PATCH /api/tenant/users/{id}` (or `/api/mssp/users/{id}`) with `{"role": "..."}`. A role change revokes the user's live sessions so the new role takes effect immediately.
- **Deactivate**: the row's Deactivate button, or `POST .../{id}/deactivate`. The user is set inactive and every live session is revoked at once, so an already-signed-in user is cut off rather than lingering until expiry. The session middleware also refuses an inactive user, which closes the race with a concurrent sign-in.
- **Reactivate**: the row's Reactivate button, or `PATCH .../{id}` with `{"active": true}`.

Two guards apply to every change:

- You cannot modify your own account (no self-demotion or self-lockout).
- You cannot remove the last active administrator: the change that would leave a tenant with no active `tenant_admin`, or the install with no active `mssp_admin`/`platform_admin` (or no active `platform_admin` when one exists), is refused. The check locks the candidate rows, so concurrent demotions cannot both slip through.

An existing `platform_admin` account can only be changed, deactivated, or password-reset by another `platform_admin`.

## Password reset

**Self-service**: not implemented in this release. There is no forgot-password flow or email delivery on the login page. Users ask an admin to reset.

**Admin-forced**: an `mssp_admin` or `platform_admin` resets any user's password by id:

```bash
curl -X POST 'https://mssp.your-mssp.example/api/mssp/users/<user-id>/password/reset' \
  -b cookies.jar
```

The target can be an MSSP user or a tenant user; the actor must be `mssp_admin` or `platform_admin`. The response contains a new `temporary_password` flagged `must_change=true`, and the reset revokes all of that user's existing sessions. Share the password; the user picks a new one on first sign-in.

There is no tenant-side reset action, so a `tenant_admin` cannot reset one of its own users' passwords from the UI. Until that ships, an MSSP admin resets it with the endpoint above, or an operator resets it at the database row.

## Impersonation and tenant context switch

MSSP-side users (`platform_admin`, `mssp_admin`, `mssp_manager`, `analyst`) can scope their session to a specific tenant via `POST /api/auth/assume-tenant`. Tenant-side users cannot; they are already fixed to their own tenant. The UI surfaces this as the **Tenant: \<name\>** chip in the top-right of the [MSSP UI](/mssp-ui): clicking a tenant pins the session to that customer's view, and **Clear** drops back to cross-tenant scope. State-changing actions taken during that scope run as the original user with the session bound to that tenant.

This is not impersonation of a different user; the session identity stays the same. A "take over a specific user's session" surface is planned.

## Sessions

| Session storage | Cookie name | Lifetime |
|---|---|---|
| MSSP UI session | `soctalk_session` | 12 h absolute + 30 min idle |
| Customer portal session | `soctalk_session` | 12 h absolute + 30 min idle |
| Wizard session | `soctalk_session` | until wizard exits |

`POST /api/auth/logout` revokes the current session only. Deactivating a tenant user, and resetting any user's password, revoke all of that user's sessions. To revoke every session for an MSSP user without a password reset, set `revoked_at` directly on their `sessions` rows in Postgres; there is no admin API for that yet. Rotating the JWT signing key does not revoke DB-backed cookie sessions; the lookup is on the DB row, not the JWT signature.

A read-only session inventory (`GET /api/auth/sessions`) is planned.

## SSO / proxy auth

The runtime supports `SOCTALK_AUTH_MODE=proxy`, where SocTalk trusts an upstream OIDC proxy (OAuth2-Proxy, Keycloak, Dex) to authenticate the request. Identity is resolved from the `X-Forwarded-Email` header, matched by email to an existing user row. The auth mode itself is not exposed as a chart values knob today; set the env var directly on the `soctalk-system-api` Deployment after install. Trusted proxy CIDRs are chart-backed via `oidc.trustedProxyCIDRs`.

In proxy mode the password-based auth router is not mounted at all, so `/api/auth/login`, `/api/auth/password/change`, the admin password reset, and also `/api/auth/me`, `/api/auth/logout`, and `/api/auth/assume-tenant` are absent. The chart's bootstrap init still seeds the Organization row and, if `install.bootstrapAdmin.password` is set, the `mssp_admin` user. Keep setting `bootstrapAdmin` even in proxy mode: just-in-time user provisioning on first authenticated request is not implemented, so without a seeded user matched by email to your IdP identity, no proxy-authenticated request can resolve to a user row.

Role assignment in proxy mode happens at user creation in the database. The runtime trusts the forwarded email for identity but does not read group headers or auto-promote based on group membership. A configurable IdP-group to SocTalk-role mapping is planned.

Full details: [Internal Auth](/reference/internal-auth).

## Audit

User creation, role/status changes, and deactivation write `user.create`, `user.update`, and `user.delete` rows to the audit log (with before/after role and active state on updates), and password resets are audited as well. Note that the current `/api/audit` view in the UI reads the investigation event stream, not the `audit_log` table, so these user-management rows are queryable in `audit_log` directly but do not yet surface in that screen.
