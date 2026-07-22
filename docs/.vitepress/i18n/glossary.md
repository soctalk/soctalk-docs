# SocTalk docs — translation termbase & policy

Authority for all locale translations of the docs site (`pt-br`, `es-419`,
`zh-cn`, `fr-fr`, `de-de`, `it-it`). Mirrors the app i18n conventions so the
product reads consistently between the UI and the docs.

## Golden rules

1. **Translate prose; never translate code.** Fenced code blocks, inline
   `code`, CLI commands, flags, env vars, file paths, YAML/JSON keys, URLs, and
   API field names stay **byte-for-byte identical** to English.
2. **Preserve Markdown & VitePress structure exactly.** Same heading levels,
   same list nesting, same table shape, same admonition containers
   (`::: tip` / `::: warning` — translate the *body*, keep the marker), same
   link targets. Only human-readable text changes.
3. **Do not translate protocol/product identifiers** (see DO-NOT-TRANSLATE).
4. **Keep links locale-relative.** A page under `docs/pt-br/` links to other
   translated pages as `/pt-br/...`. External links (GitHub, vendor sites) are
   left as-is.
5. **Frontmatter:** translate human-readable *values* (`hero.text`,
   `hero.tagline`, `features[].title`, `features[].details`, action `text`);
   keep keys, `link` targets, `layout`, and `theme` values untouched.
6. **Anchors:** VitePress derives heading anchors from the *translated* heading,
   so in-page links written as `[x](#some-anchor)` must be updated to the
   translated slug — or, preferred, keep them pointing at English-stable IDs
   only where an explicit `{#id}` is present.

## DO-NOT-TRANSLATE (literal everywhere)

Product / project: **SocTalk**, **Launchpad**, **Wazuh**, **TheHive**,
**Cortex**, **MISP**, **Slack**, **Ollama**, **LangGraph**, **Kubernetes**,
**K3s**, **Cilium**, **cert-manager**, **Helm**, **Postgres/PostgreSQL**,
**OpenSearch**, **VirtualBox**, **VMware ESXi**, **Proxmox**, **AWS**, **Azure**,
**WSL2**, **QCOW2 / VMDK / VHDX / VHD**.

Acronyms & terms of art (keep literal; expand-in-parenthetical only on first use
if the language conventionally does so): **SOC**, **MSP**, **MSSP**, **AI**,
**LLM**, **RLS** (Row-Level Security), **RBAC**, **HIL** (human-in-the-loop),
**API / REST API**, **CLI**, **CNI**, **VPN**, **IOC**, **ATT&CK**,
**MITRE ATT&CK**, **SIEM**, **BYO** / **BYO LLM**, **TTR**, **TTV**, **p50/p90/p95**.

Role & enum codes: keep the *code* literal where it is shown as a value
(`mssp_admin`, `analyst`, `platform_admin`); translate the human-readable
*label* consistently with the app catalog (e.g. de-DE Analyst→Analyst,
Manager→Manager; the app already fixed Alerts→Warnungen etc.).

## Preferred translations (align with the app UI)

| English      | pt-BR       | es-419     | zh-CN | fr-FR      | de-DE        | it-IT      |
|--------------|-------------|------------|-------|------------|--------------|------------|
| Alert(s)     | Alerta(s)   | Alerta(s)  | 告警  | Alerte(s)  | Warnung(en)  | Alert      |
| Tenant       | Tenant      | Tenant     | 租户  | Tenant     | Mandant      | Tenant     |
| Investigation| Investigação| Investigación | 调查 | Enquête  | Untersuchung | Indagine   |
| Review       | Revisão     | Revisión   | 审查  | Examen     | Prüfung      | Revisione  |
| Triage       | Triagem     | Triaje     | 分诊  | Triage     | Triage       | Triage     |
| Verdict      | Veredito    | Veredicto  | 裁决  | Verdict    | Verdikt      | Verdetto   |
| False Positive | Falso positivo | Falso positivo | 误报 | Faux positif | Falsch-Positiv | Falso positivo |
| True Positive  | Verdadeiro positivo | Verdadero positivo | 真实威胁 | Vrai positif | Richtig-Positiv | Vero positivo |
| Human review | Revisão humana | Revisión humana | 人工审查 | Revue humaine | Menschliche Prüfung | Revisione umana |
| Triage Policy | Política de triagem | Política de triaje | 分诊策略 | Politique de triage | Triage-Richtlinie | Politica di triage |
| Response Playbook | Playbook de resposta | Playbook de respuesta | 响应 Playbook | Playbook de réponse | Response-Playbook | Playbook di risposta |
| Guardrail    | Guardrail   | Guardrail  | 护栏  | Garde-fou  | Guardrail    | Guardrail  |
| Control plane| Control plane | Plano de control | 控制平面 | Plan de contrôle | Control Plane | Control plane |
| Data plane   | Data plane  | Plano de datos | 数据平面 | Plan de données | Data Plane | Data plane |

Where a term is commonly kept in English by practitioners in that language
(e.g. "Playbook", "Control plane", "Guardrail"), prefer the English term over an
awkward calque. When in doubt, match the app catalog in
`frontend/messages/<locale>.json`.

## Tone

Professional, concise, second-person imperative for instructions (as the English
does). Match the source register — this is operator/engineer documentation, not
marketing.
