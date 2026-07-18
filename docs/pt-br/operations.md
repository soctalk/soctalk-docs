# Operações diárias

Tarefas que operadores de MSSP executam contra uma instalação SocTalk ativa. Se ainda não fez isso, leia primeiro o [Tour pela UI do MSSP](/pt-br/mssp-ui) — ele cataloga todas as páginas referenciadas abaixo.

## Fila de investigações

Abra **Investigações** para ver os casos ativos de todos os tenants em uma única visão. Filtros: tenant, severidade. Clique em uma linha para ver a linha do tempo do caso, a conversa e as propostas.

![Lista de investigações](/screenshots/investigations-list.png)

## Fila de revisão de propostas

**Revisões** é a fila cross-tenant de propostas de AI aguardando um humano. Aprovar / rejeitar / pedir mais informações atualiza a linha de revisão no banco de dados (e no log de auditoria). Não há **outbox** na V1 — o pipeline de executor / notificação downstream está no roadmap.

![Fila de revisão](/screenshots/review-queue.png)

## Tenant travado em `provisioning`

**Sintoma:** a linha do tenant de um novo cliente permanece no estado `provisioning` por mais de 15 min.

1. Verifique o status do release Helm:
   ```bash
   helm status tenant-<slug> -n tenant-<slug>
   ```
2. Verifique os eventos dos pods:
   ```bash
   kubectl -n tenant-<slug> get events --sort-by=.lastTimestamp | tail -30
   ```
3. Causas comuns:
   - `StorageClass` ausente ou provisioner fora do ar → PVCs travados em `Pending`. Provisione o armazenamento; `kubectl describe pvc` mostra o motivo.
   - ResourceQuota pequena demais para a requisição do indexer do Wazuh. Aumente a ResourceQuota do tenant via `helm upgrade` com novos valores.
   - Falhas de pull de imagem → verifique a autenticação do registry e o firewall.

Se uma tentativa de provisionamento não puder se recuperar, descomissione e tente novamente:

```bash
# Pela UI do MSSP: detalhe do tenant → Decommission → force=true
# Ou via API:
curl -X POST https://mssp.../api/mssp/tenants/<id>:decommission?force=true
```

## Tenant em estado `degraded`

`degraded` é definido pelo controlador de provisionamento em uma falha de provisionamento, ou definido explicitamente via API. **Não há loop de auto-degradação baseado na idade do heartbeat do adaptador neste release**; a métrica `soctalk_tenant_adapter_heartbeat_age_seconds` serve para o seu alerting.

1. Verifique o pod do adaptador:
   ```bash
   kubectl -n tenant-<slug> logs deploy/soctalk-adapter --tail=200
   ```
2. Verifique o egress da NetworkPolicy (o adaptador precisa alcançar a API do `soctalk-system`):
   ```bash
   hubble observe --from-pod tenant-<slug>/soctalk-adapter-<pod>
   ```
3. Reinicie o adaptador:
   ```bash
   kubectl -n tenant-<slug> rollout restart deploy/soctalk-adapter
   ```

Se o data plane estiver saudável mas o adaptador ainda não conseguir alcançar o `soctalk-system`, inspecione a NetworkPolicy `adapter-egress`.

## Rotacionar a chave de LLM por tenant

1. Admin do MSSP → detalhe do cliente → Settings → LLM → cole a nova chave → Save (ou `PATCH /api/mssp/tenants/{id}/llm`).
2. O armazenamento autoritativo do SocTalk é `IntegrationConfig.llm_api_key_plain` no Postgres. O controlador de provisionamento materializa esse valor em `Secret/tenant-llm-key` no namespace do tenant (montado pelo Deployment do runs-worker) e opcionalmente espelha uma referência em `soctalk-system/<tenant-id>-llm` para auditoria.
3. O SocTalk reinicia, em regime de melhor esforço, o Deployment `soctalk-runs-worker` em `tenant-<slug>` para que a nova chave entre em vigor na próxima captação de investigação.

## Rotacionar segredos de bootstrap do data plane

Não há comando `soctalk-cli rotate-*` neste release — esse caminho foi documentado em rascunhos anteriores. Hoje:

