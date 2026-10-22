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

## Fonte e build no Mac

Fonte canônico: `/Users/pes/CLIMA/Clima/aplicacao`. Os diretórios históricos adjacentes e os checkouts Clima2 são arquivos de recuperação, não ambientes de produção. Os históricos main e fix/clima2-review-20261005 foram preservados; esta consolidação parte do histórico do frontend efetivamente utilizado.

O fonte foi capturado da instalação funcional antes da retirada dos fontes do servidor. O módulo `lib/camera-presentation.mjs`, ausente nessa captura, foi recuperado do checkout local e sua implementação foi conferida no JavaScript publicado. O build de validação do fonte passou em 22/10/2026.

A produção consolidada usa um pacote portátil dos **artefatos publicados preservados**, não o build de validação. Esses artefatos incluem ajustes históricos aplicados ao JavaScript compilado. O sucesso do build do fonte não demonstra equivalência integral com esses ajustes; antes de uma futura recompilação destinada à produção, comparar interface, períodos, câmera, chamadas externas e consultas históricas. Não promover automaticamente o build de validação.

Build local: `npm run build`, com Node >=22.13 e dependências instaladas pelo lockfile. O perfil `.sites-runtime/execution-profile.json` deve conter `{"executionProfile":"managed-linux"}` para preservar a autenticação real. O runtime de produção inicia com `npm start` e requer `PORT`, `CLIMA_SQLITE_PATH`, `CLIMA_SECRETS_FILE` e `CLIMA_CAMERA_CACHE_DIR`.

Enviar somente `dist`, `runtime`, metadados e manifesto. Não enviar node_modules Darwin, fontes, bancos ou segredos ao servidor. Não executar migrations durante uma troca de artefatos.

## Migração e recuperação

Consulte [a migração de 22/10/2026](docs/consolidacao-2026-10-22.md). Documentos anteriores em `docs/` descrevem etapas históricas e não substituem este mapa de produção. Os antigos modelos exclusivos de implantação Clima2 foram retirados.
