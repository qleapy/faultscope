# Symbolication

`faultscope-core::SymbolProvider` keeps analysis independent of artifact formats. The current provider reads ELF symbol tables and optional DWARF line tables; missing symbols, missing DWARF, and addresses outside the image return `null` fields rather than failing.

```sh
faultscope symbolicate --elf firmware.elf 0x08004567
```

The command writes one JSON object to stdout. Invalid or truncated artifacts are reported on stderr with exit code 2.
