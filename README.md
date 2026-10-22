# Clima — AntaiSolar

Aplicação única de clima, histórico meteorológico e câmera HP10. A consolidação de 22/10/2026 usa os artefatos efetivamente publicados do antigo Clima2, sem incorporar melhorias pendentes ou substituir funcionalidades por implementações antigas.

## Produção

- Domínio principal: https://clima.antaisolar.com.br
- `clima2.antaisolar.com.br` continua como hostname compatível da mesma aplicação; não há outra instalação.
- Serviço: `clima-antaisolar.service`.
- Diretório: `/root/CLIMA/Clima/app`.
- Porta interna: `127.0.0.1:8789`, acessada pelo Nginx.
- Node Linux: `/root/CLIMA/Clima/runtime/node-v22/bin/node`.
- Dependências Linux: `/root/CLIMA/Clima/app/node_modules`, preservadas da instalação funcional.
- Banco e histórico: `/root/CLIMA/Clima/database/wrangler/v3/d1/miniflare-D1DatabaseObject/`. A aplicação abre o SQLite somente para leitura.
- Câmera: `/var/cache/clima-antaisolar`. O cache anterior está preservado e inativo em `/var/cache/clima-antaisolar-anterior-20261022`.
- Configurações privadas: `.runtime.vars` e `.dev.vars` no diretório da aplicação. Não versionar nem substituir essas configurações.

Há uma única coleta: `clima-antaisolar-archive.timer`, diariamente às 23:59 de America/Sao_Paulo, que executa `clima-antaisolar-archive.service` e `/root/CLIMA/Clima/scripts/ecowitt_history_sync.py`. Ela acessa o banco diretamente, usa lock e backup prévio e não depende de um servidor na porta 8787. Os scripts operacionais exatos estão em `deploy/coleta/`.

## Fonte, build e implantação

Fonte canônico: `/Users/pes/CLIMA/Clima/aplicacao`.

O fluxo corrigido de build limpo e pacote Linux independente está em [build e implantação](docs/build-e-implantacao.md). Ele exporta um commit do Git, instala pelo lockfile em store novo e inclui o Node Linux fixado. Não reutiliza node_modules da instalação anterior. Os modelos `deploy/` descrevem um layout futuro de releases; não foram aplicados à produção.

A produção atual continua utilizando os artefatos preservados durante a [consolidação](docs/consolidacao-2026-10-22.md). Corrigir e validar o fluxo não promove automaticamente o build novo. Configurações privadas, banco, histórico e câmera ficam fora dos pacotes.
