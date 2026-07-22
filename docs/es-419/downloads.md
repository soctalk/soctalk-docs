# Descargas

Imágenes de VM de demostración de SocTalk precompiladas, publicadas como artefactos de GitHub Release en cada etiqueta `v*` del repositorio [`soctalk/soctalk`](https://github.com/soctalk/soctalk).

Todas las imágenes corresponden a la misma compilación de Ubuntu 24.04 + K3s + asistente de configuración, solo convertida a distintos formatos de disco virtual. Elige el formato que tu hipervisor consuma de forma nativa. **No hay diferencia funcional entre formatos.**

## Última versión

Versión actual: **v0.2.0**: [página de la versión](https://github.com/soctalk/soctalk/releases/tag/v0.2.0) · [todas las versiones](https://github.com/soctalk/soctalk/releases)

La versión incluye:

- [`soctalk-demo-0.2.0.qcow2.xz`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.qcow2.xz), KVM, QEMU, libvirt, Proxmox
- [`soctalk-demo-0.2.0.vmdk.xz`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.vmdk.xz), VMware ESXi, Workstation, Fusion, VirtualBox
- [`soctalk-demo-0.2.0.vhdx.xz`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.vhdx.xz), Microsoft Hyper-V (Generation 1)
- [`soctalk-demo-0.2.0.vhd.xz`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.vhd.xz), Microsoft Azure (tamaño fijo, alineado a 1 MiB)
- [`soctalk-demo-0.2.0.raw.xz`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.raw.xz), importación genérica a la nube (GCP, OpenStack), `dd` a disco físico
- [`SHA256SUMS.txt`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/SHA256SUMS.txt), sumas de verificación para todo lo anterior

Todos los artefactos están comprimidos con `xz -9`. Descomprímelos con `xz -d <file>.xz`.

## Selector de formato

| Tu plataforma | Descarga |
|---|---|
| **Proxmox VE** | qcow2, `qm disk import`. Consulta [Ejecutar en Proxmox](/es-419/proxmox) |
| **libvirt / virt-manager / QEMU CLI** | qcow2 |
| **KVM (RHEL/CentOS/Alma)** | qcow2 |
| **VMware ESXi** | vmdk, consulta [Ejecutar en VMware ESXi](/es-419/vmware) |
| **VMware Workstation / Fusion** | vmdk |
| **VirtualBox** | vmdk, conviértelo a VDI y luego adjúntalo. Consulta [Ejecutar en VirtualBox](/es-419/virtualbox) |
| **Microsoft Hyper-V** | vhdx, VM de Generation 1 (validada; la imagen arranca mediante firmware BIOS, Gen 2 / UEFI no está probado) |
| **Microsoft Azure** | vhd, carga directa a un Managed Disk → Image → VM. Consulta [Ejecutar en Azure](/es-419/azure) |
| **Google Cloud** | raw, `tar czf disk.tar.gz disk.raw && gcloud compute images create` |
| **OpenStack** | raw, `openstack image create --disk-format raw` |
| **AWS** | vmdk, impórtalo como una AMI con VM Import, o compila una AMI nativa con Packer. Consulta [Ejecutar en AWS](/es-419/aws) |
| **Bare metal** | raw, `dd if=disk.raw of=/dev/sdX bs=4M` |

## Verifica la descarga

```bash
curl -L -O https://github.com/soctalk/soctalk/releases/download/v0.2.0/SHA256SUMS.txt
curl -L -O https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.qcow2.xz
sha256sum -c SHA256SUMS.txt --ignore-missing
```

## Tamaño del disco

Todas las imágenes tienen:

- **Tamaño comprimido**: ~600 MB a 1,5 GB según el formato
- **Tamaño aparente descomprimido**: 60 GB
- **Tamaño real en disco tras el primer arranque**: ~3 GB (qcow2/vhdx son dispersos; raw y vhd son de tamaño fijo, pero la mayor parte de los 60 GB son ceros y se comprimen hasta prácticamente nada)

## Compílalo tú mismo

El arnés de Packer se encuentra en [`infra/packer/`](https://github.com/soctalk/soctalk/tree/main/infra/packer). Con KVM y Packer 1.11+ en un host Linux:

```bash
git clone https://github.com/soctalk/soctalk.git
cd soctalk/infra/packer
packer init .
packer build -only="soctalk-demo.qemu.soctalk_demo" .
```

Compila en ~1 minuto en un host moderno con aceleración KVM. Los resultados quedan en `build/dist/`: un archivo por formato. Consulta el [README de Packer](https://github.com/soctalk/soctalk/blob/main/infra/packer/README.md) para la configuración de la semilla de cloud-init y la fuente de la AMI de AWS.

## Flujo de trabajo de CI

`build-packer-images.yml` es exclusivo de `workflow_dispatch`: las compilaciones de Packer no se disparan en cada push porque son lentas y consumen minutos de runner. Dispáralo intencionalmente para una nueva versión:

```bash
gh workflow run build-packer-images.yml -f version=0.2.0
```

El flujo de trabajo ejecuta:

1. **build-wizard**: compilación en Go del binario del asistente de configuración.
2. **build-qcow2**: compilación de Packer que produce los cinco formatos; los comprime con xz; sube cada uno como un artefacto de flujo de trabajo independiente; los adjunta a la GitHub Release en las etiquetas `v*`.
3. **boot-test**: arranca el qcow2 en una VM de KVM nueva, espera a que `soctalk-firstboot` finalice y ejecuta un validador de Playwright. Hace fallar el flujo de trabajo si la imagen está rota, de modo que una versión defectuosa nunca se adjunte a una etiqueta.
