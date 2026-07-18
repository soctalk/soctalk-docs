# Esquema de eventos do Launchpad

`launchpad up --headless` e `launchpad down --headless` transmitem **um evento JSON por linha** para o stdout. Essa é a superfície de automação: faça asserções sobre esses eventos a partir de CI, scripts ou de uma TUI de controle.

Todos os eventos compartilham a mesma estrutura de nível superior. Apenas os campos relevantes ao tipo de evento são preenchidos.

```json
{
  "ev":       "<kind>",        // discriminator; see below
  "time":     "2026-07-02T16:05:14.089Z",
  "phase":    "<phase>",       // only on ev=phase
  "vm_key":   "mssp",          // scopes VM-level events
  "step":     "install",       // sub-phase within a VM
  "percent":  60,              // 0-100
  "message":  "...",           // human-readable
  "level":    "info",          // for vm_log
  "gate_id":  "...",           // for gate_open / gate_resolved
  "instructions": "...",       // for gate_open
  "copy_text":    "...",       // for gate_open
  "ipv4":     "100.x.x.x",     // for vm_ready
  "ipv6":     "...",
  "ssh_user": "ops",
  "ssh_port": 22,
  "fields":   { "capabilities": ["vm.plan"] },  // free-form; used by plugin_ready
  "error":    { "category":"...", "code":"...", "message":"...", "hint":"..." }
}
```

## Tipos de evento

| `ev`             | Emitido quando                                                                          | Terminal? |
|------------------|---------------------------------------------------------------------------------------|-----------|
| `phase`          | O orquestrador faz a transição de fase.                                                | não       |
| `plugin_ready`   | O plugin de provisionamento foi iniciado e retornou seu handshake `hello`.             | não       |
| `vm_plan`        | Descrição em modo dry-run do que o plugin *criaria*, por VM.                           | não       |
| `vm_progress`    | Progresso de sub-etapa por VM (contém `step` + `percent`).                             | não       |
| `vm_ready`       | O plugin criou e verificou a VM.                                                       | não       |
| `vm_log`         | Linha de log do plugin (relay de progresso) ou de um shell de instalação conduzido pelo launchpad. | não |
| `gate_open`      | Gate manual alcançado; requer confirmação do operador.                                 | não       |
| `gate_resolved`  | O operador (ou `--auto-resolve-gates`) fechou o gate.                                  | não       |
| `error`          | Erro fatal. `error.category` + `error.code` são identificadores estáveis.              | **sim**   |
| `complete`       | Todo o fluxo executou sem falhas.                                                      | **sim**   |

`error` e `complete` são os dois eventos terminais. Toda execução do launchpad emite exatamente um.

## Ordem das fases (up)

```
initializing → planning → provisioning → installing → complete
```

Por VM dentro de `provisioning`, as etapas `lookup → prepare → image_cache|image_download → tailscale → cloud_init → disk → boot → wait_ready` são emitidas como `vm_progress`. A etapa `install` durante `installing` transmite o stdout do instalador subjacente como `vm_log`.

## Ordem das fases (down)

```
tearing_down → torn_down → complete
```

`vm.destroy` é chamado por VM na ordem inversa de provisionamento (tenants primeiro, MSSP por último). Cada emissão por VM é um `vm_progress` com `step=destroy`.

## Taxonomia de erros

`error.category` é um de dez identificadores estáveis com os quais o launchpad + todos os plugins nativos se comprometem:

| Categoria           | Significado                                                         | Retentável |
|---------------------|---------------------------------------------------------------------|-----------|
| `auth`              | Credencial ausente, inválida ou sem escopo.                         | não       |
| `validation`        | Configuração ou entrada malformada.                                 | não       |
| `not_found`         | A entidade referenciada não existe.                                 | não       |
| `already_exists`    | Criação idempotente falhou porque a entidade já está presente.      | não       |
| `provider_unavailable` | Provedor upstream (Tailscale, Hetzner, ...) está inacessível.    | sim       |
| `quota`             | Cota do lado do provedor esgotada.                                  | não       |
| `timeout`           | A espera excedeu um prazo de política.                              | sim       |
| `internal`          | Bug do plugin/orquestrador — caminho de erro inesperado.           | não       |
| `network`           | Rede local / TLS / DNS.                                             | sim       |
| `cancelled`         | Ctrl-C ou SIGTERM.                                                  | não       |

`error.code` é um identificador com namespace de plugin sob a categoria (por exemplo, `qemu.image.sha256_mismatch`). As categorias são estáveis; códigos podem ser adicionados.

## Consumindo a partir do bash

```bash
launchpad up --config pilot.yaml --headless --auto-resolve-gates | \
  jq -c 'select(.ev == "phase" or .ev == "error" or .ev == "complete")'
```

Para condicionar um job de CI à conclusão:

```bash
launchpad up --config pilot.yaml --headless --auto-resolve-gates > run.log
grep -q '"ev":"complete"' run.log || {
  jq -r 'select(.ev == "error") | "\(.error.category)/\(.error.code): \(.error.message)"' < run.log
  exit 1
}
```

## Compatibilidade de versões

- Adições de campo não quebram compatibilidade.
- Remoções de campo incrementam a versão maior do launchpad.
- Os valores de `error.category` são permanentes. Os valores de `ev` são permanentes.
- Os valores de `error.code` podem ser renomeados dentro da mesma categoria (têm escopo de plugin).
