# Organização Clima / Clima2

Clima: /root/CLIMA/Clima
Clima2: /root/CLIMA/Clima2

Cada pasta preserva app, histórico de releases, backups, scripts e configurações próprias. Artefatos administrativos identificados em /root foram organizados em administration no respectivo projeto.

Recursos compartilhados: Clima/database (SQLite), Clima/runtime/node-v22 (Node) e Clima/app/node_modules. Clima2 consulta o mesmo banco em modo somente leitura e usa o mesmo runtime e dependências. Os dois domínios já apontavam para o frontend Clima2 antes da mudança; essa configuração foi preservada.

Os serviços systemd clima-antaisolar, clima2-antaisolar e clima-antaisolar-archive foram atualizados. A coleta diária compartilhada continua agendada para 23:59 America/Sao_Paulo. Não havia crontab do root nem cron específico dos projetos. Nginx e certificados continuam nos diretórios padrão /etc; o cache da câmera permanece em /var/cache/clima2-antaisolar. O cadastro de diretório pessoal do usuário clima2 foi atualizado.

O acesso a /root foi concedido por ACL apenas para travessia aos usuários dos serviços e do Nginx. O serviço Clima2 usa ProtectHome=read-only para poder ler a nova localização e mantém o banco somente leitura. Links /opt/clima-antaisolar e /opt/clima2-antaisolar preservam compatibilidade de referências históricas; os serviços e o proxy usam diretamente os novos caminhos.

Backup completo anterior à mudança: /Users/pes/clima-organization-backup/pre-move.tar.gz, na máquina que executou a operação. Gzip e arquivos essenciais verificados, com SHA-256 salvo ao lado. Configurações originais, estado de reversão e resultados das verificações estão em _organizacao/rollback-20261022T143938Z. Para desfazer: python3 /root/CLIMA/_organizacao/rollback.py /root/CLIMA/_organizacao/rollback-20261022T143938Z

Validações: hashes de todos os bancos idênticos antes de reiniciar os serviços; integridade inicial do banco válida; HTTPS público e arquivos estáticos HTTP 200 nos dois domínios, certificados válidos, HTTP redirecionando para HTTPS; APIs meteorológicas de 24 horas e 7 dias e consultas à fonte atual HTTP 200 nos dois backends. API de geração preserva autenticação HTTP 401 sem sessão; gravação pública de arquivo preserva bloqueio HTTP 403. Coleta compartilhada executada com sucesso após a mudança, seguida de comparação das contagens históricas. Serviços ativos e timer habilitado.

Nenhum diretório de outro projeto foi movido. Credenciais não foram incluídas neste relatório.
