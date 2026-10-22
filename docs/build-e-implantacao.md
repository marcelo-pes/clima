# Build e implantação da aplicação única Clima

Este procedimento substitui o fluxo antigo que distinguia Clima/Clima2. Não faz implantação automática em produção. O diretório canônico é `/Users/pes/CLIMA/Clima/aplicacao`.

## Build limpo no Mac

Requisitos no Mac: Git, Python 3.9+, Node >=22.13, npm, rede e espaço para um store novo. O comando opcional `npm run install:ci` usa o mesmo instalador portátil em um checkout sem node_modules; o build oficial já faz essa instalação em sua exportação isolada. Não são necessários GNU timeout/flock, Docker, dependências antigas, fontes de backups ou acesso SSH ao servidor.

Salve as mudanças em um commit, porque o build exporta **somente arquivos versionados** de `--ref` por `git archive`. Modificações não commitadas não entram no pacote. Execute:

```sh
cd /Users/pes/CLIMA/Clima/aplicacao
python3 deploy/tools/release.py build --output /Users/pes/CLIMA/Builds/Clima-NOVA-IDENTIFICACAO
```

A pasta de saída deve ser nova. O fluxo instala o pnpm fixado no package.json com cache npm novo, executa `pnpm install --frozen-lockfile` com store/cache próprios inicialmente vazios e compila com autenticação real (`mockAuth=false`), independentemente do perfil local. Não muda o lockfile, não aproveita node_modules, não instala dependências no servidor e não executa scripts Linux de preparação no Mac.

Saídas: `clima-linux-x64.tar.gz`, `SHA256SUMS`, árvore `release/`, fonte exportado e provas `install.log`/`install-report.json`. Somente o tar de release deve ser transferido. As dependências/cache/store temporários criados pelo build são removidos após o sucesso, para não acumular gigabytes no Mac. Em falha, a pasta fica preservada para diagnóstico.

## Conteúdo da release e dependências Linux

O pacote inclui:

- `dist/`: aplicação e ativos compilados;
- `runtime/`: servidor HTTP, adaptador SQLite somente para leitura e serviço de câmera;
- `node/bin/node`: **Node 22.23.3 Linux x86_64**, baixado de nodejs.org e verificado pelo SHA-256 fixado no código;
- `collector/`: coletor operacional Python e seus módulos stdlib;
- `start.sh`, metadados, manifesto de hashes e licenças.

Não inclui node_modules Darwin/Linux, compilador, npm, pnpm, fontes TypeScript, banco, backups, imagens da câmera ou segredos. O teste isolado deve demonstrar que o JS compilado executa sem node_modules: não assumir isso apenas por inspeção.

Sistema de destino: Linux x86_64 com glibc >=2.28; para a coleta, Python 3.9+ com sqlite3, fcntl e biblioteca padrão, além de CA certificates e timezone America/Sao_Paulo. Systemd/Nginx são componentes do sistema para agendamento/proxy, não bibliotecas do pacote. Não há instalação npm em produção. O Node vem no pacote e não depende de `/root/CLIMA/Clima/runtime` da instalação antiga.

## Configuração e dados separados

Use `deploy/service.env.example` como modelo para um arquivo privado externo à release. Ele contém caminhos, não os valores das credenciais. Os arquivos privados existentes devem ser copiados deliberadamente, com dono/permissões corretos, para `config/runtime.vars` e `config/collector.vars`; não imprimir valores, não versionar e não removê-los da instalação anterior antes da validação.

- `CLIMA_SQLITE_PATH`: banco persistente existente. Não criar/substituir banco durante atualização.
- `CLIMA_SECRETS_FILE`: arquivo privado do frontend/câmera.
- `CLIMA_COLLECTOR_SECRETS_FILE`: arquivo privado da coleta (antes `.dev.vars`).
- `CLIMA_CAMERA_CACHE_DIR`: cache persistente da câmera.
- `CLIMA_ROOT`: raiz dos dados operacionais/backups/lock da coleta.
- `PORT`: porta local da instância.

O frontend abre SQLite em readOnly/query_only. Somente o coletor operacional escreve no histórico, sob o mesmo lock `CLIMA_ROOT/backups/history-import.lock`. A coleta preserva backup prévio verificado, checkpoints e retomada de falhas; não sobrescreve observações válidas. A base histórica existente precisa estar inicializada; este fluxo não faz importação inicial nem migrations automáticas.

## Instalar e atualizar no Linux (etapa futura autorizada)

Transfira o tar e `deploy/tools/release.py`/`install_release.py` para uma pasta administrativa. Confira o SHA256SUMS, execute `release.py validate` e prepare a release:

```sh
python3 install_release.py clima-linux-x64.tar.gz --root /root/CLIMA/Clima
```

