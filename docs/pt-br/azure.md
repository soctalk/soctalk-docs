# Executar a VM de demonstração no Azure

Importe a imagem publicada `soctalk-demo-<ver>.vhd` para o Azure como um disco gerenciado, transforme-a em uma imagem de VM e inicialize-a. As VMs do Azure rodam sobre Hyper-V, então este também é o caminho mais rápido para validar a imagem em um hypervisor Hyper-V sem precisar provisionar um host Windows Server.

Este caminho é para **avaliadores e demonstrações** — para uma instalação em produção no seu próprio cluster, consulte [Instalar](/pt-br/install).

## Por que o `.vhd` (e por que Generation 1)

- O Azure só aceita discos **VHD de tamanho fixo, alinhados a 1 MiB** (não VHDX, nem VHD dinâmico). O `soctalk-demo-<ver>.vhd` publicado é gerado pelo pipeline de release exatamente dessa forma (`qemu-img convert -O vpc -o subformat=fixed,force_size`), então ele importa tal como está — sem etapa de conversão local.
- A imagem é construída e testada em boot sob firmware BIOS, o que corresponde às VMs **Generation 1** do Azure. Crie o disco e a imagem com `--hyper-v-generation V1`.
- Um VHD fixo de 60 GB parece pesado, mas é quase todo composto por zeros. O `azcopy` faz upload para um page blob e **ignora páginas de zeros**, de modo que a transferência real corresponde a aproximadamente os ~3 GB de dados efetivos.

## Pré-requisitos

