# Event model

Canonical runtime log v1 uses one event per line:

```text
0.000100 [INFO] system boot
2.203100 [WARN] sensor timeout
```

The timestamp is relative seconds with up to nine fractional digits and is converted exactly to `timestamp_ns`. Supported severities are `DEBUG`, `INFO`, `WARN`, `ERROR`, and `FAULT`.

Each valid line becomes a generic `log` event with the parsed severity, message, and original line in `attributes`. Invalid timestamps, unknown severities, malformed separators, blank lines, and invalid UTF-8 are skipped with line-numbered diagnostics; later valid lines are still imported.
