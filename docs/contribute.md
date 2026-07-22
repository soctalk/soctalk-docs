# Contribute

SocTalk is Apache 2.0. PRs welcome. This page covers the dev loop and what to expect from a review.

## Dev environment

Bring up a local cluster ready for SocTalk:

```bash
git clone https://github.com/soctalk/soctalk.git
cd soctalk
./scripts/dev-up.sh           # cluster dependencies only
```

`scripts/dev-up.sh` creates a k3d cluster and installs the cluster-level prereqs:

- K3s with Flannel + kube-proxy disabled
- Cilium as the CNI with NetworkPolicy enforcement
- cert-manager installed
- k3d local-path as the default StorageClass

It **does not** build SocTalk images, install the SocTalk chart, onboard tenants, or seed data, earlier drafts of this page claimed it did. Run the next steps yourself. Typical sequence after `dev-up.sh`:

```bash
just build-api build-frontend  # api image embeds the orchestrator in V1
helm install soctalk-system charts/soctalk-system \
  -n soctalk-system --create-namespace \
  --set install.bootstrapAdmin.email=dev@example \
  --set install.bootstrapAdmin.password=devpassword12
# migrations + bootstrap admin run in the API pod's init command
# sign in at https://<your-ingress>/ with the credentials you set above
```

For a faster inner loop (no image rebuild on every change), see the iteration tips below.

## Choose your iteration loop

Per project convention, prefer running services with `uvicorn` / `pnpm dev` over the k3d build-push-redeploy cycle:

```bash
# API (embeds the orchestrator in V1)
cd src && uvicorn soctalk.core.api.app_v1:app --reload --port 8000

# Frontend
cd frontend && pnpm dev
```

Point them at the k3d cluster's Postgres / Wazuh / Cortex via `kubectl port-forward`. Iteration is seconds, not minutes.

## Repo layout

```text
src/                Python (control plane, AI pipeline, adapter, runs-worker)
frontend/           SvelteKit (MSSP + customer UI)
charts/             Helm charts (soctalk-system, soctalk-tenant, wazuh, linux-ep)
infra/packer/       VM image generation (see /downloads)
setup-wizard/       Go (first-boot setup wizard)
attack-simulator/   MITRE ATT&CK demo scripts
scripts/            Dev / e2e / seed scripts
alembic/            DB migrations
docker-compose*.yml Various dev composition files
justfile            Build / release recipes
```

The docs site (this site) lives in a separate repo, [`soctalk/soctalk-docs`](https://github.com/soctalk/soctalk-docs).

## Tests

There are no `just test` / `just test-rls` / `just e2e-l1-l2` recipes in this release, that's the planned shape. Today, run tests directly with pytest:

```bash
pytest tests/                          # full suite
pytest tests/v1/test_rls_isolation.py  # Postgres Row-Level Security suite
```

The RLS tests are non-negotiable, they verify the cross-tenant data isolation that the [Security Model](/reference/security-model) promises. CI runs the full pytest suite on every PR.

## Style

- Python: ruff + black. CI enforces.
- TypeScript: ESLint + Prettier with the in-repo config. CI enforces.
- Commit messages: single-line subject, conventional commit prefix (`feat:`, `fix:`, `chore:`, `ci:`, `chart:`, …). No body required.
- No co-authored-by / signed-off-by trailers.

## PR expectations

- **Tests for the change.** New endpoints need API tests; new graph nodes need state-machine tests; chart changes need rendered-template snapshots.
- **Migration if you touched a model.** Alembic auto-generates; review the generated SQL for accuracy before committing.
- **Update docs** in [`soctalk-docs`](https://github.com/soctalk/soctalk-docs) if the change affects a documented behaviour. We are not strict about this for internal-only refactors; we are strict about it for anything user-facing.
- **Small PRs.** Big mixed-change PRs are hard to review. Split refactor from feature; split chart change from runtime change.

## Reviewing your own work

Before requesting review, run codex against your changes:

```bash
codex review --uncommitted
```

This is the same review pass we run at release time. It catches the obvious problems before a human reviewer has to.

## Releasing

Releases are tagged from `main`. Today the flow has more manual steps than the planned `just release` recipe implies:

1. Manually bump versions in `Chart.yaml` + `pyproject.toml`, commit, push.
2. Tag the commit and push the tag (`git tag v0.1.x && git push --tags`).
3. `just release`: runs `just build-all push-all`. This **only builds and pushes container images**; it does not tag, publish charts, or create a GitHub Release.
4. `publish-images.yml` GH workflow handles the image publish to ghcr.io when triggered.
5. Chart publish to `ghcr.io/soctalk/charts/` is done manually with `helm push` today.
6. `gh release create` to cut the GitHub Release.
7. `build-packer-images.yml` (manual trigger) builds the [demo VM image](/downloads) in all five formats and attaches them to the GitHub Release.

Consolidating steps 1, 2, 5, and 6 into the `just release` recipe is on the roadmap.

## Security disclosure

If you've found a vulnerability, **do not file a public issue.** Email the address listed in SECURITY.md in the repo root. We respond within two business days.

## License

Apache 2.0. By submitting a PR you agree to license your contribution under the same.

## Recognition

The git log is the canonical contributor record today; a dedicated CONTRIBUTORS.md / `just update-contributors` is planned.
