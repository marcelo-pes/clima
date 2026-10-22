# Preservação exata de Clima — 22/10/2026

Este branch congela o estado capturado do servidor 143.244.163.249 após a organização. Não combina mudanças funcionais. A captura não reiniciou, reconstruiu nem reimplantou as aplicações. O branch original `main` e seus commits permanecem intactos; este branch descende do último commit remoto consultado.

## Código que efetivamente executa

- Clima: `/root/CLIMA/Clima/app/dist/server`, executado pelo Wrangler local na porta 8787. O Node fica em `/root/CLIMA/Clima/runtime/node-v22`.
- Clima2: `/root/CLIMA/Clima2/app/runtime/server.mjs` carrega `dist/server/index.js` na porta 8788. O Nginx serve os arquivos estáticos de `Clima2/app/dist/client` e encaminha **ambos** os domínios públicos para 8788. Isso já ocorria antes da organização.
- `dist/` está explicitamente versionado **somente neste branch de preservação**, como código compilado e ativos do aplicativo, arquivo por arquivo, sem arquivo compactado. `deploy/production-manifest.json` permite conferir os hashes exatos. Inclui os arquivos de build presentes no diretório capturado; não contém banco, cache, backups ou exportações de medições.
- Os diretórios `app/`, `lib/`, `public/`, `runtime/` e `scripts/` reproduzem os fontes disponíveis no diretório da aplicação. Alguns fontes e testes eram antigos ou incompletos frente aos artefatos já publicados. **Um rebuild desses fontes não é apresentado como equivalente ao build capturado.** O artefato `dist/` e o runtime são a referência exata para restauração do comportamento em execução. A combinação de correções fica em branch separado.
- A coleta compartilhada efetivamente executa `/root/CLIMA/Clima/scripts/ecowitt_history_sync.py`, com auxiliares da mesma pasta. Sua cópia exata está em `deploy/shared-collector/`. As cópias com hífen de `app/scripts` são históricas e não substituem a coleta ativa.

## Implantação efetiva

`deploy/systemd/` reproduz os units e drop-ins capturados; `deploy/nginx/` reproduz os dois virtual hosts. Os arquivos de implantação na raiz de `deploy/` foram igualmente alinhados aos arquivos ativos. O drop-in da coleta substitui o ExecStart original por `ecowitt_history_sync.py`, com timeout de 40 minutos, memória de 180 MB e CPU de 50%. O timer continua às 23:59 em America/Sao_Paulo.

O Clima2 usa `ProtectHome=read-only`, `ProtectSystem=strict` e `ReadOnlyPaths=/root/CLIMA/Clima/database`. Seu cache de câmera permanece em `/var/cache/clima2-antaisolar` via CacheDirectory. O usuário clima2 tem home `/root/CLIMA/Clima2`. Há ACL de **travessia apenas** em `/root` para clima, clima2 e www-data; `/root/CLIMA` permite travessia. Os links de compatibilidade `/opt/clima-antaisolar` e `/opt/clima2-antaisolar` apontam para as novas pastas. O banco e o Node/dependências são compartilhados e pertencem à instalação Clima.

Credenciais continuam externas: `.dev.vars` no Clima e `.runtime.vars` no Clima2. Os caminhos referenciados nas configurações são intencionais; **os conteúdos desses arquivos não estão neste branch**. Certificados permanecem em `/etc/letsencrypt`. Banco SQLite, históricos de medições, backups e cache não são versionados. Não copiar credenciais para arquivos de implantação.

## Recuperação e validação

O backup privado da operação contém `server-state.tar.gz`, uma cópia SQLite consistente `database.sqlite.gz` com quick_check ok e manifestos SHA-256. O backup completo anterior em `/Users/pes/clima-organization-backup/pre-move.tar.gz` também preserva o runtime Node, dependências e backups antigos. Esses arquivos ficam fora do Git. A restauração de dados deve usar esses backups privados; o Git restaura código e configurações sem credenciais.

A organização foi validada com HTTPS 200 nos dois domínios, APIs meteorológicas 200, estáticos 200, geração exigindo autenticação 401 e gravação pública bloqueada 403. A coleta compartilhada concluiu com código 0 e quick_check ok. A verificação de preservação confere os arquivos contra a captura e os hashes dos artefatos, sem executar a coleta ou alterar a produção nesta etapa.
