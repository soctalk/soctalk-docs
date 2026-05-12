# SocTalk Documentation

Source for [docs.soctalk.ai](https://docs.soctalk.ai).

## Stack

VitePress for the static site (markdown content, local search) and
`vitepress-plugin-mermaid` for inline diagrams. Deploy follows the
`tameshi-docs` setup: GitHub Pages on push to `main`. See
`.github/workflows/deploy.yml`.

## Develop

```bash
npm install
npm run dev        # localhost:5173
npm run build      # → docs/.vitepress/dist
npm run preview
```

## Layout

```
docs/
  index.md                  Landing page
  install.md                Cluster prereqs + Helm install
  operations.md             Day-2 ops
  upgrades.md               Chart upgrade procedures
  troubleshooting.md        Symptom-to-fix index
  reference/
    architecture.md         Control plane + per-tenant stacks
    security-model.md       Principals, roles, audit
    postgres-rls.md         RLS hygiene + isolation tests
    chart-contract.md       Two-chart contract + compatibility matrix
    sizing.md               Profiles + per-tenant footprint
  public/
    screenshots/            UI screenshots referenced as /screenshots/<name>.png
```

## License

Documentation content is published under Apache 2.0, mirroring the
platform itself.
