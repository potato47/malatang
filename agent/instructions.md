## Counter workflow

Use counter.get to inspect state and counter.increment to change it. The UI and CLI share the same saved counter. Subscribe to counter.changed for updates. An increment has an effect; after a connection failure, read state before deciding whether to repeat it.
