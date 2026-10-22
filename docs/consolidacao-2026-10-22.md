# Consolidação Clima — 22/10/2026

A versão pública na porta 8788 foi preservada em `/Users/pes/CLIMA/Migracao-20261022/pre-migracao.tar.gz`, incluindo a instalação anterior Clima, os artefatos Clima2, configurações privadas, serviços, Nginx e câmera. O manifesto `backup-verificado.json` registra SHA-256 e leitura integral dos arquivos. Os bancos e históricos não foram movidos nem apagados; os backups completos anteriores permanecem em `/Users/pes/CLIMA/Backups/`.

Foi criado `clima-linux-x64.tar.gz` a partir dos artefatos publicados. O pacote contém `dist`, runtime JavaScript, package.json e manifesto com hashes. Nenhum binário ou dependência do Mac foi enviado. O runtime Node e as dependências Linux existentes foram reutilizados.

O serviço Clima antigo na 8787 não tinha referências de tráfego público e a coleta acessava SQLite diretamente. Foi parado antes de iniciar a terceira instância, para resolver a margem de memória inicialmente apertada (193 MiB disponíveis, sem swap). Com o Clima novo e o frontend antigo em paralelo, havia 465 MiB disponíveis. Após retirar o Clima2, havia 537 MiB.

A nova instância foi iniciada em 127.0.0.1:8789, usuário clima, com banco em modo somente leitura e cache separado da câmera, copiado do cache funcional. Página, saúde, períodos 24h/7d/30d/1y, data histórica, câmera, sequência e JPEG, além das restrições de arquivo e geração, passaram. As respostas históricas foram comparadas: semanal/data passada idênticas; mensal/anual variaram somente nos instantes calculados da janela.

O Nginx passou em `nginx -t` e recebeu reload, com restauração da configuração anterior em caso de erro nos testes públicos. Ambos os domínios foram validados. Os workers antigos terminaram e não havia conexões estabelecidas na 8788 antes de parar e desabilitar o serviço Clima2. A instalação duplicada só foi removida após verificar processos, descritores de arquivos, Nginx e a preservação local. Não houve reinicialização do servidor.

Estado final: `/root/CLIMA/Clima/app`, serviço `clima-antaisolar.service`, porta 8789. Uma coleta agendada: `clima-antaisolar-archive.timer`. O hostname clima2 permanece apenas como compatibilidade DNS/TLS para a aplicação única. A conta de sistema antiga pode permanecer inativa; nenhum processo ou instalação depende dela.

## Recuperação

As cópias privadas ficam exclusivamente no Mac. Não publicar os arquivos tar de preservação, credenciais nem dados de respostas. `evidencias-e-cache-final.tar.gz` preserva os scripts operacionais, o serviço consolidado, o cache final antigo e registros de validação. `clima-linux-x64.tar.gz` permite reinstalar os artefatos consolidados. Os artefatos anteriores do Clima estão também em `/root/CLIMA/Clima/releases/consolidacao-20261022/anterior/`.

Para recuperar a versão anterior, extrair a instalação Clima2 do backup local para um diretório de recuperação, reutilizar o Node/dependências Linux compartilhados e restaurar suas configurações privadas com permissões corretas. Iniciar em porta livre, validar internamente, restaurar o Nginx preservado em `nginx-anterior.json` somente após o backend anterior estar saudável, executar `nginx -t` e reload. Manter o Clima atual até drenar as conexões. Não restaurar um banco antigo sobre o banco ativo.

O build de validação do fonte não foi usado para trocar a produção, pois ajustes históricos nos artefatos compilados exigem comparação adicional antes de futuras recompilações. Esta migração preservou os artefatos funcionais, e não incorporou melhorias pendentes.
