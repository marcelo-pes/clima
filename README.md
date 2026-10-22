# Clima — AntaiSolar

Aplicação única de clima, histórico meteorológico e câmera HP10. A consolidação de 22/10/2026 usa os artefatos efetivamente publicados do antigo Clima2, sem incorporar melhorias pendentes ou substituir funcionalidades por implementações antigas.

## Produção

- Domínio principal: https://clima.antaisolar.com.br
- `clima2.antaisolar.com.br` continua como hostname compatível da mesma aplicação; não há outra instalação.
- Serviço: `clima-antaisolar.service`.
- Release ativa: `/root/CLIMA/Clima/current` (commit-fonte `8507fa827ab6a58ba8bb7dd769e894bb8f96d652`).
- Serviço: `clima-antaisolar.service` (alias de `clima-antaisolar-release.service`), porta interna `127.0.0.1:8790`.
- Node Linux incluído na release; produção não usa `node_modules`.
- Banco e histórico: `/root/CLIMA/Clima/database/wrangler/v3/d1/miniflare-D1DatabaseObject/`. A aplicação abre o SQLite somente para leitura.
- Câmera: `/var/cache/clima-antaisolar-release-8507fa8`; o cache anterior permanece em `/var/cache/clima-antaisolar`.
- Configurações privadas ativas: `/root/CLIMA/Clima/config/runtime.vars`, `collector.vars` e `service.env`. As cópias `.runtime.vars` e `.dev.vars` da versão anterior permanecem para reversão.

Há uma única coleta: `clima-antaisolar-archive.timer`, diariamente às 23:59 de America/Sao_Paulo, que executa `clima-antaisolar-archive.service` e `/root/CLIMA/Clima/current/collector/ecowitt_history_sync.py`. Ela acessa o mesmo banco diretamente, usa lock e backup prévio e não depende do servidor HTTP. Os scripts operacionais exatos estão em `deploy/coleta/`.

## Fonte, build e implantação

Fonte canônico: `/Users/pes/CLIMA/Clima/aplicacao`.

O fluxo corrigido de build limpo e pacote Linux independente está em [build e implantação](docs/build-e-implantacao.md). Ele exporta um commit do Git, instala pelo lockfile em store novo e inclui o Node Linux fixado. Não reutiliza node_modules da instalação anterior. Os modelos `deploy/` descrevem o layout ativo de releases.

A produção está registrada em [implantação de 22/10/2026](docs/deploy-2026-10-22.md). A versão anterior e a configuração completa foram preservadas para reversão. Configurações privadas, banco, histórico e cache de câmera ficam fora dos pacotes.
