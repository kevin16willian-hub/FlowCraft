# Arquitetura de persistencia

## Modo de desenvolvimento

`npm run dev` usa a camada de API local em `src/api/local.ts`, sem encaminhar chamadas para um backend. Quadros, grafos, comentarios, historico e prints sao guardados no `localStorage` do navegador, sob a chave `flowcraft:local-api:v1`. O salvamento automatico do editor continua ativo.

Prints sao guardados como data URLs junto aos dados locais. O limite e de 1 MB por imagem, e o armazenamento total depende do navegador. Os dados sao especificos da origem e do perfil do navegador; limpar os dados do site os remove. O modo local nao fornece autenticacao, compartilhamento, times, revisoes ou colaboracao em tempo real.

## Backend

Fora do modo de desenvolvimento, `src/api/client.ts` envia chamadas para a API Node. O SQL Server persiste quadros e dados relacionados; os anexos sao armazenados no bucket S3. Credenciais de nuvem ficam somente no backend, nunca no navegador.

## Persistencia no modo de desenvolvimento

Ao executar `npm run dev`, a camada de API local persiste quadros, grafo, comentarios, historico e prints no `localStorage` do navegador, sob a chave `flowcraft:local-api:v1`. O modo nao exige backend, banco de dados ou credenciais de nuvem. A persistencia e especifica ao navegador e a origem; limpar os dados do site remove esses dados. Prints usam o mesmo limite de 1 MB por arquivo do backend e estao sujeitos ao limite de armazenamento do navegador.

O modo local e individual: autenticacao, compartilhamento, times, revisoes e colaboracao em tempo real requerem o backend.

## Persistencia no backend

Com o build de producao e a API Node, grafo e metadados sao salvos no SQL Server; prints sao armazenados no bucket S3 configurado. Credenciais AWS nunca ficam no navegador.

## Proximos modulos

1. Extrair `ProcessNode`, `StageForm` e `StageList` para `src/features/process-designer/`.
2. Persistir processos e etapas em uma API, incluindo a posicao manual de cada no.
3. Substituir a sequencia linear por elementos BPMN: evento inicial/final, tarefa, gateway e subprocesso.
4. Adicionar versionamento, autoria e permissao de acesso aos anexos.
