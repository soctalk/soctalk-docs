# Auditoria do Helm Chart de Tenant


> **Metodologia de auditoria**: este documento captura a classificação esperada com base na inspeção do chart. Execuções reais de `helm template` e o diff entre render e classificação são exigidos na validação de pré-release. Qualquer objeto encontrado em um render real que não esteja listado aqui torna-se um gate de revisão.

## Escopo da auditoria

Charts a auditar:

| Upstream | Origem upstream | Versão-alvo |
|---|---|---|
| Wazuh | Helm chart `wazuh/wazuh-kubernetes` (comunidade) ou chart OCI oficial | Última 4.x estável com suporte a HA de single-manager |
| linux-ep | Subchart de agente de endpoint L2 do SocTalk (chave de componente `components.linuxep`) | `0.2.0` |
| MISP | **adiado para uma versão futura** | |

O chart `soctalk-tenant` embute exatamente dois subcharts, `wazuh` e `linux-ep`. Para cada um, embutimos os templates de manifesto (com patches se necessário) como dependências de subchart de `charts/soctalk-tenant/`: o pinning de versão é estrito. `Chart.yaml` usa semver exato com digest (OCI) onde disponível.

TheHive e Cortex são **integrações externas**, alcançadas pela rede e configuradas por tenant (veja /pt-br/integrate/thehive e /pt-br/integrate/cortex). Eles não são subcharts embutidos, então estão fora de escopo para esta auditoria de chart.

## Regras de classificação

Para cada objeto renderizado, classifique como:

- **NS-OK**: objeto com escopo de namespace que vive dentro de `tenant-<slug>`. Seguro, esperado.
- **CLUSTER-PREREQ**: objeto com escopo de cluster que deve ser instalado uma vez pelo chart `soctalk-system` ou documentado como responsabilidade do cluster-admin do MSSP. O chart de tenant não deve reinstalá-los por tenant.
- **FORBIDDEN**: tipo de objeto ou capacidade que nos recusamos a permitir em um chart de tenant, mesmo quando o upstream o declara (por exemplo, um `ClusterRoleBinding` de escopo de cluster dando ao Wazuh acesso privilegiado). Deve ser removido via patch.
- **PATCH**: mantenha o objeto, mas modifique-o (por exemplo, remover volumes `hostPath`, remover `securityContext` privilegiado, reduzir as requisições de recursos padrão).

## Classificação esperada por chart upstream

### Wazuh

Charts do Wazuh normalmente renderizam:

| Objeto | Classe esperada | Notas |
|---|---|---|
| `Deployment` / `StatefulSet` (manager, indexer, dashboard) | NS-OK | Pods centrais da stack |
| `Service` (API do manager, indexer, dashboard, ingress de agente 1514/1515) | NS-OK | |
| `ConfigMap` (ossec.conf, indexer.yml, dashboard.yml) | NS-OK | |
| `Secret` (senha de admin, certificados TLS mútuos) | NS-OK | Semeado por tenant no provisionamento |
| `PersistentVolumeClaim` (dados do indexer, dados do manager) | NS-OK | Tamanho definido via values do tenant |
| `ServiceAccount` | NS-OK | SA por tenant |
| `Role` + `RoleBinding` (para eleição de líder, se usada) | NS-OK | Apenas com escopo de namespace |
| `NetworkPolicy` (fornecida pelo chart) | PATCH | Substituir pela NP renderizada pelo SocTalk para uma postura consistente; não permitir que os padrões do upstream sobrescrevam o default-deny |
| Referências a `StorageClass` | CLUSTER-PREREQ | O MSSP deve fornecer um provisionador dinâmico; `storageClassName` é uma entrada de values |
| `Ingress` | PATCH ou desabilitar | O protocolo de agente do Wazuh na 1514 não é TLS padrão, então um `Ingress` HTTP/HTTPS não é apropriado. Remova quaisquer recursos `Ingress`. Para o `Service` de ingress de agente, o chart deve renderizar a variante que corresponde a `tenant.wazuhIngress.mode`: um Service `LoadBalancer` para IPs de LB por tenant (padrão) ou um Service `ClusterIP` quando a instalação usa o fallback de HAProxy in-cluster. Consulte [Wazuh Ingress](/pt-br/reference/wazuh-ingress). |
| `PodSecurityPolicy` / `SecurityContextConstraints` | CLUSTER-PREREQ se presente; forbidden caso contrário | PSP está descontinuado; se presente, remova. SCC do OpenShift está fora de escopo para esta versão |
| `CustomResourceDefinition` | **FORBIDDEN** no chart de tenant | Se o chart tentar instalar uma CRD, mova para o chart `soctalk-system` ou documente como pré-requisito |
| `ClusterRole` / `ClusterRoleBinding` | **FORBIDDEN** no chart de tenant | Nunca instale RBAC de escopo de cluster a partir de um namespace de tenant |
| Pods privilegiados/host-network/hostPath | **FORBIDDEN**; remover via patch | O manager do Wazuh não requer esses para operação padrão; o indexer também não. Se um subchart exigir `hostPath` para logs, aplique patch para `emptyDir` + PVC |
| `PodDisruptionBudget` | NS-OK | Opcional; depende do modo HA do Wazuh. A topologia de single-manager pode dispensá-lo |

