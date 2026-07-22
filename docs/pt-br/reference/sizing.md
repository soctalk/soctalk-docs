# Perfil de Dimensionamento para Instalações de Piloto


## Perfis de referência

Dois tamanhos de host de referência para esta versão.

### small-dev

Destinado a: desenvolvimento, demonstrações, POC single-tenant.

| Recurso | Valor |
|---|---|
| CPU | 4 vCPU |
| RAM | 16 GB |
| Disco | 100 GB SSD |
| Máximo de tenants | **1–2** |
| Control plane do SocTalk reservado | ~2 GB RAM, 1 vCPU |
| Orçamento por tenant | ~6–8 GB RAM, 1–1.5 vCPU |

Os tempos de boot são mais lentos aqui; aplica-se o SLO `<30 min to OSS stack healthy`.

### pilot-prod

Destinado a: MSSP operando clientes de piloto reais, 3–5 tenants.

| Recurso | Valor |
|---|---|
| CPU | 8 vCPU |
| RAM | 32 GB |
| Disco | 500 GB SSD |
| Máximo de tenants | **3–5** |
| Control plane do SocTalk reservado | ~3 GB RAM, 1–2 vCPU |
| Orçamento por tenant | ~5–7 GB RAM, 1–1.5 vCPU |

Tempos de boot no SLO `<15 min to OSS stack healthy`.

## Footprint por tenant (estimativas)

Estes são valores de ponto de partida para `ResourceQuota` e `LimitRange` no chart do tenant. A validação de pré-lançamento mede os valores reais; os valores reais substituem estes nos values finais.

| Componente | RAM request | RAM limit | CPU request | CPU limit | Disco (PVC) |
|---|---|---|---|---|---|
| Wazuh manager | 512 MB | 1 GB | 200 m | 500 m | 20 GB |
| Wazuh indexer (fork do OpenSearch) | 2 GB (heap 1 GB) | 4 GB (heap 2 GB) | 500 m | 2000 m | 50 GB |
| Wazuh dashboard | 512 MB | 1 GB | 100 m | 500 m | |
| Filebeat | 128 MB | 256 MB | 50 m | 200 m | |
| linux-ep (agente de endpoint L2) | 256 MB | 512 MB | 100 m | 500 m | |
| Adaptador do SocTalk | 128 MB | 256 MB | 50 m | 200 m | |
| **Orçamento reservado por tenant** | **~8 GB request, ~16 GB limit** | | **~2.2 vCPU request, ~7.7 vCPU limit** | | **~120 GB** |

TheHive e Cortex são integrações externas, não subcharts agrupados, então rodam fora do namespace do tenant e não fazem parte deste footprint por tenant; dimensione-os onde estiverem hospedados. A stack agrupada no namespace é o Wazuh mais o agente linux-ep, então o orçamento reservado acima carrega folga sobre os pods atuais no namespace.

Nota: os limits são tetos de burst; o uso sustentado fica mais próximo dos requests. Executar 3 tenants em um host de 8-vCPU / 32 GB / 500 GB significa:
- RAM: ~24 GB de requests (cabe), ~48 GB de limits (exige ajuste cuidadoso de overcommit).
- CPU: ~6.6 vCPU de requests (cabe com o control plane), os bursts compartilham o total.
- Disco: ~360 GB de PVCs de tenant (cabe com margem para o control plane + o banco de dados do SocTalk).

É por isso que o `pilot-prod` tem teto de 5 tenants; além de 5, os limits de memória começam a esbarrar na capacidade do node, mesmo considerando o overcommit.

## Fórmula de máximo de tenants por node

Aproximação:

```
max_tenants = floor((node_total_RAM - control_plane_RAM - safety_margin) / per_tenant_RAM_request)
```

- `control_plane_RAM`: 2 GB (small-dev) ou 3 GB (pilot-prod) para SocTalk + Postgres + controlador de ingress + Cilium + cert-manager.
- `safety_margin`: 10% da RAM do node para pods de sistema do K8s, CNI, DNS, monitoramento.
- `per_tenant_RAM_request`: 8 GB de baseline.

