# Crash format

The current canonical input is `faultscope-crash-v1` JSON. It contains a target descriptor plus generic register and namespaced fact collections.

```json
{
  "format": "faultscope-crash-v1",
  "target": {
    "architecture": "arm.cortex-m",
    "execution_environment": "baremetal",
    "endian": "little",
    "pointer_width": 32
  },
  "registers": [{ "id": "arm.pc", "value": "0x08004567" }],
  "facts": { "arch.arm.cortex_m.cfsr": "0x00008200" }
}
```

Unknown architecture IDs and namespaced facts remain valid model data. Analysis fails explicitly when the format version or a required provider is unsupported. Register values must be hexadecimal strings; malformed JSON or values produce an error rather than partial analysis.
