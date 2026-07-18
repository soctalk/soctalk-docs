# Auditoria do Helm Chart de Tenant


> **Metodologia de auditoria**: este documento captura a classificação esperada com base na inspeção do chart. Execuções reais de `helm template` e o diff entre render e classificação são exigidos na validação de pré-release. Qualquer objeto encontrado em um render real que não esteja listado aqui torna-se um gate de revisão.

## Escopo da auditoria

Charts a auditar:

| Upstream | Origem upstream | Versão-alvo |
|---|---|---|
| Wazuh | Helm chart `wazuh/wazuh-kubernetes` (comunidade) ou chart OCI oficial | Última 4.x estável com suporte a HA de single-manager |
| TheHive | Helm chart `StrangeBee/thehive4` ou da comunidade | 5.x |
| Cortex | Helm chart `TheHive-Project/Cortex` ou da comunidade | 3.x |
| MISP | **adiado para uma versão futura** | |

Para cada chart, embutimos os templates de manifesto (com patches se necessário) como dependências de subchart de `charts/soctalk-tenant/`: o pinning de versão é estrito. `Chart.yaml` usa semver exato com digest (OCI) onde disponível.

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

### TheHive

| Objeto | Classe esperada | Notas |
|---|---|---|
| `Deployment` (app do TheHive) | NS-OK | |
| `StatefulSet` (variantes com Cassandra ou com DB externo) | NS-OK | usa Cassandra embutido; Cassandra externo é uma opção para versão futura |
| `Service` (web + API do TheHive na 9000) | NS-OK | |
| `ConfigMap` (application.conf) | NS-OK | Configuração por tenant renderizada pelo SocTalk |
| `Secret` (credenciais de admin, chave de API do Cortex para o Cortex deste tenant) | NS-OK | |
| `PersistentVolumeClaim` (dados do Cassandra, dados de índice) | NS-OK | |
| `ServiceAccount` | NS-OK | |
| `Ingress` | PATCH ou desabilitar | Mesmo que o Wazuh: exposição do dashboard via proxy do lado do MSSP com roteamento por tenant, não Ingress por namespace |
| `Job` (bootstrap / init) | NS-OK | OK para geração de certificado / inicialização de DB na primeira execução |
| `CustomResourceDefinition` | **FORBIDDEN**: deve estar no chart `soctalk-system` se presente |
| `ClusterRole` / `ClusterRoleBinding` | **FORBIDDEN** no chart de tenant |

**Patches esperados**:
1. Remover Ingress; usar apenas Services ClusterIP.
2. Fixar o Cassandra em digest; definir limites de recursos correspondentes ao dimensionamento.
3. Garantir que o Job de init seja idempotente (re-execuções inofensivas).
4. Sem dependências de CRD.

### Cortex

| Objeto | Classe esperada | Notas |
|---|---|---|
| `Deployment` (app do Cortex) | NS-OK | |
| `StatefulSet` (Elasticsearch ou índice compatível) | NS-OK | ES embutido; ES externo é uma versão futura |
| `Service` (API do Cortex na 9001) | NS-OK | |
| `ConfigMap` (application.conf, listas de analisadores) | NS-OK | |
| `Secret` (admin, tokens interserviços) | NS-OK | |
| `PersistentVolumeClaim` | NS-OK | |
| `ServiceAccount` | NS-OK | |
| `Job` (registro de analisadores) | NS-OK se idempotente |
| `Ingress` | PATCH ou desabilitar |
| `PrivilegedContainer` (Docker-in-Docker para sandboxing de analisadores, se o upstream usar esse padrão) | **FORBIDDEN**: patch | Analisadores do Cortex que exigem sandboxing por Docker estão fora de escopo para esta versão. Use apenas analisadores que rodam in-process ou que chamam serviços externos com sandbox |

**Risco conhecido**: historicamente o Cortex executa alguns analisadores como subprocessos ou contêineres Docker. Esta versão limita-se a analisadores "pure-code" que não exigem acesso privilegiado ao host. A lista de analisadores é fixada em values; analisadores que exigem Docker-in-Docker são rejeitados no momento do provisionamento.

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

Embutimos os charts upstream como dependências de subchart fixadas em `charts/soctalk-tenant/charts/`, não como referências de `helm repo`. Isso nos permite:
- Fixar em versões exatas (sem atualizações-surpresa do upstream)
- Aplicar patches conforme necessário sem depender da aceitação de PRs upstream
- Assinar nosso bundle como um único artefato (uma versão futura, quando o cosign chegar)

Se o upstream não atender às nossas necessidades após os patches, o fallback é escrever templates nativos do SocTalk que chamam as mesmas imagens de contêiner com nossos próprios manifestos. A validação de pré-release decide isso por chart.

## Incógnitas conhecidas (resolvidas na validação de pré-release)

Itens que exigem execuções reais de `helm template` + inspeção para confirmar:

- [ ] **Wazuh**: a versão de chart escolhida exige CRDs para deployment orientado por operator? Se sim, mova as CRDs para o chart `soctalk-system`.
- [ ] **TheHive**: o Cassandra exige uma `StorageClass` com recursos específicos (por exemplo, apenas RWO, IOPS mínimo)? Documente no dimensionamento.
- [ ] **Cortex**: quais analisadores são habilitados por padrão e algum exige Docker-in-Docker? Produza uma allowlist de analisadores seguros.
- [ ] **Todos os charts**: algum `Job` ou `CronJob` que rode com `ServiceAccount` além do namespace? Aplique patch para uma SA local do namespace.
- [ ] **Todos os charts**: algum `initContainer` com `privileged: true` ou montagens `hostPath`? Aplique patch ou substitua.
- [ ] **Todos os charts**: `resources.requests` e `limits` padrão: compare com o perfil de dimensionamento; sobrescreva em values onde necessário.

Cada item aberto torna-se uma entrada na checklist de validação de pré-release. A saída do spike é uma tabela de classificação preenchida e o chart com patch pronto para `charts/soctalk-tenant/charts/`.

## Artefato de saída (produzido antes do envio)

O spike produz:

1. **Inventário de objetos classificados** (preenchendo as tabelas da seção 3 com os objetos renderizados reais).
2. **Bundles de chart com patch** commitados em `charts/soctalk-tenant/charts/wazuh/`, `thehive/`, `cortex/` com versões fixadas.
3. **Lista de pré-requisitos de cluster** incorporada ao guia de instalação.
4. **Allowlist de analisadores** para o Cortex (conjunto apenas de seguros).
5. **Fragmento de schema de values** para cada subchart (entradas que o SocTalk fornecerá por tenant).

A conclusão do spike é um pré-requisito para a implementação do Helm chart.
