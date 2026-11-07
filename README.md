# FlowCraft

O FlowCraft é um editor visual de quadros para desenhar e colaborar em fluxogramas de processos, mapas de fluxo de valor (VSM) e arquiteturas AWS. Os diagramas são montados em uma tela livre com elementos conectáveis, formas, textos e notas.

## Recursos

- **Processos:** elementos de início, fim, etapa e gateway, organizados em pools, raias e fases. Conexões podem ter rótulos; saídas de gateways recebem ramificações “Sim” e “Não”.
- **VSM e diagramas livres:** use formas, conexões e anotações para representar fluxos de valor ou outros processos.
- **Arquiteturas AWS:** quadros AWS com catálogo de ícones de serviços, recursos e grupos, incluindo contêineres como contas, regiões, VPCs e sub-redes.
- **Edição do quadro:** arrastar e soltar, alinhamento com guias, zoom, desfazer/refazer, pesquisa e exportação da visualização como imagem.
- **Importação:** criação de diagramas a partir de Mermaid.
- **Persistência e colaboração:** quadros e alterações salvos pela API; compartilhamento com permissões, times, presença em tempo real, chat, comentários e revisões.
- **Histórico:** versões, branches, tags e comparação de alterações.

> O editor fornece elementos e recursos para criar diagramas no estilo BPMN e VSM. Isso não implica validação de conformidade BPMN nem um modelo VSM especializado.

## Tecnologias

- React 19, TypeScript e Vite
- React Flow (`@xyflow/react`) para o canvas
- Node.js para a API
- Microsoft Entra ID para autenticação, SQL Server para dados e Amazon S3 para anexos

## Requisitos

- Node.js e npm compatíveis com as dependências do projeto
- Para usar a aplicação completa: acesso a uma instância SQL Server, uma aplicação Microsoft Entra ID e um bucket S3 configurado

## Instalação e execução

Instale as dependências:

```bash
npm install
```

O modo de desenvolvimento executa o frontend com Vite na porta padrão `5173`. As chamadas `/api` são encaminhadas para o backend em `http://127.0.0.1:3004`.

```bash
npm run dev
```

Para usar os recursos da aplicação que dependem da API, configure as variáveis de ambiente indicadas abaixo e inicie o backend em outro terminal:

```bash
npm run start
```

O backend carrega as variáveis de um arquivo `.env` na raiz ou do ambiente do processo. Ele exige credenciais do Microsoft Entra ID, conexão com SQL Server e bucket S3. Credenciais AWS são obtidas pela cadeia padrão do AWS SDK (por exemplo, perfil local ou role da infraestrutura); não as coloque no frontend.

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `AZURE_CLIENT_ID` | Sim | ID do cliente da aplicação Entra ID |
| `AZURE_CLIENT_SECRET` | Sim | Segredo da aplicação Entra ID |
| `AZURE_TENANT_ID` | Sim | ID do tenant Entra ID |
| `DB_SERVER` | Sim | Host do SQL Server |
| `DB_DATABASE` | Sim | Banco de dados |
| `DB_USERNAME` | Sim | Usuário do banco |
| `DB_PASSWORD` | Sim | Senha do banco |
| `S3_BUCKET` | Sim | Bucket usado para anexos |
| `AWS_REGION` | Não | Região AWS; padrão `sa-east-1` |
| `PORT` | Não | Porta do backend; padrão `3004` |
| `HOST` | Não | Interface de rede do backend; padrão `127.0.0.1` |
| `APP_URL` | Não | URL pública da aplicação |
| `SESSION_SECRET` | Recomendado | Segredo persistente para sessões; sem ele, as sessões são invalidadas ao reiniciar o servidor |

O schema e os dados iniciais do banco são definidos em [`docs/seed_sql.sql`](docs/seed_sql.sql). Depois de configurar o acesso ao banco, execute:

```bash
npm run db:seed
```

## Comandos

| Comando | Descrição |
| --- | --- |
| `npm run dev` | Inicia o servidor de desenvolvimento Vite |
| `npm run start` | Inicia a API e serve a aplicação compilada |
| `npm run build` | Executa a verificação TypeScript e gera a versão de produção em `dist/` |
| `npm run preview` | Serve localmente a versão compilada |
| `npm run lint` | Executa o Oxlint |
| `npm test` | Executa os testes da API e utilitários |
| `npm run db:seed` | Aplica o seed/schema SQL inicial |
| `npm run db:prune-prints` | Remove prints antigos conforme a rotina do projeto |
| `npm run icons:aws` | Reconstrói o manifesto do catálogo de ícones AWS |

## Estrutura do projeto

```text
src/                  Aplicação React, editor, componentes e utilitários
server/               API Node.js, autenticação, persistência e colaboração
public/aws-icons/     Ícones AWS e manifesto do catálogo
docs/                 Documentação e SQL inicial do banco
scripts/              Scripts de manutenção e geração
templates/            Quadros de exemplo
```

## Armazenamento de imagens

No desenvolvimento com Vite, imagens anexadas pelo editor são gravadas localmente em `public/process-prints/uploads/`. No backend, os anexos são armazenados no S3 configurado. Evite adicionar credenciais ou arquivos sensíveis ao repositório.