Por padrão, isso cria somente `releases/clima-COMMIT-HASH`. Não altera `current`, serviços, Nginx, configuração, banco ou câmera. Destinos existentes só são reutilizados se os hashes conferirem. Não sobrescreve pastas antigas.

Para a primeira adoção do layout, preservar integralmente a pasta `app` e sua configuração antes de qualquer substituição. A produção de 22/10 continua em `app`; ela **não foi convertida** para `current` nesta etapa. As unidades em `deploy/` são modelos futuros, não foram instaladas no servidor.

Procedimento de troca:

1. Confirmar backup recuperável, memória e porta livre. Manter a instância atual atendendo.
2. Iniciar o candidato da release pelo `start.sh`, com os caminhos persistentes explícitos e `CLIMA_RELEASE_SHA256` igual ao SHA-256 do tar. Usar uma cópia protegida do banco e cache separado na validação; não iniciar outra coleta. O candidato de frontend não escreve no banco.
3. Validar internamente página, ativos, autenticação, períodos/datas, previsão, câmera/sequence/JPEG e integridade do banco. O modo `install_release.py --promote --candidate-url http://127.0.0.1:PORTA` só troca os links `current`/`previous` depois de conferir que o candidato informa o hash do pacote; ele não muda processos nem proxy. Validar o candidato continua sendo obrigatório além desse teste de identidade.
4. Ajustar o Nginx para o candidato e seus ativos, executar `nginx -t`, reload e testes públicos. Conservar os ativos da versão anterior enquanto existirem clientes/conexões que os referenciem. Em erro, restaurar o upstream/configuração anterior, testar e recarregar.
5. Aguardar workers/conexões antigos terminarem antes de parar o frontend anterior. Aplicar o modelo de serviço somente quando ele apontar para a release aprovada e os caminhos privados estiverem preparados. Não reiniciar o servidor.
6. A coleta deve manter **o mesmo nome** `clima-antaisolar-archive.service` e timer, sem criar um segundo agendamento. Não alterar um processo de coleta em execução. O novo modelo chama o coletor da release `current`, usando o mesmo banco, configuração, backups e lock. O workflow antigo que fazia POST de arquivo foi retirado do repositório.

Rollback: o pacote anterior e o link `previous` ficam preservados. Reapontar o proxy para a instância anterior saudável e fazer `nginx -t`/reload. Não restaurar um banco antigo sobre dados atuais para reverter código. Não apagar releases anteriores automaticamente.

## Validação isolada

`.github/workflows/clima-release.yml` compila do Git/lockfile em Ubuntu isolado, sem SSH ou segredos de produção. A referência é o pacote compilado publicado preservado, armazenado em release rascunho apenas para **comparação**; nenhum código dessa referência é incorporado ao novo build.

Os dois pacotes executam com a mesma estação/banco/imagem sintéticos, horário fixo e provedores externos substituídos no processo de teste. Esse preload e as credenciais fictícias não entram na release. São comparados status e JSON de saúde, leituras atuais, 7d/30d/1y/data histórica, estatísticas, condições/previsão, câmera/sequence/JPEG e acesso restrito. Histórico deve fazer zero chamadas Ecowitt e o hash do SQLite deve permanecer igual.

O navegador compara seis abas em desktop e mobile: texto visível, dimensões, screenshots e abertura inicial na previsão, além de ausência do aviso de histórico removido. Testes do coletor verificam backup, lock exclusivo, retomada, idempotência e preservação de valores válidos. Esses testes não garantem disponibilidade futura dos provedores externos nem substituem validação com configuração real antes de uma implantação autorizada.

A referência rascunho é uma dependência dos testes diferenciais históricos, não do build nem da execução. O job tem permissão de leitura/escrita de conteúdo para conseguir ler essa release rascunho, mas não possui etapa de implantação nem credenciais SSH.

## Diferenças identificadas e corrigidas

O runtime antigo não servia os arquivos `/_next/static` sozinho; dependia de alias do Nginx. O runtime novo serve os ativos do próprio pacote, incluindo imagens e HEAD, sem aquele alias. A referência do teste usa um proxy estático que reproduz o Nginx anterior; somente o pacote novo é exigido a executar diretamente.

A comparação visual identificou regras de câmera/timelapse e horário da condição presentes na folha pública, mas ausentes do fonte. Elas foram incorporadas em `app/camera-weather.css`. Também faltavam no Git 12 imagens WebP referenciadas por `lib/weather-condition.ts`; foram obtidas por GET dos URLs públicos do site, verificadas como WebP e versionadas em `public/`. O arquivo `public-weather-assets.json` registra origem e hashes. Nenhum fonte foi recuperado de backups.
