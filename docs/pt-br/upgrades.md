# Upgrades

Ambas as classes de chart são atualizadas via `helm upgrade`. Hoje isso é um runbook; uma API de upgrade para toda a frota está no roadmap.

## Checklist de pré-voo

Antes de qualquer upgrade:

1. **Leia as [notas de versão](https://github.com/soctalk/soctalk/releases)** da versão de destino. As migrações são apenas para frente (forward-only); uma mudança de schema inesperada não pode ser revertida com `helm rollback`.
2. **Atualize `soctalk-system` antes dos tenants.** Uma superfície formal de matriz de compatibilidade (UI System → Versions, validação `controller.can_upgrade`) é descrita em [Chart Contract](/pt-br/reference/chart-contract) como o alvo arquitetural, mas **não está implementada nesta versão**. Até que seja lançada, siga a linha de "combinações testadas" das notas de versão, atualize `soctalk-system` primeiro e, em seguida, promova cada tenant depois de verificar o upgrade do lado do sistema.
3. **Faça backup.** Snapshot do Postgres + todos os PVCs de tenant. Consulte a [seção de restauração de banco de dados](/pt-br/operations#database-restore-disaster-recovery) em operações.
4. **Dry-run** com `helm diff`:
   ```bash
   helm diff upgrade soctalk-system oci://ghcr.io/soctalk/charts/soctalk-system \
     --version <new> -n soctalk-system -f values.yaml
   ```

## Atualizar `soctalk-system` (nível de instalação)

O `soctalk-system-values.yaml` da instalação fixa `image.tag` na versão original. Sobrescreva a cada upgrade para que o novo chart renderize a nova imagem. Ou atualize o arquivo no controle de versão, ou passe `--set image.tag=<new-version>` em cada comando abaixo.

As migrações são executadas dentro do comando de init do pod da API (consulte [Install → Migrations and bootstrap](/pt-br/install#migrations-and-bootstrap-run-automatically)). Um `helm upgrade` reinicia o pod da API; o comando de init executa `alembic upgrade head` antes que o novo app inicie. O Alembic é idempotente — reexecutar em um schema atualizado é um no-op.

```bash
helm upgrade soctalk-system oci://ghcr.io/soctalk/charts/soctalk-system \
  --version <new-version> \
  --namespace soctalk-system \
  -f soctalk-system-values.yaml \
  --set image.tag=<new-version> \
  --wait --timeout 15m
```

Acompanhe a migração:

```bash
kubectl -n soctalk-system logs deploy/soctalk-system-api -c db-init --follow
```

Se `--wait` travar, a causa mais comum é uma falha de migração — leia os logs de init.

### Rollback

```bash
helm rollback soctalk-system <revision> -n soctalk-system --wait
```

Se o upgrade introduziu uma migração que alterou dados, o `helm rollback` não reverterá o schema. Restaure o Postgres a partir do backup pré-upgrade adicionalmente.

## Atualizar o data plane de um único tenant

```bash
helm upgrade tenant-<slug> oci://ghcr.io/soctalk/charts/soctalk-tenant \
  --version <new-tenant-chart-version> \
  --namespace tenant-<slug> \
  -f /tmp/tenant-<slug>-values.yaml \
  --wait --timeout 15m
```

O `/tmp/tenant-<slug>-values.yaml` é o arquivo de values renderizado pelo SocTalk. Hoje não existe uma CLI voltada ao operador para exportá-lo; extraia os últimos values renderizados do secret do release Helm do tenant:

```bash
helm get values tenant-<slug> -n tenant-<slug> -a > /tmp/tenant-<slug>-values.yaml
```

Um comando `soctalk-cli render-values` foi mencionado anteriormente neste guia, mas não existe — a única ferramenta de CLI hoje é `soctalk-auth`.

### Rollback por tenant

```bash
helm rollback tenant-<slug> <revision> -n tenant-<slug> --wait
```

Os rollbacks do data plane de tenant são mais seguros que os de nível de sistema: as stacks OSS (Wazuh, TheHive, Cortex) armazenam seus próprios dados em PVCs que o `helm rollback` deixa intactos.

## Upgrade de frota (loop manual)

```bash
# List tenants.
kubectl get ns -l tenant=true,managed-by=soctalk \
  -o jsonpath='{.items[*].metadata.name}'

# Upgrade each, pausing between.
for ns in tenant-acme tenant-beta tenant-gamma; do
  echo "upgrading $ns..."
  helm upgrade ${ns} oci://ghcr.io/soctalk/charts/soctalk-tenant \
    --version <new> -n $ns -f /tmp/${ns}-values.yaml --wait --timeout 15m
  kubectl -n $ns rollout status deploy/soctalk-adapter
  sleep 60   # let heartbeat settle before next.
done
```

Uma versão futura substitui esse loop por uma API de upgrade de frota com reconhecimento de canary.

## Ordem de upgrade

1. Pré-requisitos do cluster (CNI, cert-manager, ingress). Atualize-os de forma independente.
2. O chart `soctalk-system`. Executa as migrações como parte do upgrade de nível de instalação.
3. O chart `soctalk-tenant`, um tenant por vez, observando regressões.

Nunca atualize os charts de tenant antes do `soctalk-system`. A matriz de compatibilidade rejeita combinações fora do intervalo e a API se recusa a provisionar novos tenants em versões incompatíveis.

## Upgrades de chart de tenant com breaking changes

Se o chart de tenant promover uma versão major do Wazuh, TheHive ou Cortex com uma mudança de schema:

1. Faça snapshot dos PVCs do tenant primeiro.
2. Atualize em uma janela de baixo tráfego.
3. Verifique se os alertas fluem de ponta a ponta imediatamente depois.
4. Esteja preparado para executar `helm rollback` mais restaurar os PVCs se o processo de migração de schema do data plane falhar.

Projetos OSS upstream ocasionalmente lançam breaking changes. A [auditoria de chart](/pt-br/reference/chart-audit) fixa versões exatas de subchart; promover essas versões é explícito e testado antes da versão.
