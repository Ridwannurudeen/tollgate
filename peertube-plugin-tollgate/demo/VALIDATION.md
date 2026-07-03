# PeerTube Demo Validation

Status: BLOCKED-Docker-unavailable

Attempted command:

```powershell
docker --version
```

Observed result:

```text
docker : The term 'docker' is not recognized as the name of a cmdlet, function, script file, or operable program.
```

The local Docker-backed PeerTube validation could not be run in this environment.
No plugin install, settings render, download-filter shape, watch-page DOM, or
router endpoint claims are made from this run.

The plugin unit tests remain the executable local gate until Docker is available.
