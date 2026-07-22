# FAQ

Perguntas de pré-instalação / pré-compra que não se encaixam bem em instalação ou referência.

## O que é o SocTalk?

Uma plataforma SOC multi-tenant construída para MSPs e MSSPs. Um control plane orquestra stacks Wazuh por cliente; um pipeline de AI faz a triagem de alertas e propõe ações; analistas humanos aprovam escalações. Totalmente open source.

## O que é open source vs. comercial?

**Tudo no repositório [`soctalk/soctalk`](https://github.com/soctalk/soctalk) é Apache 2.0**: o control plane, o pipeline de AI, a integração com Wazuh, os charts, a VM de demonstração. Não há divisão de funcionalidades entre "community e enterprise".

Existe um serviço de hospedagem gerenciada (SocTalk Cloud) para MSPs que não querem operar a plataforma por conta própria. O serviço hospedado usa o mesmo código da distribuição aberta.

## Posso avaliá-lo sem um cluster Kubernetes?

Sim, a [imagem da VM de demonstração](/pt-br/quickstart-vm) é uma instalação em caixa única. Inicialize-a em KVM, VMware, Hyper-V, Azure ou converta a partir do formato raw. Cinco minutos para uma instalação multi-tenant em execução com um tenant `demo` já provisionado.

## Posso executá-lo em um único nó permanentemente?

Sim, para implantações muito pequenas (1–2 clientes, baixo volume de alertas). A VM de demonstração usa o perfil `poc`, que assume armazenamento efêmero e não é dimensionada para carga sustentada. Para uso real com clientes:

- Aumente os recursos da VM (16 GB de RAM + 200 GB de SSD para ~3 tenants pequenos).
- Use o perfil `persistent` ao provisionar tenants.
- Adicione backups (consulte [Backup e restauração](/pt-br/backup-restore)).

Para mais de ~3 tenants, planeje um cluster multi-nó.

## Funciona em ambiente air-gapped?

Sim, com algumas etapas adicionais:

- **Imagens de contêiner**: espelhe `ghcr.io/soctalk/*` para o seu registro interno. O chart aceita `image.registry: your.registry.example/soctalk`.
- **Chart Helm**: execute `helm pull oci://ghcr.io/soctalk/charts/soctalk-system` uma vez, hospede em um registro OCI interno e aponte as instalações para ele.
- **LLM**: use um endpoint local compatível com OpenAI (vLLM, proxy Ollama, proxy Bedrock on-prem). Consulte [Provedores de LLM](/pt-br/integrate/llm-providers).
- **Analisadores do Cortex**: qualquer analisador que precise de internet não funcionará. Use apenas analisadores on-prem (MaxMind GeoIP, MISP interno) ou desabilite o Cortex.
- **GitHub Releases**: baixe a [imagem da VM](/pt-br/downloads) em um host conectado e transporte-a manualmente.

O fluxo [`scripts/dev-up.sh`](https://github.com/soctalk/soctalk/blob/main/scripts/dev-up.sh) roda sem internet uma vez que as imagens estejam espelhadas.

## Qual o custo de LLM por tenant?

Altamente variável, depende de:

- Volume de alertas (uma investigação por alerta que sobrevive à correlação)
- Orçamento de tokens por execução (`case_runs.tokens_budget`, padrão do modelo 200.000)
- Seleção de modelo (`fast_model` + `reasoning_model`)
- Com que frequência o verdict diz `needs_more_info` (causa uma reexecução)

Ordem de grandeza com o orçamento padrão de 200.000 tokens por execução e uso típico: 30 alertas/dia × ~60k tokens/investigação × US$ 5/Mtok de entrada ≈ US$ 9/dia por tenant em uma configuração econômica compatível com OpenAI. Cai de 5 a 10× com um fast model mais barato. Consulte [Observabilidade, Custo por tenant](/pt-br/observability#per-tenant-cost) para medi-lo.

## Clientes diferentes podem usar modelos de LLM diferentes?

Sim, override por tenant no momento do provisionamento. O modelo definido para toda a instalação é o padrão; os tenants optam por sair especificando o seu próprio. Consulte [Provedores de LLM, Overrides por tenant](/pt-br/integrate/llm-providers#per-tenant-overrides).

## Um cliente pode trazer a própria chave de LLM?

Sim, o override por tenant também se aplica à chave de API. O armazenamento autoritativo é `IntegrationConfig.llm_api_key_plain` no Postgres; o controlador o materializa em `Secret/tenant-llm-key` no namespace **do tenant** (não em `soctalk-system`), que o runs-worker monta. Útil para isolamento de faturamento.

## O SocTalk envia dados de clientes para a Anthropic / OpenAI?

Apenas aquilo sobre o que o pipeline de AI raciocina: o corpo do alerta, os observáveis extraídos e as saídas dos workers. O runtime não exfiltra dados em repouso, apenas o que está no estado atual da investigação. Se você precisa de uma postura mais rígida, use um endpoint de LLM on-prem (vLLM, Ollama). Consulte [Provedores de LLM, Mudar para a Anthropic / knobs de runtime](/pt-br/integrate/llm-providers#runtime-only-knobs-env-not-chart).

## Ele substitui meus analistas?

Não. O SocTalk é posicionado como um **copiloto**, não um substituto. O nó de verdict decide `escalate | close | needs_more_info`; a escalação sempre passa por um gate de [revisão humana](/pt-br/human-review). Sem o humano, um MSSP de alto volume ainda precisaria de analistas para lidar com as decisões que o SocTalk encaminha a eles.

O valor está na compressão, a mesma equipe de analistas consegue lidar com 5 a 10× o volume de alertas, porque casos rotineiros se fecham automaticamente e apenas os pouco claros chegam à revisão humana.

## Funciona sem o Wazuh?

O data plane atual é exclusivo do Wazuh. A superfície de ferramentas MCP (`wazuh.*`, `cortex.*`, `thehive.*`, `misp.*`) é plugável, então outros SIEMs são adições viáveis. Nenhum é distribuído hoje.

## Qual é a postura de hardening para produção?

- Postgres Row-Level Security com `FORCE ROW LEVEL SECURITY` como o mecanismo de contenção do isolamento de dados entre tenants.
- Cilium NetworkPolicy isolando cada namespace `tenant-<slug>`.
- TLS em todos os pontos (gerenciado pelo cert-manager em produção; autoassinado para o wizard).
- Todo o estado do control plane no Postgres com semântica de audit-log append-only.
- Admin de bootstrap criado somente quando explicitamente configurado nos values (ou via um Secret pré-provisionado); rotacione-o após o primeiro login com `soctalk-auth set-password`.

Consulte [Modelo de Segurança](/pt-br/reference/security-model) para a postura completa.

## Posso executá-lo em EKS / AKS / GKE?

Sim, o chart tem como alvo o Kubernetes 1.30+ padrão. Conecte a StorageClass, o ingress controller e o solucionador DNS-01 do cert-manager da sua nuvem. O [guia de instalação](/pt-br/install) é focado em K3s porque essa é a distribuição padrão; o chart em si é indiferente.

## Ele escala para N clientes?

Testado com até ~50 tenants em um cluster de 3 nós (16 vCPU / 64 GB / nó). O gargalo costuma ser o indexador Wazuh por tenant (cada indexador é um processo Java com sua própria heap) em vez do control plane do SocTalk. Planeje ~6–8 GB de RAM e ~1,5 vCPU por tenant de perfil `persistent`: consulte [Dimensionamento](/pt-br/reference/sizing).

## E quanto à conformidade (SOC 2, HIPAA, PCI)?

A postura da plataforma dá suporte a auditorias no estilo SOC 2, audit log append-only, RBAC, criptografia em repouso (Postgres + indexador Wazuh), criptografia em trânsito. Ela **não** é distribuída com uma atestação SOC 2; isso é responsabilidade do MSSP para a sua hospedagem.

Para HIPAA / PCI, o data plane (Wazuh) frequentemente contém dados dentro do escopo. Trate esse PVC como dentro do escopo e faça backup dele conforme necessário (consulte [Backup e restauração](/pt-br/backup-restore)).

## O que há no roadmap?

O GitHub Issues e o quadro Projects do [`soctalk/soctalk`](https://github.com/soctalk/soctalk) são a fonte da verdade. Itens de alto impacto mencionados na documentação como de versões futuras:

- Modo de autenticação por proxy exposto como um knob nos values do chart (hoje: override via variável de ambiente).
- API de upgrade de frota (hoje: loop manual de `helm upgrade`).
- Emissor de licenças (credenciais de instalação assinadas offline).
- Auxiliar de provisionamento de VPN gerenciada pelo cliente (hoje: apenas padrão documentado).
- Aba de Agentes por tenant no detalhe do tenant.

## Como posso contribuir?

Consulte a página [Contribuir](/pt-br/contribute).

## Onde consigo ajuda?

- Issues: https://github.com/soctalk/soctalk/issues
- Discussions: https://github.com/soctalk/soctalk/discussions
- Segurança: consulte SECURITY.md no repositório
