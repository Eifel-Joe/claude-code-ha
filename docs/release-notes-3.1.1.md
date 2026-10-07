## Clear message instead of a silent hang on older virtual CPUs

Claude Code needs an x86-64-v2 CPU (SSE4.2 and POPCNT). On a Proxmox VM with the default CPU type `kvm64` it used to hang without a word. Claude Workbench now checks the CPU and tells you in the log and the terminal what is missing and how to fix it: set the VM's CPU type to `host` (or at least `x86-64-v2-AES`) and restart the VM. The shell, `ha`, `gh` and your packages keep working meanwhile.

No change on other hardware. Full details: [CHANGELOG](https://github.com/Eifel-Joe/claude-workbench/blob/main/claude-workbench/CHANGELOG.md).