- **Senhas de admin do Wazuh / TheHive / Cortex:** faça o patch do Secret correspondente no namespace do tenant e depois reinicie o pod afetado. A reexecução do bootstrap do chart na inicialização do pod captará a nova credencial.
- **Segredo compartilhado do `authd` do Wazuh:** faça o patch de `Secret/wazuh-authd-secret` em `tenant-<slug>` e reinicie o manager do Wazuh. Todos os agentes existentes precisam se reinscrever com o novo segredo; distribua-o pelo seu canal seguro habitual.

Um CLI wrapper para essas rotações está no roadmap.

## Analytics

**Analytics** consolida o volume de triagem, os resultados de propostas, o MTTR e o consumo de orçamento por tenant. Use-o para planejamento de capacidade, avaliação de modelos e revisão de SLA.

![Analytics](/screenshots/analytics.png)

## Revisão do log de auditoria

O log de auditoria de todo o MSSP fica em **UI → aba Audit**. Filtre por tenant, ator, ação ou timestamp. Para exportações de compliance, use a API:

```bash
curl 'https://mssp.../api/audit?since=2026-01-01&tenant=<id>' > audit.json
```

![Log de auditoria](/screenshots/audit-log.png)

## Restauração do banco de dados (disaster recovery)

Os backups são gerenciados externamente pelo MSSP (Velero, snapshots de cluster, `pg_dump` externo). Para restaurar:

1. Pare a API do SocTalk:
   ```bash
   kubectl -n soctalk-system scale deploy soctalk-system-api --replicas=0
   ```
   (O chart V1 embute o orquestrador no pod da API — não há Deployment `soctalk-system-orchestrator` separado.)
2. Restaure os dados do Postgres a partir do seu backup.
3. Reinicie a API: `kubectl -n soctalk-system scale deploy soctalk-system-api --replicas=2` (ou a sua contagem de réplicas habitual).

Os PVCs do data plane do tenant seguem o mesmo padrão: restaure por namespace e depois faça `helm upgrade` do release do tenant para reanexar.

## Emergência: desabilitar um tenant imediatamente

A ação **Suspend** da UI neste release muda o estado do tenant para `suspended` e impede que o orquestrador agende novas investigações — **mas não escala as cargas de trabalho**. Para um corte efetivo, execute os passos abaixo (escale todos os deployments para zero + aplique uma NetworkPolicy deny-all como redundância):

```bash
# 1. Escale todas as cargas de trabalho no namespace do tenant para zero. Esta é
#    a parada definitiva — os pods desaparecem.
kubectl -n tenant-<slug> get deploy,statefulset -o name \
  | xargs -I {} kubectl -n tenant-<slug> scale {} --replicas=0

# 2. deny-all de redundância para que qualquer coisa que volte a subir (por ex.,
#    a partir de um operador travado reconciliando) fique isolada.
kubectl -n tenant-<slug> apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: emergency-deny-all }
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
EOF
```

Reverta excluindo a NetworkPolicy, escalando as cargas de trabalho de volta às suas contagens de réplicas originais e chamando **Resume** na UI. **Resume** também apenas atualiza o estado no banco neste release — ele não restaurará as contagens de réplicas para você.

## Suspeita de vazamento de dados cross-tenant

Se você suspeitar de acesso cross-tenant:

1. Verifique as execuções recentes da suíte de testes de RLS; elas passam no CI a cada release.
2. Sonde o banco diretamente:
   ```bash
   kubectl -n soctalk-system exec -it statefulset/soctalk-system-postgres -- \
     psql -U soctalk_app -d soctalk \
     -c "SET app.current_tenant_id='<tenant-a>'; SELECT tenant_id FROM events LIMIT 5;"
   ```
3. Se um vazamento for confirmado, abra um incidente P1. RLS mais `FORCE ROW LEVEL SECURITY` é a última linha de defesa; um vazamento não corrigido indica um bug de aplicação ou uma má configuração de role do Postgres.

## Erros comuns

- Executar migrations como `soctalk_app`. As migrations precisam das credenciais `soctalk_admin`; sob `soctalk_app` elas falham.
- Editar os valores de `soctalk-tenant` diretamente no Helm. Isso ignora o estado do banco de dados do SocTalk; passe pela API.
- Criar namespaces `tenant-*` manualmente. As labels obrigatórias não estarão presentes e o SocTalk não reconhecerá o namespace. Use o fluxo de criação de tenant.
