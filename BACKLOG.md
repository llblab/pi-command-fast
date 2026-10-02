# Backlog

## Concurrent validation gate

- Telegram's feature owner must rebuild and validate its current tree after parallel edits settle. Pi 1.0.0 compatibility passed for a consistent isolated source snapshot (`8b92be0f6679c6c1deb86d32f4a9a66cd42a1defbab2d05710845c2191601da7`); later journal edits are not covered by that evidence. This is not a request to take over unrelated Telegram feature work, reconnect transport, or reload the operator session.

## Release gate

- Publish 0.1.0 before dependent usage releases, only with explicit authorization; consumers currently use local `file:` dependencies for tests. Before their publication, restore registry `^0.1.0` dependencies and regenerate/validate registry locks and packed artifacts.
