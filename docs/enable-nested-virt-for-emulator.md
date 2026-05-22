# Enabling nested virtualization for the emulator host

The dashboard's **Launch AVD** feature needs the Android Emulator to start on
the machine that runs the host-agent. The Android Emulator requires hardware
acceleration (KVM on Linux, HVF on macOS, WHPX on Windows). If the agent runs
inside a virtual machine, the **underlying hypervisor must expose CPU
virtualization extensions (`vmx` for Intel, `svm` for AMD) to that guest** —
this is called *nested virtualization*.

This document is for the **hypervisor administrator**. The application user
cannot fix this from inside the guest VM. The action happens on the bare-metal
host or in the cloud provider's console.

After this is done, run on the guest VM:

```bash
sudo ./scripts/setup-emulator-host.sh --check
```

If every line is green, Launch AVD is ready to use.

---

## How to tell whether your guest needs this

Run inside the guest VM that's intended to host the emulator:

```bash
grep -E '(vmx|svm)' /proc/cpuinfo && echo "OK: virt extensions exposed" \
                                    || echo "MISSING: nested virt is OFF"
ls /dev/kvm 2>/dev/null && echo "OK: /dev/kvm present"
```

If both checks pass, nothing else to do on the hypervisor side.

---

## KVM / QEMU / libvirt host (most Linux hypervisors, Proxmox)

1. On the bare-metal host, enable nested virt in the kvm module:

   ```bash
   # Intel
   echo "options kvm_intel nested=1" | sudo tee /etc/modprobe.d/kvm-nested.conf
   sudo modprobe -r kvm_intel && sudo modprobe kvm_intel
   cat /sys/module/kvm_intel/parameters/nested   # should print Y

   # AMD
   echo "options kvm_amd nested=1" | sudo tee /etc/modprobe.d/kvm-nested.conf
   sudo modprobe -r kvm_amd && sudo modprobe kvm_amd
   cat /sys/module/kvm_amd/parameters/nested     # should print 1
   ```

2. For each guest VM that should run the emulator, expose the host CPU.

   **libvirt / virsh**: edit the domain XML (`virsh edit <vm>`) and set:

   ```xml
   <cpu mode='host-passthrough' check='partial'/>
   ```

   **Plain QEMU**: add `-cpu host` (or at minimum `-cpu IvyBridge,+vmx`).

   **Proxmox UI**: VM → Hardware → Processors → Type → `host`.

3. Power-cycle the guest (a reboot from inside is not enough — the VM must come
   back up with the new CPU model).

---

## VMware ESXi / Workstation / Fusion

1. Power off the guest.
2. Edit VM settings → CPU.
   - **ESXi/vCenter**: tick *"Expose hardware-assisted virtualization to the
     guest OS"*. CLI equivalent: `vhv.enable = "TRUE"` in the `.vmx`.
   - **Workstation / Fusion**: tick *"Virtualize Intel VT-x/EPT or AMD-V/RVI"*.
3. Power the guest back on.

---

## Hyper-V

```powershell
Set-VMProcessor -VMName <name> -ExposeVirtualizationExtensions $true
```

The VM must be off when this runs. Then start it.

---

## Major cloud providers

| Provider | What to do |
| --- | --- |
| **GCP** | Create the disk image and instance with the `enable-nested-virtualization` flag. See <https://cloud.google.com/compute/docs/instances/nested-virtualization/overview>. Most CPU platforms support it on N1/N2/C2 instances. |
| **AWS** | Only bare-metal (`.metal`) instance families have `vmx`/`svm` exposed. Standard EC2 does not. Either use a `.metal` instance or run the agent on a non-AWS machine. |
| **Azure** | Use a VM size that supports nested virt (Dv3/Ev3/Dv4/Ev4 family and newer). Set `properties.virtualMachineScaleSet.virtualMachineProfile.hardwareProfile` accordingly. Most modern sizes work out of the box. |
| **Hetzner Cloud** | Not supported on shared CPU instances. Use a Hetzner *dedicated* server. |
| **DigitalOcean / Linode / Vultr** | Generally not supported on regular droplets. Pick "premium dedicated CPU" tiers; verify with `cat /proc/cpuinfo` after provisioning. |

---

## Apple Silicon hosts

KVM is Linux-only; macOS uses the Hypervisor framework (HVF). On an
Apple-silicon Mac, run the host-agent natively (no Docker), install the SDK
with an `arm64-v8a` system image, and create the AVD with
`SDK_ABI=arm64-v8a`:

```bash
SDK_ABI=arm64-v8a SDK_VARIANT=google_apis \
  sudo ./scripts/setup-emulator-host.sh --update-env
```

---

## After the admin is done

On the guest VM (`scm-101` in our case):

```bash
sudo systemctl restart emulator-host-agent
sudo ./scripts/setup-emulator-host.sh --check
```

Expected output ends with:

```
 All checks passed. Launch AVD in the dashboard should work.
```

If the dashboard is on a different machine, restart the controller so it
re-reads `.env`:

```bash
docker compose up -d --no-deps --pull never emulator-controller
```

Open the dashboard → **Add emulator** → **Launch AVD** → the preflight warning
banner should disappear and clicking Launch AVD should start the boot.
