# Event model

Canonical runtime log v1 uses one event per line:

```text
0.000100 [INFO] system boot
2.203100 [WARN] sensor timeout
```

The timestamp is relative seconds with up to nine fractional digits and is converted exactly to `timestamp_ns`. Supported severities are `DEBUG`, `INFO`, `WARN`, `ERROR`, and `FAULT`.

Each valid line becomes a generic `log` event with the parsed severity, message, and original line in `attributes`. Invalid timestamps, unknown severities, malformed separators, blank lines, and invalid UTF-8 are skipped with line-numbered diagnostics; later valid lines are still imported.

Environment events use the same file and clock domain:

```text
0.101200 [EVENT] task_switch task.sensor SensorTask scheduled
2.180000 [EVENT] isr_enter isr.adc ADC interrupt entered
2.181000 [EVENT] isr_exit isr.adc ADC interrupt exited
```

The fields after `[EVENT]` are:

```text
kind execution_entity message
```

`kind` and `execution_entity` are provider-neutral identifiers containing letters, digits, `.`, `_`, or `-`. Use `-` when an event has no execution entity. The core preserves arbitrary kinds; environment providers interpret only their own explicit event evidence.

The initial FreeRTOS provider recognizes entity prefixes for visualization:

- `task.*` becomes a task lane
- `isr.*` becomes an ISR lane
- other explicit identifiers become generic context lanes

The Phase 13 demo uses `task_create`, `task_switch`, `isr_enter`, `isr_exit`, `mutex_wait`, `mutex_unlock`, and `watchdog_feed`. These remain string identifiers so adding an RTOS or vendor event does not change the canonical model.