Para o pilot-prod de 32 GB: `floor((32 - 3 - 3.2) / 8) = floor(25.8 / 8) = 3` tenants garantidos sem overcommit. Com overcommit, 4–5 é seguro para volumes típicos de alertas.

## Fatores determinantes do dimensionamento de disco

O consumidor de disco dominante é o Wazuh indexer (armazena eventos indexados). A taxa de ingestão determina o crescimento:

| Taxa de alertas | Tamanho diário do índice (aproximado) | Retenção 30 dias | Retenção 90 dias |
|---|---|---|---|
| 10 alertas/s sustentados | ~5 GB/dia | 150 GB | 450 GB |
| 1 alerta/s sustentado | ~500 MB/dia | 15 GB | 45 GB |
| 100 alertas/dia | ~10 MB/dia | 300 MB | 900 MB |

Os tamanhos de PVC de tenant no chart têm padrão de **50 GB** para o Wazuh indexer; os MSSPs sobrescrevem por tenant para clientes de alto volume.

A política de retenção tem padrão de 30 dias de dados quentes no indexer; dados mais antigos são deletados ou arquivados (não implementa camadas hot→cold; uma versão futura adiciona isso).

## Gates de dimensionamento

### Verificação de pré-provisionamento

Quando o operador do MSSP cria um novo tenant, o controlador do SocTalk executa uma verificação de sanidade:

```
available_RAM = node.allocatable.memory - sum(ns.resourceQuota.requests.memory for ns in existing_tenant_namespaces) - control_plane_reserve
if (new_tenant.resourceQuota.requests.memory > available_RAM):
    refuse with "insufficient cluster capacity for new tenant"
    or
    prompt MSSP: "this will overcommit; proceed? [y/N]"
```

Este gate é mais brando nesta versão (avisa em vez de falhar de forma dura), já que os MSSPs podem intencionalmente fazer overcommit para clientes de uso leve.

### Aplicação de LimitRange por tenant

Todo namespace de tenant tem um `LimitRange`:

```yaml
apiVersion: v1
kind: LimitRange
metadata: { name: tenant-limits, namespace: tenant-acme }
spec:
  limits:
    - type: Container
      default:
        memory: "2Gi"
        cpu: "500m"
      defaultRequest:
        memory: "256Mi"
        cpu: "100m"
      max:
        memory: "6Gi"
        cpu: "2"
```

Impede que um pod acidentalmente mal configurado solicite 30 GB e deixe o node sem recursos.

## Perfis além disso

Documentados, mas não validados nesta versão:

| Perfil | CPU | RAM | Disco | Máximo de tenants |
|---|---|---|---|---|
| **mid-host** | 16 vCPU | 64 GB | 1 TB | 10–15 |
| **large-host** | 32 vCPU | 128 GB | 2 TB | 25–30 |
| **cluster multi-node** | 3 nodes × large | | - | 50+ (uma versão futura de multi-install é recomendada em vez disso) |

Recomendação para MSSPs que crescem além da capacidade do `pilot-prod`:
- : adicione um segundo host, execute uma segunda instalação do SocTalk (o schema suporta isso, o ferramental é manual).
- uma versão futura: automação de multi-install na camada de Cloud.
- uma versão futura: K3s em cluster com escalonamento adequado entre nodes.

## Plano de medição (validação de pré-lançamento)

O spike produz números reais para substituir as estimativas na §2:

1. Faça o deploy do `soctalk-tenant` com um tenant no `k3d` (dev-harness).
2. Medição em idle: capture um snapshot de `kubectl top pod -n tenant-acme`.
3. Teste de carga: injete 10 alertas/s por 10 minutos; meça o pico.
4. Pare a carga; meça ~5 minutos depois para obter os números de "warm-idle".
5. Repita com três tenants em paralelo para observar a interferência.
6. Atualize as tabelas deste documento com os valores medidos.