- Uma assinatura do Azure (`az account list` deve exibir uma — acesso ao diretório no nível de tenant não é suficiente).
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) (`az`) e [AzCopy](https://learn.microsoft.com/azure/storage/common/storage-use-azcopy-v10) (`azcopy`). No macOS: `brew install azure-cli azcopy`.
- ~61 GB de disco local livre para o VHD descompactado.
- Um par de chaves SSH (`~/.ssh/id_ed25519.pub` nos exemplos abaixo).

Faça login e selecione a assinatura:

```bash
az login
az account set --subscription "<subscription-name-or-id>"
```

## 1. Baixar e descompactar o VHD

```bash
VER=<ver>   # e.g. 0.2.0
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/soctalk-demo-$VER.vhd.xz
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing
xz -d soctalk-demo-$VER.vhd.xz   # decompresses to a 60 GB fixed VHD
```

## 2. Criar um grupo de recursos

Tudo neste guia fica em um único grupo de recursos, de modo que a remoção seja um único comando ao final.

```bash
RG=soctalk-demo
LOC=westus2
az group create -n $RG -l $LOC
```

## 3. Fazer upload do VHD diretamente para um disco gerenciado

Não é necessária uma conta de armazenamento — o Azure suporta upload direto para um disco gerenciado. Crie um disco vazio dimensionado para a contagem exata de bytes do arquivo VHD, obtenha um SAS de escrita de curta duração, faça o upload com `azcopy` e então revogue o SAS:

```bash
VHD=soctalk-demo-$VER.vhd
SIZE=$(stat -f %z "$VHD" 2>/dev/null || stat -c %s "$VHD")   # macOS || Linux

az disk create -g $RG -n soctalk-demo \
  --for-upload --upload-size-bytes $SIZE \
  --sku standard_lrs --os-type Linux --hyper-v-generation V1

SAS=$(az disk grant-access -g $RG -n soctalk-demo \
  --access-level Write --duration-in-seconds 86400 \
  --query accessSAS -o tsv)

azcopy copy "$VHD" "$SAS" --blob-type PageBlob

az disk revoke-access -g $RG -n soctalk-demo
```

A etapa do `azcopy` é a única demorada; com o descarte de páginas de zeros, ela move apenas os dados reais (~3 GB).

## 4. Criar uma imagem a partir do disco

```bash
DISK_ID=$(az disk show -g $RG -n soctalk-demo --query id -o tsv)

az image create -g $RG -n soctalk-demo-image \
  --source $DISK_ID --os-type Linux --hyper-v-generation V1
```

## 5. Inicializar uma VM

Restrinja o grupo de segurança de rede ao seu próprio IP — a máquina expõe SSH (22), a UI do SocTalk (443) e o assistente de configuração (8443), nenhum dos quais deve ficar aberto à internet:

```bash
MYIP=$(curl -s https://ifconfig.me)

az network nsg create -g $RG -n soctalk-nsg
i=100
for port in 22 443 8443; do
  az network nsg rule create -g $RG --nsg-name soctalk-nsg \
    -n allow-$port --priority $i --access Allow --protocol Tcp \
    --direction Inbound --source-address-prefixes $MYIP/32 \
    --destination-port-ranges $port
  i=$((i+10))
done

az vm create -g $RG -n soctalk-demo-vm \
  --image soctalk-demo-image \
  --size Standard_D4s_v3 \
  --admin-username ops \
  --ssh-key-values ~/.ssh/id_ed25519.pub \
  --nsg soctalk-nsg \
  --public-ip-sku Standard

IP=$(az vm show -g $RG -n soctalk-demo-vm -d --query publicIps -o tsv)
echo "VM is at $IP"
```

O `Standard_D4s_v3` (4 vCPU / 16 GiB) cobre confortavelmente o [dimensionamento mínimo](/pt-br/reference/sizing) de 4 vCPU / 8 GB. Qualquer coisa menor terá dificuldades assim que a stack Wazuh do tenant de demonstração for iniciada.

::: tip Não é necessário um ISO de seed
Em hypervisors, você anexa um `seed.iso` NoCloud para injetar uma chave SSH ([Início rápido](/pt-br/quickstart-vm#optional-cloud-init-seed)). No Azure essa etapa desaparece: o cloud-init da imagem detecta a origem de dados do Azure e provisiona `--admin-username` / `--ssh-key-values` automaticamente.
:::

## 6. Obter o token de configuração e executar o assistente

O fluxo é o mesmo de qualquer outro hypervisor a partir daqui. Dê à VM ~2 minutos após o boot para que o serviço do assistente suba e então:

```bash
ssh ops@$IP sudo cat /var/log/soctalk-setup-token
```

Acesse `https://<IP>:8443/`, aceite o certificado autoassinado, cole o token e preencha o assistente — nome do MSSP, credenciais de admin, provedor de LLM + chave de API. Consulte [Assistente de configuração](/pt-br/setup-wizard) para a referência dos campos.

Após o envio, o instalador de primeiro boot executa `helm install` e faz o onboarding do tenant `demo` — cerca de 2 minutos para os pods do `soctalk-system` e então mais alguns minutos para a stack Wazuh do tenant de demonstração. Você pode acompanhar via SSH:

```bash
ssh ops@$IP
journalctl -u soctalk-firstboot -f
sudo kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml get pods -A
```

## 7. Fazer login

Acesse `https://<IP>/` (porta 443, não 8443) e faça login com as credenciais de admin do assistente. Se você deixou o hostname em branco no assistente, mapeie `soctalk.local` para o IP da VM em `/etc/hosts` e use `https://soctalk.local/`. Continue com o [Tour pela UI do MSSP](/pt-br/mssp-ui).

## 8. Remover

Tudo foi criado dentro do grupo de recursos, portanto:

```bash
az group delete -n $RG --yes --no-wait
```

Isso remove a VM, a NIC, o IP público, o NSG, o disco gerenciado e a imagem de uma só vez. Nada mais fica gerando cobrança.

## Solução de problemas

| Sintoma | Verificação |
|---|---|
| `az disk create --for-upload` rejeitado | `--upload-size-bytes` deve ser o tamanho **exato** do arquivo em bytes do `.vhd` descompactado, incluindo o rodapé — execute novamente o comando `stat` |
| `azcopy` falha com 403 | O SAS de escrita expirou (24 h no exemplo) ou já foi revogado — execute novamente `az disk grant-access` |
| A VM nunca recebe a chave SSH | Confirme que a imagem e o disco foram criados com `--hyper-v-generation V1`; uma imagem V2 a partir deste VHD não inicializará, e um boot com falha nunca chega ao cloud-init |
| A URL do assistente nunca carrega | Regra do NSG para 8443 ausente ou seu IP público mudou (`curl ifconfig.me` e compare); então `systemctl status soctalk-setup-wizard` via SSH |
| Qualquer coisa após o assistente | O mesmo de todas as plataformas — consulte a [tabela de solução de problemas do Início rápido](/pt-br/quickstart-vm#troubleshooting) |