**Patches esperados**:
1. Remover qualquer `ClusterRole`/`ClusterRoleBinding` da saída renderizada.
2. Remover quaisquer recursos com escopo de cluster (`ValidatingWebhookConfiguration`, etc.).
3. Renderizar o `Service` de ingress de agente para corresponder a `tenant.wazuhIngress.mode` (`LoadBalancer` para IPs de LB por tenant, `ClusterIP` para o fallback de HAProxy in-cluster).
4. Remover recursos `Ingress`. Os dashboards do Wazuh são expostos por um caminho separado gerenciado pelo SocTalk; o protocolo de agente na 1514 não é HTTP, então o `Ingress` do K8s não se aplica.
5. Garantir que todos os pods tenham `securityContext: { runAsNonRoot: true, allowPrivilegeEscalation: false }`; aplique patch se o upstream definir de outra forma.
6. Fixar imagens em digests, não em `latest`.

### linux-ep

O subchart de agente de endpoint L2 (`components.linuxep`). Seu inventário renderizado é estreito: o chart emite um único `StatefulSet` e consome um Secret existente via `secretKeyRef` em vez de renderizar seus próprios objetos de credencial.

| Objeto | Classe esperada | Notas |
|---|---|---|
| `StatefulSet` (agente de endpoint) | NS-OK | A única carga de trabalho que o subchart renderiza; com escopo de namespace |
| `Secret` (credenciais de enrollment / do agente) | Consumido, não renderizado | Referenciado via `secretKeyRef`; semeado por tenant no provisionamento, fora deste subchart |
| `ClusterRole` / `ClusterRoleBinding` | **FORBIDDEN** no chart de tenant | Nunca instale RBAC de escopo de cluster a partir de um namespace de tenant |

**Estado atual e patches esperados**:
1. O padrão do subchart define `securityContext.privileged: true` no pod do agente. Este é um comportamento apenas de PoC e um risco real, ele deve ser reduzido de escopo (remover privileged, `allowPrivilegeEscalation: false`) antes de qualquer uso em produção.
2. Confirmar que nenhum `ClusterRole`/`ClusterRoleBinding` apareça na saída renderizada.
3. Fixar imagens em digests, não em `latest`.

### Integrações externas (fora do escopo da auditoria)

TheHive e Cortex são **integrações externas**, não subcharts embutidos, então estão fora de escopo para esta auditoria de chart. O SocTalk os alcança pela rede por tenant; não há objetos TheHive/Cortex no namespace para classificar. Configure-os via /pt-br/integrate/thehive e /pt-br/integrate/cortex.

## Lista de pré-requisitos de cluster (incorporada ao guia de instalação + verificação de pré-requisitos do chart `soctalk-system`)

Após a auditoria, estes estão **fora de escopo para o chart de tenant** e devem existir no cluster antes que `soctalk-tenant` seja aplicado a qualquer namespace:

