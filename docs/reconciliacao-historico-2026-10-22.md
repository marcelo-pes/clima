# Reconciliação isolada do histórico do Clima

Este branch é uma proposta validada separadamente. **Não foi implantado.** Os serviços, o banco em produção, os branches originais e os snapshots de preservação não foram alterados.

## Referências preservadas

- Clima em execução: branch [preservacao/clima-20261022](https://github.com/marcelo-pes/clima/tree/preservacao/clima-20261022), commit `cb2c75dddf4cd5f32743e4026af2b63aeea3c3ea`.
- Clima2 em execução: branch [preservacao/clima2-20261022](https://github.com/marcelo-pes/clima/tree/preservacao/clima2-20261022), commit `ab3a59ef7227a4e68820c34be301db9b0464b9c4`.
- Base remota desta combinação: `main` no commit `028f5dbd2893ffe43ead98578b048f5100e23aef`. Os sete commits posteriores ao HEAD local antigo do Clima permanecem na ancestralidade; não houve pull indiscriminado, reset destrutivo ou force push.

A decisão foi separar primeiro os snapshots exatos e somente depois preparar esta combinação. Este branch trata o conflito da leitura histórica do **Clima**; não mistura o frontend Clima2 com a aplicação legada.

## Diferenças funcionais documentadas

| Tema | Snapshot Clima em execução | Combinação proposta |
|---|---|---|
| Histórico fechado | Prioriza o cache e lê checkpoints marcados completos | Preserva as correções remotas: prioriza checkpoints recuperados e aproveita leituras válidas em blocos parciais |
| Completude | Rótulo do checkpoint e continuidade dos intervalos | Verifica a grade esperada de cada sensor, incluindo fase de amostragem; não inventa observações |
| Marcador de ausência | Fontes antigos podiam substituir valores por `-` | Um marcador ausente não substitui leitura válida, incluindo zero real |
| Janela de sete dias | Sete dias civis completos anteriores à data de referência, em Brasília | Mantém exatamente essa regra, com chave de cache e recorte usando os mesmos instantes |
| Períodos arquivados | Consulta restrita ao banco | Mantém a restrição, inclusive sem credenciais Ecowitt; erro de banco retorna indisponibilidade sem fallback externo |
| Dia atual e comparação explícita | Consultas atuais e modo `source=api` disponíveis | Continuam disponíveis; a restrição histórica não impede a comparação explícita em `/confere` |
| Coleta agendada | Executa os scripts externos ao app, já atualizados | Preserva as correções remotas e os caminhos reais; não troca a implementação ativa por cópias antigas de app/scripts |

As cópias antigas de importação/sincronização dentro do app estavam atrás dos scripts efetivamente utilizados pela coleta. A implementação ativa coincidiu com a versão remota corrigida, salvo caminhos. A combinação preserva a regra de **não substituir observação válida já arquivada**, preenchendo somente valores ausentes/inválidos. O teste local antigo que esperava sobrescrever uma observação válida foi alinhado a essa garantia já vigente na coleta; seu original está no backup privado.

As mudanças locais de consulta estrita, intervalos, `/confere`, autorização da rota local de arquivo, interface e caminhos foram incorporadas sem reintroduzir o workflow Ecowitt aposentado no `main`. As correções remotas de abertura na previsão, retirada do banner antigo, cache do service worker, completude e retomada permanecem.

## Implantação documentada, não aplicada

`deploy/systemd/` e `deploy/nginx/` reproduzem os arquivos efetivos capturados em `/etc`. Os exemplos da raiz de `deploy/` também refletem `/root/CLIMA/Clima`, `/root/CLIMA/Clima2`, portas 8787/8788, `ProtectHome=read-only`, proteção somente leitura do banco, cache da câmera e drop-in da coleta com timeout de 40 minutos, memória de 180 MB e CPU de 50%.

`deploy/shared-collector/` conserva o código realmente usado pela coleta. Os scripts dessa pasta correspondem à pasta externa `/root/CLIMA/Clima/scripts`, não ao diretório app/scripts. Credenciais continuam em arquivos externos, banco e dependências compartilhados pertencem à instalação Clima. Ambos os domínios públicos continuam apontando para o frontend Clima2, conforme a implantação existente.

Não há artefato compilado congelado neste branch: o `dist/` gerado na validação permanece ignorado e não foi enviado ao servidor. Os artefatos exatos capturados estão exclusivamente nos branches de preservação e seus manifestos.

## Validação isolada

Executada em cópia local, com fixtures sintéticas e banco SQLite em memória, sem usar credenciais nem medições da produção:

- `node scripts/history-completeness.test.mjs`: grades de quatro ciclos, sensor ausente, JSON inválido, blocos parciais válidos, prioridade sobre cache antigo e preservação de zero real.
- `node scripts/weather-database-only.test.mjs`: nove combinações de período/visão arquivada sem chamadas externas, lacunas reais, dia atual, comparação explícita e falha fechada quando o banco está indisponível.
- `node scripts/history-window.test.mjs`: sete dias completos em Brasília, limites de mês/ano, fevereiro bissexto, datas inválidas e chaves de cache exatas.
- `python3 scripts/archive-revisit.test.py`: retomada limitada de blocos parciais e preservação de observações.
- `python3 scripts/history-point-merge.test.py`: não sobrescrita de valor válido e preenchimento de ausência.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: aprovado.
- `npm run build`: build Vinext/Vite aprovado para todas as rotas.

Todos os testes acima passaram. A futura implantação desta combinação exige decisão própria; esta operação apenas preservou, preparou e validou branches.

Os testes funcionais de completude, consulta exclusiva ao banco e intervalos foram também repetidos com sucesso no Node **v22.23.3** do servidor, em `/root/CLIMA/_organizacao/validacao-historico-20261022`, usando apenas fixtures sintéticas. A checagem TypeScript adicional nessa pasta foi encerrada por pressão de memória; não é contabilizada como aprovada no servidor. A tipagem e o build aprovados acima foram executados localmente com Node v24.21.0. Os serviços conservaram os mesmos PIDs, sem reinícios; não houve instalação ou ativação da combinação.
