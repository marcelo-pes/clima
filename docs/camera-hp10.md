# Câmera Ecowitt HP10

## Fonte e campos confirmados

A HP10 da conta Ecowitt foi localizada como `HP10`, dispositivo `360893` (tipo `2`, câmera). A estação meteorológica consultada separadamente é `BAURU SUL`, dispositivo `251816` (tipo `1`). Não registrar MACs ou credenciais neste documento.

Na API Cloud Ecowitt v3, `GET /device/real_time` com `call_back=camera` retorna `data.camera.photo.time` (Unix em segundos) e `data.camera.photo.url`. A resposta não trouxe sequência de fotos nem vídeo. A URL mais recente foi baixada no servidor como JPEG e validada; uma captura observada tinha 100.743 bytes e horário 15:01:40 em America/Sao_Paulo, em 06/10/2026. O URL entregue pela Ecowitt fica apenas no servidor.

A API local oficial da HP10 documenta `GET http://192.168.4.1/capture`, que retorna `image/jpeg`. Essa interface exige acesso à rede local da câmera e não é usada pelo VPS. O manual documenta envio para hospedagem Ecowitt no máximo a cada cinco minutos e diz que o serviço organiza as fotos do dia e gera vídeo time lapse após 24 horas; a API Cloud v3 inspecionada só expõe a foto recente. Não há endpoint documentado/confirmado para consultar o vídeo time lapse ou a sequência pela API v3.

Referências oficiais:

- [HP10 Application Programming Interface — imagem local `/capture`](https://oss.ecowitt.net/uploads/20241127/HP10%20Application%20Programming%20Interface.pdf)
- [Manual da HP10 — upload, frequência e time lapse](https://osswww.ecowitt.net/uploads/20220909/HP10%20manual.pdf)
- [Página oficial da HP10 e documentos Cloud API](https://www.ecowitt.com/api/quickstart/product?id=279)
- [Documentação Cloud API da Ecowitt](https://doc.ecowitt.net/web/)

## Serviço implementado

`runtime/camera-service.mjs` executa no processo do servidor, restaura o cache no boot e inicia uma consulta em segundo plano a cada cinco minutos, sem depender de visitantes, acompanhando o intervalo solicitado para a HP10. A página consulta somente o cache local `/api/camera`; a imagem é servida por `/api/camera/image`. Credenciais e URL original não são enviados ao navegador nem escritos nos logs. A URL de imagem só é aceita por HTTPS nos hosts oficiais de imagens Ecowitt e a resposta é limitada a 5 MiB e validada como JPEG.

Uma nova imagem só é baixada quando muda `photo.time`; o mesmo timestamp reutiliza os bytes e mantém a análise armazenada. A captura/classificação fica em `/var/cache/clima2-antaisolar` (systemd `CacheDirectory`), fora do SQLite. Ao reiniciar o processo, metadados e JPEG são restaurados antes de aceitar visitantes. A captura é considerada atual por até vinte minutos (quatro janelas de consulta); depois desse limite o endpoint da imagem atual deixa de servi-la e a interface usa o fundo meteorológico alternativo.

O mesmo coletor mantém os doze JPEGs mais recentes, identificados pelo timestamp original da Ecowitt (`photo.time`), ordenados do mais antigo para o mais novo e sem duplicar capturas. O cache é podado após cada captura nova e restaurado no boot. `/api/camera/sequence` retorna somente metadados e URLs locais; `/api/camera/sequence/{photo.time}` serve os arquivos arquivados. Essas rotas não consultam a Ecowitt. A aba Previsão consulta a sequência ao ficar ativa e a atualiza no máximo a cada minuto, sem depender dela para renderizar os demais cards. As imagens são carregadas com prioridade baixa em segundo plano, reproduzidas a aproximadamente um segundo por quadro e mantêm proporção. Os horários são formatados no fuso de Brasília e o intervalo vem dos timestamps extremos realmente disponíveis; doze capturas separadas por cinco minutos cobrem normalmente 55 minutos entre a primeira e a última. Movimento reduzido inicia a reprodução pausada.

No endpoint de sensores, `call_back=rainfall_piezo,rainfall` consulta `rain_rate` com `rainfall_unitid=12`; o campo é tratado apenas como taxa de chuva da estação. `rainConfirmed` só é true para taxa positiva acompanhada por timestamp de sensor recente (até três minutos, com tolerância de um minuto no futuro). Acumulado diário não é usado para inferir chuva neste instante. A UI mostra horários da foto e da leitura do sensor em `America/Sao_Paulo`.

## Limitação de análise visual

O projeto e o VPS não têm classificador de imagem ou modelo de visão instalado/configurado. O servidor mantém `visualCondition: null` e `analysisStatus: classifier_not_configured`; não deduz céu limpo/noite pela baixa luminosidade. Enquanto a classificação for indeterminada, o fundo continua sendo o meteorológico alternativo e a foto HP10 aparece separada, com timestamp e estado indeterminado. O mesmo JPEG em cache será elegível como fundo apenas quando houver uma classificação automática válida. Uma análise/classificação automática, os rótulos coerentes e o uso da câmera como fundo dependem de adicionar um modelo local ou um serviço de visão (incluindo credencial e eventual cobrança). Nenhum serviço pago ou nova credencial foi adicionado.

## Teste

Executar `node scripts/camera-service.test.mjs`. O teste cobre descoberta da câmera, cache persistente ao reiniciar, reutilização dos bytes para captura repetida, novo timestamp, ausência de URL/segredo no JSON, JPEG, confirmação de chuva pela taxa atual, expiração em vinte minutos e fallback indisponível.