| Pré-requisito | Por quê | origem |
|---|---|---|
| K3s 1.30+ (ou K8s 1.30+ compatível) | Baseline mais `ValidatingAdmissionPolicy` v1 | responsabilidade do MSSP |
| CNI que aplica NP (Cilium primário, Calico alternativo) | Aplicação de isolamento | responsabilidade do MSSP |
| cert-manager | TLS para Ingress, emissão de certificado Wazuh por tenant | responsabilidade do MSSP; o guia de instalação fornece a receita `helm install` |
| Controlador de Ingress (Traefik padrão no K3s, ingress-nginx comum) | Roteamento da UI do MSSP + UI do Cliente + WebUI por tenant | responsabilidade do MSSP |
| `StorageClass` dinâmica (local-path, longhorn, CSI do provedor de nuvem, etc.) | Provisionamento de PVC | responsabilidade do MSSP |
| `VolumeSnapshotClass` se usar snapshots CSI | Runbook de backup/restore (apenas docs) | Opcional |

O chart `soctalk-system` inclui um hook de pré-instalação (`helm.sh/hook: pre-install`) que verifica:
- CNI que aplica NP ativa (sonda por marcadores do Cilium ou Calico)
- CRDs do cert-manager presentes
- `StorageClass` padrão definida

O hook falha rápido com uma mensagem de erro acionável se algum estiver faltando.

## Estratégia de patching

Dois caminhos:

1. **Overrides orientados por values**: prefira values do chart upstream que desabilitem o objeto indesejado (por exemplo, `ingress.enabled: false`, `networkPolicy.enabled: false` se a do upstream for mais permissiva que a nossa, `rbac.create: true` com escopo apenas de namespace).
2. **Overlay estilo Kustomize** (integração `kustomize` do Helm ou hook de post-render) para objetos que não podem ser desabilitados via values: remover `ClusterRole`s, remover volumes `hostPath`, definir `securityContext`.

Embutimos os charts upstream como charts irmãos sob `charts/` (`charts/wazuh`, `charts/linux-ep`) referenciados por caminho relativo, não como referências de `helm repo` (o helm os copia para dentro do pacote no momento do build). Isso nos permite:
- Fixar em versões exatas (sem atualizações-surpresa do upstream)
- Aplicar patches conforme necessário sem depender da aceitação de PRs upstream
- Assinar nosso bundle como um único artefato (uma versão futura, quando o cosign chegar)

Se o upstream não atender às nossas necessidades após os patches, o fallback é escrever templates nativos do SocTalk que chamam as mesmas imagens de contêiner com nossos próprios manifestos. A validação de pré-release decide isso por chart.

## Incógnitas conhecidas (resolvidas na validação de pré-release)

Itens que exigem execuções reais de `helm template` + inspeção para confirmar:

- [ ] **Wazuh**: a versão de chart escolhida exige CRDs para deployment orientado por operator? Se sim, mova as CRDs para o chart `soctalk-system`.
- [ ] **linux-ep**: o agente de endpoint exige acesso em nível de host (hostPath, host network) que deva ser removido via patch ou reduzido de escopo?
- [ ] **Todos os charts**: algum `Job` ou `CronJob` que rode com `ServiceAccount` além do namespace? Aplique patch para uma SA local do namespace.
- [ ] **Todos os charts**: algum `initContainer` com `privileged: true` ou montagens `hostPath`? Aplique patch ou substitua.
- [ ] **Todos os charts**: `resources.requests` e `limits` padrão: compare com o perfil de dimensionamento; sobrescreva em values onde necessário.

Cada item aberto torna-se uma entrada na checklist de validação de pré-release. A saída do spike é uma tabela de classificação preenchida e o chart com patch mantido sob `charts/wazuh` / `charts/linux-ep`.

## Artefato de saída (produzido antes do envio)

O spike produz:

1. **Inventário de objetos classificados** (preenchendo as tabelas da seção 3 com os objetos renderizados reais).
2. **Bundles de chart com patch** mantidos sob `charts/wazuh/` e `charts/linux-ep/` com versões fixadas.
3. **Lista de pré-requisitos de cluster** incorporada ao guia de instalação.
4. **Fragmento de schema de values** para cada subchart (entradas que o SocTalk fornecerá por tenant).

A conclusão do spike é um pré-requisito para a implementação do Helm chart.
