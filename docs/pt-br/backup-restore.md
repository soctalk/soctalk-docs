# Backup e restauração

O que um MSSP faz backup, com que frequência e como restaurar. O SocTalk mantém três camadas de estado; cada uma tem seu próprio caminho de backup e restauração.

Esta página amplia [Operações diárias, Restauração do banco de dados](/pt-br/operations#database-restore-disaster-recovery), que é o mesmo procedimento documentado em nível de runbook. Use esta página para planejar a estratégia; use as operações para os comandos.

## O que fazer backup

### 1. Postgres (o control plane)

`soctalk-system-postgres-0` contém:

- Linhas de tenant + eventos de ciclo de vida
- Usuários, sessões, papéis
- Investigações, casos, runs, propostas
- Configurações (LLM, integrações, branding)
- `audit_log` append-only e `case_events` event-sourced
- Linhas de outbox pendentes de consumo pelo executor

**Tolerância a perda: zero**. Um Postgres perdido = histórico de auditoria perdido, sem investigações recuperáveis.

### 2. Secrets do Kubernetes em `soctalk-system`

| Secret (nome renderizado pelo chart) | O que contém |
|---|---|
| `soctalk-system-llm-api-key` | Chave de API do provedor de LLM (padrão de toda a instalação) |
| `soctalk-system-bootstrap-admin` | E-mail + senha do admin inicial (se `install.bootstrapAdmin.password` estiver definido nos values) |
| `soctalk-system-jwt-signing-key` | Chave de assinatura do token de sessão |
| `soctalk-system-adapter-signing-key` | Chave de assinatura do token de adaptador |
| `soctalk-system-postgres-admin-creds` | Credenciais do Postgres `soctalk_admin` (migrações) |
| `soctalk-system-postgres-app-creds` | Credenciais do Postgres `soctalk_app` (runtime) |
| `soctalk-system-postgres-mssp-creds` | Credenciais do Postgres `soctalk_mssp` (consultas cross-tenant) |
| `soctalk-slack-creds` | Tokens do Slack (fornecidos via env; não renderizados pelo chart) |
| `soctalk-thehive-creds` | Chave de API do TheHive (fornecida via env) |
| `soctalk-cortex-creds` | Chave de API do Cortex (fornecida via env) |

Um conjunto regenerado de Secrets é recuperável, mas as sessões em andamento quebram e as credenciais de integração precisam ser recoladas.

### 3. PVCs por tenant

Para cada namespace `tenant-<slug>`:

| PVC | O que contém |
|---|---|
| `wazuh-indexer-data` | Todo o histórico de alertas e eventos do Wazuh |
| `wazuh-manager-data` | Registros de agentes do Wazuh + estado do manager |
| `cortex-data` | Elasticsearch do Cortex (se o Cortex estiver habilitado) |
| `thehive-data` | Cassandra do TheHive (se o TheHive estiver habilitado) |

Tenants de perfil `poc` usam `local-path`, que **não tem garantia real de persistência**: um reinício de nó pode perder dados. Tenants de perfil `persistent` usam a StorageClass que a instalação marcar como padrão; faça backup de acordo com a documentação desse provisionador.

## Cadência

| Camada | Cadência sugerida | Retenção |
|---|---|---|
| Backup lógico do Postgres (`pg_dump`) | diário | 30 dias |
| Arquivamento de WAL do Postgres | contínuo | 7 dias |
| Snapshot de Secrets do Kubernetes | semanal + a cada rotação | 90 dias |
| PVCs por tenant | conforme o SLA do seu cliente (tipicamente diário para trabalhos de conformidade) | por contrato |

Clientes de conformidade (PCI, HIPAA, SOC 2) frequentemente exigem retenção mais longa. Trate o acima como o piso.

## Backup do Postgres

### pg_dump (lógico)

Executa contra o banco de dados ativo, sem downtime. Restauração mais lenta do que o backup físico, mas comprime bem e é portável.

```bash
kubectl -n soctalk-system exec soctalk-system-postgres-0 -- \
  pg_dump -U soctalk_app -d soctalk -Fc -Z 9 \
  > soctalk-$(date +%Y%m%d).pgdump
```

Direcione para o seu armazenamento offsite habitual (S3, GCS, Azure Blob).

### Arquivamento de WAL (point-in-time)

**Não conectado ao chart nesta versão.** O chart `soctalk-system` não expõe um value `postgres.archiveCommand`, então o PITR requer uma implantação do Postgres fora do StatefulSet empacotado do chart. Dois caminhos:

1. **Executar o Postgres externamente** (RDS gerenciado / Cloud SQL / Azure Database for PostgreSQL). Configure o arquivamento de WAL / PITR conforme a documentação do provedor. **Apontar o chart para um Postgres externo não está conectado através dos values no V1**: o chart fixa os detalhes de conexão do StatefulSet empacotado nos Secrets de credenciais de papel. Hoje isso significa executar sua própria overlay do helm que aplica patch na env `DATABASE_URL` do Deployment da API, ou modificar `soctalk-system-postgres-app-creds` / `-mssp-creds` / `-admin-creds` após a instalação. Um controle nos values `postgres.external` está no roadmap.
2. **Sidecar de arquivamento** na sua própria overlay do helm (por exemplo, [`spilo`](https://github.com/zalando/spilo) ou [`wal-g`](https://github.com/wal-g/wal-g) como sidecar). Fora do escopo do chart; executa como um Deployment separado que transmite o WAL para armazenamento de objetos.

De qualquer forma, o lado do SocTalk permanece inalterado, o data plane trata o Postgres como uma dependência externa. Conectar um `archiveCommand` do lado do chart está previsto para uma versão futura.

## Restauração (Postgres)

Consulte o [runbook](/pt-br/operations#database-restore-disaster-recovery). Resumo:

1. Reduza a API para zero para que nada esteja escrevendo (o chart V1 empacota o orquestrador dentro do pod da API, um Deployment).
2. Faça `pg_restore` do dump (limpe o banco de dados primeiro).
3. Se estiver usando WAL: reproduza o WAL até o ponto no tempo desejado.
4. Escale a API de volta para cima.

Após a restauração, o pod da API (que embute o orquestrador no chart V1) pode precisar de um empurrão para retomar os runs pendentes:

```bash
kubectl -n soctalk-system rollout restart deploy soctalk-system-api
```

## Backup de Secrets

Secrets do K8s são trabalhosos de fazer backup com segurança por causa do material secreto. Dois padrões:

### Sealed Secrets (recomendado)

Instale [Bitnami sealed-secrets](https://github.com/bitnami-labs/sealed-secrets) uma vez por cluster. Converta seus Secrets em recursos `SealedSecret`; faça commit deles no git. O controlador do cluster os descriptografa no momento da instalação. A perda de um Secret é recuperável a partir do git.

### Velero com restic / kopia

O [Velero](https://velero.io) faz backup de recursos do Kubernetes (incluindo Secrets) além de PVCs para armazenamento de objetos. Use o [snapshotter CSI in-tree](https://velero.io/docs/main/csi/) para PVCs e o backup de recursos padrão para Secrets.

```bash
velero backup create soctalk-system-daily \
  --include-namespaces soctalk-system \
  --snapshot-volumes \
  --schedule "0 2 * * *"
```

## Backup de PVCs por tenant

Tenants de perfil `persistent` usam StorageClass real; use as ferramentas de snapshot desse provisionador:

- **Longhorn**: backups agendados integrados para o S3
- **Rook/Ceph**: snapshots RBD ou `cephfs-mirror`
- **Volumes CSI de nuvem (EBS/Persistent Disk/Azure Disk)**: APIs de snapshot nativas

Para usuários do Velero, `velero backup create tenant-<slug>-daily --include-namespaces tenant-<slug> --snapshot-volumes` cobre tanto os PVCs quanto os objetos do K8s de uma só vez.

## Restauração por tenant

1. Desative o tenant existente (se houver), isso exclui o namespace.
2. Restaure os PVCs para um namespace novo a partir do snapshot.
3. Faça onboarding de um tenant com o mesmo slug e perfil via `POST /api/mssp/tenants/onboard`: o provisionamento é idempotente no namespace, então a instalação do Helm adotará os PVCs restaurados.
4. Verifique se o Wazuh enxerga os agentes existentes (não é necessário reinscrever se a restauração do PVC foi limpa).

Se apenas o data plane estiver corrompido (não o control plane do SocTalk), o caminho mais simples é `helm rollback tenant-<slug>` e depois restaurar os PVCs no lugar.

## Simulação de restauração

Execute uma simulação de restauração trimestralmente. Escolha um cluster não produtivo ou um tenant temporariamente quiescente. Limite o tempo a 4 h. Documente o que falhou e atualize esta página.

Falhas comuns que a simulação detecta:

- Lacuna de WAL (o arquivamento ficou para trás durante uma falha de nó)
- Secrets que foram rotacionados desde o último backup
- Incompatibilidade de StorageClass entre o cluster e o snapshot
- Política de rede bloqueando o pod restaurado de alcançar o novo Postgres

## O que não é coberto aqui

- Recuperação de desastres em todo o cluster (perda de nó do control plane, etc.), isso é operação de Kubernetes, não específico do SocTalk. Consulte a documentação da sua distribuição.
- Recuperação de credenciais do provedor de LLM, fora do escopo; gerencie com seu runbook normal de rotação de segredos.
- Backups de endpoints do lado do cliente, responsabilidade do cliente, não do MSSP.
