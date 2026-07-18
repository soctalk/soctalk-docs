# Solução de problemas

Sintoma → diagnóstico → correção. Runbook para os modos de falha mais comuns.

| Sintoma | Primeira verificação | Correção |
|---|---|---|
| `helm install soctalk-system` falha no hook de pré-instalação | `kubectl logs -n soctalk-system job/<release>-preinstall-check` | Instale o pré-requisito de cluster ausente (CNI, cert-manager, StorageClass) conforme o guia [Instalação](/pt-br/install#cluster-prerequisites) |
| Pod da API em `CrashLoopBackOff` na inicialização | `kubectl logs -n soctalk-system deploy/soctalk-system-api` | Na maioria das vezes: Secret `DATABASE_URL` incorreto, Postgres ainda não pronto ou falha de migração do Alembic. Verifique primeiro o pod do Postgres |
| `helm install` tem sucesso, mas a UI do MSSP retorna 502 | Logs do controlador de ingress; verifique se os `endpoints` do Service de ingress estão populados | Proxy OIDC não implantado ou não injetando headers confiáveis. Verifique o CIDR de trusted-proxy |
| Criação de tenant retorna 500 | Os logs da API mostram `ProvisionError` | Normalmente `helm install tenant-*` falhou. Verifique `helm status tenant-<slug>`. Problemas de namespace e resource-quota são os mais comuns |
| Tenant travado em `provisioning` > 15 min | `kubectl -n tenant-<slug> get events --sort-by=.lastTimestamp` | Consulte [Tenant travado em provisioning](/pt-br/operations#tenant-stuck-in-provisioning) em operações |
| Tenant fica `degraded` | Logs do adapter no namespace do tenant | Egress de NetworkPolicy, crash do pod do adapter ou DNS mal resolvido |
| Dados visíveis entre tenants | Execute a suíte de testes de isolamento | **Incidente P1.** O RLS é a última linha de defesa; uma falha indica um bug de aplicação ou uma má configuração de role do Postgres |
| Chamadas de LLM falhando para um tenant | Logs do worker: procure por 401/403 do provedor de LLM | O runs-worker lê de `Secret/tenant-llm-key` no namespace `tenant-<slug>`. A fonte autoritativa é `IntegrationConfig.llm_api_key_plain` no Postgres — rotacione via `PATCH /api/mssp/tenants/{id}/llm` (UI: detalhe do tenant → Settings → LLM), que reescreve o Secret e reinicia o runs-worker |
| Agente Wazuh não consegue conectar | IP do LB do tenant (ou IP+porta do HAProxy de borda) acessível a partir do host do agente; DNS para `<slug>.soc.mssp.*` resolve para ele; 1514/1515 abertos através de qualquer firewall intermediário | Consulte [Wazuh Ingress](/pt-br/reference/wazuh-ingress). 1514 é o protocolo proprietário do Wazuh — não há SNI para inspecionar; o roteamento é por endereço de destino ou porta. Verifique se o `Service` do tenant (`type: LoadBalancer` ou a porta do HAProxy) é o endereço que o agente está mirando |
| StatefulSet do Postgres não inicia (PVC Pending) | `kubectl describe pvc -n soctalk-system` | Sem StorageClass padrão, a classe não suporta RWO, ou o cluster está sem disco |
| Mensagens de `PolicyViolation` do controlador de ingress | Regras de allow da NetworkPolicy | Certifique-se de que o namespace de ingress esteja rotulado com `kubernetes.io/metadata.name=ingress-system` |
| Cilium Hubble mostra fluxos DROPPED entre o tenant e `soctalk-system` | NetworkPolicies + identidades do Cilium | Política de egress do adapter ausente ou `namespaceSelector` incorreto |
| Login de usuário cliente retorna 403 em `/api/tenant/*` | Claims do JWT | Garanta que a linha do usuário tenha `tenant_id` definido e `role=customer_viewer` |
| Impersonação de usuário MSSP não aparece na auditoria do cliente | Consulta de auditoria | Verifique se a coluna `acting_as` está populada na escrita; a view de auditoria do cliente faz join em `tenant_id = own AND acting_as IS NOT NULL` |
| Teste de isolamento falha na CI (admin com FORCE RLS consegue ver linhas) | Migração aplicada? | Reexecute `alembic upgrade head`; garanta que `FORCE ROW LEVEL SECURITY` esteja aplicado a cada tabela com escopo de tenant |
| ImagePullBackOff no `soctalk-adapter` / `soctalk-runs-worker` do tenant | `kubectl -n tenant-<slug> describe pod` mostra falha de pull para `ghcr.io/soctalk/soctalk-adapter:0.1.13-fixes` (ou similar) | Conhecido: `render.py` usa por padrão uma tag que pode não estar no ghcr público. Sobrescreva no momento da instalação: defina `tenantProvisioning.adapterImageTag: latest` e `tenantProvisioning.runsWorkerImageTag: latest` nos values do `soctalk-system`. Esses valores são propagados para as env `SOCTALK_TENANT_ADAPTER_IMAGE_TAG` / `SOCTALK_TENANT_RUNS_WORKER_IMAGE_TAG` no Deployment da API, que o render de provisioning lê |

## Coletando bundles de diagnóstico

Ao escalar para o suporte, colete:

```bash
# SocTalk system-level state
kubectl get all,events,networkpolicies,resourcequotas \
  -n soctalk-system -o yaml > soctalk-system.yaml
kubectl -n soctalk-system logs deploy/soctalk-system-api --tail=500 > api.log
# (V1 chart bundles the orchestrator into the API pod — no separate Deployment)

# Specific tenant
kubectl get all,events,networkpolicies,resourcequotas,limitranges \
  -n tenant-<slug> -o yaml > tenant.yaml
kubectl -n tenant-<slug> logs deploy/soctalk-adapter --tail=500 > adapter.log

# Helm state
helm status -n soctalk-system soctalk-system > helm-system.txt
helm status -n tenant-<slug> tenant-<slug> > helm-tenant.txt

# SocTalk version + lifecycle events for the tenant
# soctalk-cli debug-bundle was documented in earlier drafts; not implemented.
# Capture the data by hand from the kubectl/helm steps above.

tar czf soctalk-debug-$(date +%s).tgz *.yaml *.log *.txt
```

**Revise o tarball em busca de dados de clientes antes de compartilhá-lo externamente.** Os logs podem conter trechos de alertas.
