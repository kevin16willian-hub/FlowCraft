# Arquitetura do whiteboard de processos

## Objetivo

O aplicativo permite documentar automacoes de processo, como scripts SAP, em etapas visuais conectadas. Cada etapa possui nome, descricao, entradas, saidas e um print que pode ser revelado no proprio no do fluxo.

## Estrutura atual

```text
src/
  App.tsx                 # Estado das etapas, formulario e integracao com React Flow
  App.css                 # Layout do editor, painel e no customizado
  index.css               # Estilos globais
public/
  process-prints/         # Prints de teste servidos estaticamente pelo Vite
    uploads/               # Prints enviados pelo formulário durante o desenvolvimento
docs/
  ARQUITETURA.md          # Esta decisao arquitetural
```

`App.tsx` mantem uma lista ordenada de `Stage`. Cada item e transformado em um `Node` do React Flow, e as conexoes sequenciais sao recriadas na mesma ordem. Por isso, mover uma etapa no painel esquerdo atualiza imediatamente a ordem visual do processo no quadro.

## Modelo de uma etapa

```ts
type Stage = {
  id: string
  area: string
  title: string
  `App.tsx` mantem listas independentes de areas e de `Stage`. Cada item e transformado em um `Node` do React Flow, e as conexoes sequenciais sao recriadas na mesma ordem. As areas criam raias BPMN horizontais no quadro; cada etapa e posicionada da esquerda para a direita de acordo com sua ordem global e na raia definida pela sua area. O formulario de etapa abre sob demanda para criar uma etapa ou para editar uma existente. Arrastar uma etapa para outro grupo na barra lateral move a etapa para essa raia sem alterar sua posicao na sequencia. Areas podem ser criadas, renomeadas e excluidas; na exclusao, suas etapas sao movidas para a primeira raia restante.
  description: string
  inputs: string
  outputs: string
  imageUrl?: string
}
```

## Prints locais no MVP

Os prints que devem fazer parte do projeto ficam em `public/process-prints/`. Eles podem ser referenciados com um caminho absoluto, por exemplo:

```ts
imageUrl: '/process-prints/sap-login-demo.svg'
```

Ao selecionar um arquivo com duplo clique na area de anexo ou colar uma imagem com `Ctrl+V` depois de clicar nessa area, o aplicativo envia o arquivo ao endpoint local do Vite. O print fica gravado em `public/process-prints/uploads/` e recebe uma URL estavel, por isso continua disponivel depois de recarregar a pagina enquanto o arquivo existir nessa pasta.

O processo atual (areas, etapas e URLs dos prints) tambem e salvo no `localStorage` do navegador. Assim, ao recarregar a pagina no mesmo navegador e endereco, as etapas voltam a apontar para os arquivos armazenados em `uploads/`.

Excluir uma etapa remove a etapa do processo salvo e apaga os prints associados que foram enviados para `uploads/`.

## Evolucao para S3

A proxima camada deve separar o upload da interface por meio de uma porta de armazenamento:

```ts
interface AttachmentStorage {
  upload(file: File): Promise<{ url: string; key: string }>
  remove(key: string): Promise<void>
}
```

No ambiente local, uma implementacao pode apontar para arquivos estaticos. Em producao, o frontend pede ao backend uma URL pre-assinada, envia o arquivo diretamente ao S3 e persiste `url` e `key` junto com a etapa. Credenciais AWS nunca devem ficar no navegador.

## Proximos modulos

1. Extrair `ProcessNode`, `StageForm` e `StageList` para `src/features/process-designer/`.
2. Persistir processos e etapas em uma API, incluindo a posicao manual de cada no.
3. Substituir a sequencia linear por elementos BPMN: evento inicial/final, tarefa, gateway e subprocesso.
4. Adicionar versionamento, autoria e permissao de acesso aos anexos.
