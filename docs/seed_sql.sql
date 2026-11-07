/* =====================================================================
   FlowCraft - seed do banco (SQL Server / T-SQL)
   Banco: rpa_area_finance_internal_P   |   Schema: flowcraft

   Modelo:
   - users               : usuario identificado pelo unumber do SSO (email u123456@companhia.com -> U123456)
   - boards              : quadros (cada quadro e um projeto/mapeamento independente)
   - nodes / edges       : canvas livre (working copy do quadro, igual ao "working tree" do git)
   - attachments         : prints das etapas (arquivo fica no S3, aqui so a referencia)
   - commits/branches/tags : versionamento estilo git (snapshot completo por commit)
   - shape_catalog / shape_suggestion_defaults / suggestion_stats : sugestao de proximo
     elemento (estilo Visio "quick shapes")

   Regra de acesso: toda consulta da API passa por server/db/access.js (dono, admin global, compartilhamento direto ou por time).
   Executar manualmente com um usuario com permissao de DDL. Script idempotente.
   ===================================================================== */

SET NOCOUNT ON;
GO

IF SCHEMA_ID(N'flowcraft') IS NULL EXEC (N'CREATE SCHEMA flowcraft');
GO

/* ---------------------------------------------------------------------
   1. users
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'flowcraft.users', N'U') IS NULL
CREATE TABLE flowcraft.users (
    unumber       VARCHAR(20)   NOT NULL,
    email         NVARCHAR(256) NOT NULL,
    display_name  NVARCHAR(200) NULL,
    entra_oid     UNIQUEIDENTIFIER NULL,
    is_active     BIT           NOT NULL CONSTRAINT DF_users_is_active DEFAULT (1),
    created_at    DATETIME2(3)  NOT NULL CONSTRAINT DF_users_created_at DEFAULT (SYSUTCDATETIME()),
    last_login_at DATETIME2(3)  NULL,
    CONSTRAINT PK_users PRIMARY KEY (unumber),
    CONSTRAINT UQ_users_email UNIQUE (email),
    CONSTRAINT CK_users_unumber_upper CHECK (unumber = UPPER(unumber))
);
GO

/* ---------------------------------------------------------------------
   2. boards (quadros)
   head_branch_id / base_commit_id: branch em que o quadro esta "checked out"
   e commit de origem da working copy (nodes/edges atuais).
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'flowcraft.boards', N'U') IS NULL
CREATE TABLE flowcraft.boards (
    board_id       UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_boards_id DEFAULT (NEWSEQUENTIALID()),
    owner_unumber  VARCHAR(20)    NOT NULL,
    name           NVARCHAR(200)  NOT NULL,
    description    NVARCHAR(1000) NULL,
    head_branch_id UNIQUEIDENTIFIER NULL,
    base_commit_id UNIQUEIDENTIFIER NULL,
    viewport_json  NVARCHAR(MAX)  NULL,   -- {x, y, zoom}
    settings_json  NVARCHAR(MAX)  NULL,   -- fundo, tema, grade etc.
    is_archived    BIT            NOT NULL CONSTRAINT DF_boards_is_archived DEFAULT (0),
    created_at     DATETIME2(3)   NOT NULL CONSTRAINT DF_boards_created_at DEFAULT (SYSUTCDATETIME()),
    updated_at     DATETIME2(3)   NOT NULL CONSTRAINT DF_boards_updated_at DEFAULT (SYSUTCDATETIME()),
    row_version    ROWVERSION     NOT NULL,   -- controle de concorrencia otimista
    CONSTRAINT PK_boards PRIMARY KEY (board_id),
    CONSTRAINT FK_boards_owner FOREIGN KEY (owner_unumber) REFERENCES flowcraft.users (unumber),
    CONSTRAINT CK_boards_viewport_json CHECK (viewport_json IS NULL OR ISJSON(viewport_json) = 1),
    CONSTRAINT CK_boards_settings_json CHECK (settings_json IS NULL OR ISJSON(settings_json) = 1)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_boards_owner' AND object_id = OBJECT_ID(N'flowcraft.boards'))
    CREATE INDEX IX_boards_owner ON flowcraft.boards (owner_unumber, is_archived, updated_at DESC);
GO

-- Nome unico por usuario entre quadros ativos
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_boards_owner_name' AND object_id = OBJECT_ID(N'flowcraft.boards'))
    CREATE UNIQUE INDEX UX_boards_owner_name ON flowcraft.boards (owner_unumber, name) WHERE is_archived = 0;
GO

/* ---------------------------------------------------------------------
   3. Versionamento (estilo git)
   commits  : snapshot completo (nodes + edges + attachments) em JSON, encadeado por parent
   branches : ponteiro mutavel para um commit
   tags     : ponteiro nomeado imutavel (ex.: "v1.0 aprovado")
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'flowcraft.commits', N'U') IS NULL
CREATE TABLE flowcraft.commits (
    commit_id        UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_commits_id DEFAULT (NEWSEQUENTIALID()),
    commit_seq       BIGINT           IDENTITY(1,1) NOT NULL,   -- ordem cronologica
    board_id         UNIQUEIDENTIFIER NOT NULL,
    parent_commit_id UNIQUEIDENTIFIER NULL,                     -- NULL = commit inicial
    author_unumber   VARCHAR(20)      NOT NULL,
    message          NVARCHAR(500)    NOT NULL,
    snapshot_json    NVARCHAR(MAX)    NOT NULL,                 -- {nodes:[], edges:[], attachments:[], viewport:{}}
    snapshot_hash    CHAR(64)         NOT NULL,                 -- SHA-256 hex do snapshot (evita commit duplicado)
    changes_json     NVARCHAR(MAX)    NULL,                     -- resumo do diff vs. parent (opcional)
    node_count       INT              NOT NULL CONSTRAINT DF_commits_node_count DEFAULT (0),
    edge_count       INT              NOT NULL CONSTRAINT DF_commits_edge_count DEFAULT (0),
    is_autosave      BIT              NOT NULL CONSTRAINT DF_commits_is_autosave DEFAULT (0),
    created_at       DATETIME2(3)     NOT NULL CONSTRAINT DF_commits_created_at DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_commits PRIMARY KEY NONCLUSTERED (commit_id),
    CONSTRAINT UQ_commits_board_commit UNIQUE (board_id, commit_id),
    CONSTRAINT FK_commits_board  FOREIGN KEY (board_id) REFERENCES flowcraft.boards (board_id) ON DELETE CASCADE,
    CONSTRAINT FK_commits_parent FOREIGN KEY (board_id, parent_commit_id) REFERENCES flowcraft.commits (board_id, commit_id),
    CONSTRAINT FK_commits_author FOREIGN KEY (author_unumber) REFERENCES flowcraft.users (unumber),
    CONSTRAINT CK_commits_snapshot_json CHECK (ISJSON(snapshot_json) = 1),
    CONSTRAINT CK_commits_changes_json  CHECK (changes_json IS NULL OR ISJSON(changes_json) = 1)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_commits_board_seq' AND object_id = OBJECT_ID(N'flowcraft.commits'))
    CREATE CLUSTERED INDEX IX_commits_board_seq ON flowcraft.commits (board_id, commit_seq DESC);
GO

IF OBJECT_ID(N'flowcraft.branches', N'U') IS NULL
CREATE TABLE flowcraft.branches (
    branch_id      UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_branches_id DEFAULT (NEWSEQUENTIALID()),
    board_id       UNIQUEIDENTIFIER NOT NULL,
    name           NVARCHAR(100)    NOT NULL,                   -- ex.: main, proposta-b
    head_commit_id UNIQUEIDENTIFIER NULL,
    created_by     VARCHAR(20)      NOT NULL,
    created_at     DATETIME2(3)     NOT NULL CONSTRAINT DF_branches_created_at DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_branches PRIMARY KEY (branch_id),
    CONSTRAINT UQ_branches_board_branch UNIQUE (board_id, branch_id),
    CONSTRAINT UQ_branches_board_name   UNIQUE (board_id, name),
    CONSTRAINT FK_branches_board  FOREIGN KEY (board_id) REFERENCES flowcraft.boards (board_id) ON DELETE CASCADE,
    CONSTRAINT FK_branches_head   FOREIGN KEY (board_id, head_commit_id) REFERENCES flowcraft.commits (board_id, commit_id),
    CONSTRAINT FK_branches_author FOREIGN KEY (created_by) REFERENCES flowcraft.users (unumber)
);
GO

IF OBJECT_ID(N'flowcraft.tags', N'U') IS NULL
CREATE TABLE flowcraft.tags (
    tag_id     UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_tags_id DEFAULT (NEWSEQUENTIALID()),
    board_id   UNIQUEIDENTIFIER NOT NULL,
    name       NVARCHAR(100)    NOT NULL,
    commit_id  UNIQUEIDENTIFIER NOT NULL,
    message    NVARCHAR(500)    NULL,
    created_by VARCHAR(20)      NOT NULL,
    created_at DATETIME2(3)     NOT NULL CONSTRAINT DF_tags_created_at DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_tags PRIMARY KEY (tag_id),
    CONSTRAINT UQ_tags_board_name UNIQUE (board_id, name),
    CONSTRAINT FK_tags_board  FOREIGN KEY (board_id) REFERENCES flowcraft.boards (board_id) ON DELETE CASCADE,
    CONSTRAINT FK_tags_commit FOREIGN KEY (board_id, commit_id) REFERENCES flowcraft.commits (board_id, commit_id),
    CONSTRAINT FK_tags_author FOREIGN KEY (created_by) REFERENCES flowcraft.users (unumber)
);
GO

-- Fecha o ciclo boards -> branches/commits (head_branch_id e base_commit_id)
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_boards_head_branch')
    ALTER TABLE flowcraft.boards ADD CONSTRAINT FK_boards_head_branch
        FOREIGN KEY (board_id, head_branch_id) REFERENCES flowcraft.branches (board_id, branch_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_boards_base_commit')
    ALTER TABLE flowcraft.boards ADD CONSTRAINT FK_boards_base_commit
        FOREIGN KEY (board_id, base_commit_id) REFERENCES flowcraft.commits (board_id, commit_id);
GO

/* ---------------------------------------------------------------------
   4. Catalogo de formas e sugestoes (estilo Visio "quick shapes")
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'flowcraft.shape_catalog', N'U') IS NULL
CREATE TABLE flowcraft.shape_catalog (
    shape_key      VARCHAR(40)   NOT NULL,
    label          NVARCHAR(100) NOT NULL,
    node_type      VARCHAR(30)   NOT NULL,   -- tipo de no criado no canvas
    default_width  INT           NOT NULL,
    default_height INT           NOT NULL,
    default_style_json NVARCHAR(MAX) NULL,
    sort_order     INT           NOT NULL CONSTRAINT DF_shape_catalog_sort DEFAULT (0),
    is_active      BIT           NOT NULL CONSTRAINT DF_shape_catalog_active DEFAULT (1),
    CONSTRAINT PK_shape_catalog PRIMARY KEY (shape_key),
    CONSTRAINT CK_shape_catalog_style CHECK (default_style_json IS NULL OR ISJSON(default_style_json) = 1)
);
GO

-- Sugestao padrao (global): "depois de X, sugerir Y" na ordem de rank
IF OBJECT_ID(N'flowcraft.shape_suggestion_defaults', N'U') IS NULL
CREATE TABLE flowcraft.shape_suggestion_defaults (
    from_shape_key VARCHAR(40) NOT NULL,     -- '*' = qualquer forma
    to_shape_key   VARCHAR(40) NOT NULL,
    rank_order     TINYINT     NOT NULL,
    CONSTRAINT PK_shape_suggestion_defaults PRIMARY KEY (from_shape_key, to_shape_key),
    CONSTRAINT FK_shape_suggestion_defaults_to FOREIGN KEY (to_shape_key) REFERENCES flowcraft.shape_catalog (shape_key)
);
GO

-- Aprendizado por usuario: incrementado cada vez que o usuario cria Y a partir de X
IF OBJECT_ID(N'flowcraft.suggestion_stats', N'U') IS NULL
CREATE TABLE flowcraft.suggestion_stats (
    owner_unumber  VARCHAR(20) NOT NULL,
    from_shape_key VARCHAR(40) NOT NULL,     -- '*' = qualquer forma
    to_shape_key   VARCHAR(40) NOT NULL,
    use_count      INT         NOT NULL CONSTRAINT DF_suggestion_stats_count DEFAULT (0),
    last_used_at   DATETIME2(3) NOT NULL CONSTRAINT DF_suggestion_stats_last DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_suggestion_stats PRIMARY KEY (owner_unumber, from_shape_key, to_shape_key),
    CONSTRAINT FK_suggestion_stats_owner FOREIGN KEY (owner_unumber) REFERENCES flowcraft.users (unumber) ON DELETE CASCADE,
    CONSTRAINT FK_suggestion_stats_to    FOREIGN KEY (to_shape_key) REFERENCES flowcraft.shape_catalog (shape_key)
);
GO

/* ---------------------------------------------------------------------
   5. Canvas livre (working copy do quadro)
   Areas/raias sao nos com node_type = 'area'; nos podem ficar dentro de uma area via parent_node_id.
   Condicionais sao nos 'gateway' + edges com branch 'true'/'false'.
   IDs de no/aresta sao os ids do React Flow (texto), unicos dentro do quadro.
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'flowcraft.nodes', N'U') IS NULL
CREATE TABLE flowcraft.nodes (
    board_id       UNIQUEIDENTIFIER NOT NULL,
    node_id        NVARCHAR(64)     NOT NULL,
    node_type      VARCHAR(30)      NOT NULL,
    shape_key      VARCHAR(40)      NULL,
    parent_node_id NVARCHAR(64)     NULL,
    pos_x          FLOAT            NOT NULL CONSTRAINT DF_nodes_x DEFAULT (0),
    pos_y          FLOAT            NOT NULL CONSTRAINT DF_nodes_y DEFAULT (0),
    width          FLOAT            NULL,
    height         FLOAT            NULL,
    rotation       FLOAT            NOT NULL CONSTRAINT DF_nodes_rotation DEFAULT (0),
    z_index        INT              NOT NULL CONSTRAINT DF_nodes_z DEFAULT (0),
    title          NVARCHAR(300)    NULL,
    description    NVARCHAR(MAX)    NULL,
    inputs         NVARCHAR(MAX)    NULL,
    outputs        NVARCHAR(MAX)    NULL,
    style_json     NVARCHAR(MAX)    NULL,
    data_json      NVARCHAR(MAX)    NULL,   -- campos extras sem coluna propria
    is_locked      BIT              NOT NULL CONSTRAINT DF_nodes_locked DEFAULT (0),
    created_at     DATETIME2(3)     NOT NULL CONSTRAINT DF_nodes_created_at DEFAULT (SYSUTCDATETIME()),
    updated_at     DATETIME2(3)     NOT NULL CONSTRAINT DF_nodes_updated_at DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_nodes PRIMARY KEY (board_id, node_id),
    CONSTRAINT FK_nodes_board  FOREIGN KEY (board_id) REFERENCES flowcraft.boards (board_id) ON DELETE CASCADE,
    CONSTRAINT FK_nodes_parent FOREIGN KEY (board_id, parent_node_id) REFERENCES flowcraft.nodes (board_id, node_id),
    CONSTRAINT FK_nodes_shape  FOREIGN KEY (shape_key) REFERENCES flowcraft.shape_catalog (shape_key),
    CONSTRAINT CK_nodes_type CHECK (node_type IN ('start','end','stage','gateway','area','text','shape','note')),
    CONSTRAINT CK_nodes_style_json CHECK (style_json IS NULL OR ISJSON(style_json) = 1),
    CONSTRAINT CK_nodes_data_json  CHECK (data_json IS NULL OR ISJSON(data_json) = 1)
);
GO

/* Ao excluir um no, a API deve excluir antes as arestas dele (source e target) e os filhos (parent_node_id)
   na mesma transacao; excluir o quadro remove tudo em cascata. */
IF OBJECT_ID(N'flowcraft.edges', N'U') IS NULL
CREATE TABLE flowcraft.edges (
    board_id       UNIQUEIDENTIFIER NOT NULL,
    edge_id        NVARCHAR(64)     NOT NULL,
    source_node_id NVARCHAR(64)     NOT NULL,
    target_node_id NVARCHAR(64)     NOT NULL,
    source_handle  VARCHAR(30)      NULL,
    target_handle  VARCHAR(30)      NULL,
    edge_type      VARCHAR(30)      NULL,
    label          NVARCHAR(200)    NULL,
    branch         VARCHAR(5)       NULL,   -- 'true' | 'false' (saidas de gateway)
    style_json     NVARCHAR(MAX)    NULL,
    data_json      NVARCHAR(MAX)    NULL,
    created_at     DATETIME2(3)     NOT NULL CONSTRAINT DF_edges_created_at DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_edges PRIMARY KEY (board_id, edge_id),
    CONSTRAINT FK_edges_board  FOREIGN KEY (board_id) REFERENCES flowcraft.boards (board_id) ON DELETE CASCADE,
    CONSTRAINT FK_edges_source FOREIGN KEY (board_id, source_node_id) REFERENCES flowcraft.nodes (board_id, node_id),
    CONSTRAINT FK_edges_target FOREIGN KEY (board_id, target_node_id) REFERENCES flowcraft.nodes (board_id, node_id),
    CONSTRAINT CK_edges_branch CHECK (branch IS NULL OR branch IN ('true','false')),
    CONSTRAINT CK_edges_style_json CHECK (style_json IS NULL OR ISJSON(style_json) = 1),
    CONSTRAINT CK_edges_data_json  CHECK (data_json IS NULL OR ISJSON(data_json) = 1)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_edges_source' AND object_id = OBJECT_ID(N'flowcraft.edges'))
    CREATE INDEX IX_edges_source ON flowcraft.edges (board_id, source_node_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_edges_target' AND object_id = OBJECT_ID(N'flowcraft.edges'))
    CREATE INDEX IX_edges_target ON flowcraft.edges (board_id, target_node_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_nodes_parent' AND object_id = OBJECT_ID(N'flowcraft.nodes'))
    CREATE INDEX IX_nodes_parent ON flowcraft.nodes (board_id, parent_node_id);
GO

/* Prints das etapas: arquivo no S3 (bucket S3_BUCKET), aqui apenas a chave. Limite de 3 por no controlado pela API. */
IF OBJECT_ID(N'flowcraft.attachments', N'U') IS NULL
CREATE TABLE flowcraft.attachments (
    attachment_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_attachments_id DEFAULT (NEWSEQUENTIALID()),
    board_id      UNIQUEIDENTIFIER NOT NULL,
    node_id       NVARCHAR(64)     NOT NULL,
    s3_key        NVARCHAR(500)    NOT NULL,
    file_name     NVARCHAR(260)    NOT NULL,
    content_type  VARCHAR(100)     NULL,
    size_bytes    BIGINT           NULL,
    sort_order    TINYINT          NOT NULL CONSTRAINT DF_attachments_sort DEFAULT (0),
    created_by    VARCHAR(20)      NOT NULL,
    created_at    DATETIME2(3)     NOT NULL CONSTRAINT DF_attachments_created_at DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_attachments PRIMARY KEY (attachment_id),
    CONSTRAINT FK_attachments_node   FOREIGN KEY (board_id, node_id) REFERENCES flowcraft.nodes (board_id, node_id) ON DELETE CASCADE,
    CONSTRAINT FK_attachments_author FOREIGN KEY (created_by) REFERENCES flowcraft.users (unumber)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_attachments_node' AND object_id = OBJECT_ID(N'flowcraft.attachments'))
    CREATE INDEX IX_attachments_node ON flowcraft.attachments (board_id, node_id, sort_order);
GO

/* ---------------------------------------------------------------------
   6. Seed: catalogo de formas (as 5 do quick-shapes + elementos BPMN)
   --------------------------------------------------------------------- */
MERGE flowcraft.shape_catalog AS t
USING (VALUES
    ('rectangle',      N'Retângulo',        'shape',   160, 80,  10),
    ('square',         N'Quadrado',         'shape',   100, 100, 20),
    ('circle',         N'Círculo',          'shape',   100, 100, 30),
    ('ellipse',        N'Elipse',           'shape',   140, 80,  40),
    ('right_triangle', N'Triângulo',        'shape',   100, 100, 50),
    ('stage',          N'Etapa',            'stage',   220, 90,  60),
    ('gateway',        N'Condicional',      'gateway', 90,  90,  70),
    ('start',          N'Início',           'start',   70,  70,  80),
    ('end',            N'Fim',              'end',     70,  70,  90),
    ('area',           N'Área / raia',      'area',    600, 240, 100),
    ('pool',           N'Pool',             'area',    760, 360, 101),
    ('lane',           N'Lane',             'area',    760, 140, 102),
    ('phase',          N'Phase',            'area',    380, 300, 103),
    ('text',           N'Texto',            'text',    160, 40,  110),
    ('note',           N'Nota',             'note',    160, 120, 120)
) AS s (shape_key, label, node_type, default_width, default_height, sort_order)
ON t.shape_key = s.shape_key
WHEN NOT MATCHED THEN
    INSERT (shape_key, label, node_type, default_width, default_height, sort_order)
    VALUES (s.shape_key, s.label, s.node_type, s.default_width, s.default_height, s.sort_order);
GO

-- A area generica foi substituida pelos swimlanes BPMN (pool/lane/phase); nos antigos continuam validos.
UPDATE flowcraft.shape_catalog SET is_active = 0 WHERE shape_key = 'area';
GO

-- Residuos: nos de area legados viram phase (frame tracejado equivalente).
UPDATE flowcraft.nodes SET shape_key = 'phase' WHERE node_type = 'area' AND (shape_key IS NULL OR shape_key = 'area');
GO

-- Sugestoes iniciais (usadas ate o usuario gerar historico em suggestion_stats)
MERGE flowcraft.shape_suggestion_defaults AS t
USING (VALUES
    ('*',       'stage',     1),
    ('*',       'gateway',   2),
    ('*',       'end',       3),
    ('start',   'stage',     1),
    ('stage',   'stage',     1),
    ('stage',   'gateway',   2),
    ('stage',   'end',       3),
    ('gateway', 'stage',     1),
    ('gateway', 'end',       2),
    ('end',     'stage',     1)
) AS s (from_shape_key, to_shape_key, rank_order)
ON t.from_shape_key = s.from_shape_key AND t.to_shape_key = s.to_shape_key
WHEN NOT MATCHED THEN
    INSERT (from_shape_key, to_shape_key, rank_order)
    VALUES (s.from_shape_key, s.to_shape_key, s.rank_order);
GO

-- Versao so do grafo (viewport/nome nao entram): base do controle de edicao concorrente
IF COL_LENGTH(N'flowcraft.boards', N'graph_version') IS NULL
    ALTER TABLE flowcraft.boards ADD graph_version BIGINT NOT NULL CONSTRAINT DF_boards_graph_version DEFAULT (0);
GO

/* ---------------------------------------------------------------------
   6b. Colaboracao: admins globais, times, compartilhamento de quadros e auditoria
   Papel efetivo em um quadro = maior entre: dono (owner), admin global (owner),
   compartilhamento direto e compartilhamento via time (viewer | editor).
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'flowcraft.admins', N'U') IS NULL
CREATE TABLE flowcraft.admins (
    unumber    VARCHAR(20)  NOT NULL,
    granted_by VARCHAR(20)  NULL,
    granted_at DATETIME2(3) NOT NULL CONSTRAINT DF_admins_granted_at DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_admins PRIMARY KEY (unumber),
    CONSTRAINT FK_admins_user FOREIGN KEY (unumber) REFERENCES flowcraft.users (unumber)
);
GO

IF OBJECT_ID(N'flowcraft.teams', N'U') IS NULL
CREATE TABLE flowcraft.teams (
    team_id     UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_teams_id DEFAULT (NEWSEQUENTIALID()),
    name        NVARCHAR(100)  NOT NULL,
    description NVARCHAR(500)  NULL,
    created_by  VARCHAR(20)    NOT NULL,
    created_at  DATETIME2(3)   NOT NULL CONSTRAINT DF_teams_created_at DEFAULT (SYSUTCDATETIME()),
    is_archived BIT            NOT NULL CONSTRAINT DF_teams_archived DEFAULT (0),
    CONSTRAINT PK_teams PRIMARY KEY (team_id),
    CONSTRAINT FK_teams_creator FOREIGN KEY (created_by) REFERENCES flowcraft.users (unumber)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_teams_name' AND object_id = OBJECT_ID(N'flowcraft.teams'))
    CREATE UNIQUE INDEX UX_teams_name ON flowcraft.teams (name) WHERE is_archived = 0;
GO

IF OBJECT_ID(N'flowcraft.team_members', N'U') IS NULL
CREATE TABLE flowcraft.team_members (
    team_id  UNIQUEIDENTIFIER NOT NULL,
    unumber  VARCHAR(20)      NOT NULL,
    role     VARCHAR(12)      NOT NULL CONSTRAINT DF_team_members_role DEFAULT ('member'),
    added_by VARCHAR(20)      NULL,
    added_at DATETIME2(3)     NOT NULL CONSTRAINT DF_team_members_added_at DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_team_members PRIMARY KEY (team_id, unumber),
    CONSTRAINT CK_team_members_role CHECK (role IN ('member', 'team_admin')),
    CONSTRAINT FK_team_members_team FOREIGN KEY (team_id) REFERENCES flowcraft.teams (team_id) ON DELETE CASCADE,
    CONSTRAINT FK_team_members_user FOREIGN KEY (unumber) REFERENCES flowcraft.users (unumber)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_team_members_user' AND object_id = OBJECT_ID(N'flowcraft.team_members'))
    CREATE INDEX IX_team_members_user ON flowcraft.team_members (unumber);
GO

-- Compartilhamento: exatamente um destinatario (usuario OU time) por linha
IF OBJECT_ID(N'flowcraft.board_shares', N'U') IS NULL
CREATE TABLE flowcraft.board_shares (
    share_id     UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_board_shares_id DEFAULT (NEWSEQUENTIALID()),
    board_id     UNIQUEIDENTIFIER NOT NULL,
    user_unumber VARCHAR(20)      NULL,
    team_id      UNIQUEIDENTIFIER NULL,
    role         VARCHAR(10)      NOT NULL,
    granted_by   VARCHAR(20)      NOT NULL,
    granted_at   DATETIME2(3)     NOT NULL CONSTRAINT DF_board_shares_granted_at DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_board_shares PRIMARY KEY (share_id),
    CONSTRAINT CK_board_shares_role CHECK (role IN ('viewer', 'editor')),
    CONSTRAINT CK_board_shares_target CHECK ((user_unumber IS NULL AND team_id IS NOT NULL) OR (user_unumber IS NOT NULL AND team_id IS NULL)),
    CONSTRAINT FK_board_shares_board FOREIGN KEY (board_id) REFERENCES flowcraft.boards (board_id) ON DELETE CASCADE,
    CONSTRAINT FK_board_shares_user FOREIGN KEY (user_unumber) REFERENCES flowcraft.users (unumber),
    CONSTRAINT FK_board_shares_team FOREIGN KEY (team_id) REFERENCES flowcraft.teams (team_id) ON DELETE CASCADE,
    CONSTRAINT FK_board_shares_grantor FOREIGN KEY (granted_by) REFERENCES flowcraft.users (unumber)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_board_shares_user' AND object_id = OBJECT_ID(N'flowcraft.board_shares'))
    CREATE UNIQUE INDEX UX_board_shares_user ON flowcraft.board_shares (board_id, user_unumber) WHERE user_unumber IS NOT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_board_shares_team' AND object_id = OBJECT_ID(N'flowcraft.board_shares'))
    CREATE UNIQUE INDEX UX_board_shares_team ON flowcraft.board_shares (board_id, team_id) WHERE team_id IS NOT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_board_shares_user' AND object_id = OBJECT_ID(N'flowcraft.board_shares'))
    CREATE INDEX IX_board_shares_user ON flowcraft.board_shares (user_unumber) INCLUDE (board_id, role);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_board_shares_team' AND object_id = OBJECT_ID(N'flowcraft.board_shares'))
    CREATE INDEX IX_board_shares_team ON flowcraft.board_shares (team_id) INCLUDE (board_id, role);
GO

IF OBJECT_ID(N'flowcraft.audit_log', N'U') IS NULL
CREATE TABLE flowcraft.audit_log (
    audit_id   BIGINT IDENTITY(1,1) NOT NULL,
    actor      VARCHAR(20)      NOT NULL,
    action     VARCHAR(60)      NOT NULL,
    board_id   UNIQUEIDENTIFIER NULL,
    team_id    UNIQUEIDENTIFIER NULL,
    target     NVARCHAR(200)    NULL,
    detail     NVARCHAR(500)    NULL,
    created_at DATETIME2(3)     NOT NULL CONSTRAINT DF_audit_created_at DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_audit_log PRIMARY KEY (audit_id)
);
GO

/* ---------------------------------------------------------------------
   6c. Comentarios do quadro (preso a um elemento ou ao quadro; mencoes @U123456)
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'flowcraft.comments', N'U') IS NULL
CREATE TABLE flowcraft.comments (
    comment_id    UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_comments_id DEFAULT (NEWSEQUENTIALID()),
    board_id      UNIQUEIDENTIFIER NOT NULL,
    node_id       NVARCHAR(64)     NULL,
    parent_id     UNIQUEIDENTIFIER NULL,
    author_unumber VARCHAR(20)     NOT NULL,
    body          NVARCHAR(2000)   NOT NULL,
    mentions_json NVARCHAR(500)    NULL,
    is_resolved   BIT              NOT NULL CONSTRAINT DF_comments_resolved DEFAULT (0),
    created_at    DATETIME2(3)     NOT NULL CONSTRAINT DF_comments_created_at DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_comments PRIMARY KEY (comment_id),
    CONSTRAINT FK_comments_board FOREIGN KEY (board_id) REFERENCES flowcraft.boards (board_id) ON DELETE CASCADE,
    CONSTRAINT FK_comments_author FOREIGN KEY (author_unumber) REFERENCES flowcraft.users (unumber)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_comments_board' AND object_id = OBJECT_ID(N'flowcraft.comments'))
    CREATE INDEX IX_comments_board ON flowcraft.comments (board_id, created_at);
GO

-- Severidade da revisao: issue (vermelho), warning (amarelo), ok (verde); NULL = comentario comum.
IF COL_LENGTH(N'flowcraft.comments', N'severity') IS NULL
    ALTER TABLE flowcraft.comments ADD severity VARCHAR(10) NULL;
GO

/* ---------------------------------------------------------------------
   6d. Revisao de mudancas: quadro protegido + time revisor + propostas (copia do quadro)
   --------------------------------------------------------------------- */
IF COL_LENGTH(N'flowcraft.boards', N'is_protected') IS NULL
    ALTER TABLE flowcraft.boards ADD is_protected BIT NOT NULL CONSTRAINT DF_boards_protected DEFAULT (0);
GO

IF COL_LENGTH(N'flowcraft.boards', N'review_team_id') IS NULL
    ALTER TABLE flowcraft.boards ADD review_team_id UNIQUEIDENTIFIER NULL;
GO

IF OBJECT_ID(N'flowcraft.change_requests', N'U') IS NULL
CREATE TABLE flowcraft.change_requests (
    request_id       UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_change_requests_id DEFAULT (NEWSEQUENTIALID()),
    board_id         UNIQUEIDENTIFIER NOT NULL,
    fork_board_id    UNIQUEIDENTIFIER NOT NULL,
    base_commit_id   UNIQUEIDENTIFIER NOT NULL,
    title            NVARCHAR(200)    NOT NULL,
    description      NVARCHAR(2000)   NULL,
    author_unumber   VARCHAR(20)      NOT NULL,
    opened_by        VARCHAR(20)      NOT NULL,
    status           VARCHAR(20)      NOT NULL CONSTRAINT DF_change_requests_status DEFAULT ('draft'),
    proposed_json    NVARCHAR(MAX)    NULL,
    decided_by       VARCHAR(20)      NULL,
    decision_comment NVARCHAR(1000)   NULL,
    decided_at       DATETIME2(3)     NULL,
    merged_commit_id UNIQUEIDENTIFIER NULL,
    created_at       DATETIME2(3)     NOT NULL CONSTRAINT DF_change_requests_created DEFAULT (SYSUTCDATETIME()),
    updated_at       DATETIME2(3)     NOT NULL CONSTRAINT DF_change_requests_updated DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_change_requests PRIMARY KEY (request_id),
    CONSTRAINT CK_change_requests_status CHECK (status IN ('draft', 'open', 'changes_requested', 'merged', 'rejected', 'cancelled')),
    CONSTRAINT FK_change_requests_board FOREIGN KEY (board_id) REFERENCES flowcraft.boards (board_id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_change_requests_board' AND object_id = OBJECT_ID(N'flowcraft.change_requests'))
    CREATE INDEX IX_change_requests_board ON flowcraft.change_requests (board_id, status);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_change_requests_fork' AND object_id = OBJECT_ID(N'flowcraft.change_requests'))
    CREATE INDEX IX_change_requests_fork ON flowcraft.change_requests (fork_board_id);
GO

/* ---------------------------------------------------------------------
   7. Permissoes para o usuario da aplicacao
   --------------------------------------------------------------------- */
IF DATABASE_PRINCIPAL_ID(N'rpa_area_finance_internal_rw') IS NOT NULL
    GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::flowcraft TO [rpa_area_finance_internal_rw];
GO

/* ---------------------------------------------------------------------
   8. (OPCIONAL) Row-Level Security como segunda barreira alem do filtro na API.
   Exige que a API execute, a cada conexao:
       EXEC sp_set_session_context @key = N'unumber', @value = @unumber, @read_only = 1;
   Descomente somente depois de a API estar fazendo isso, senao nenhuma linha sera visivel.
   --------------------------------------------------------------------- */
/*
CREATE FUNCTION flowcraft.fn_board_owner_filter(@owner_unumber VARCHAR(20))
RETURNS TABLE WITH SCHEMABINDING AS
RETURN SELECT 1 AS allowed WHERE @owner_unumber = CAST(SESSION_CONTEXT(N'unumber') AS VARCHAR(20));
GO
CREATE SECURITY POLICY flowcraft.board_owner_policy
    ADD FILTER PREDICATE flowcraft.fn_board_owner_filter(owner_unumber) ON flowcraft.boards,
    ADD BLOCK  PREDICATE flowcraft.fn_board_owner_filter(owner_unumber) ON flowcraft.boards
    WITH (STATE = ON);
GO
*/

/* ---------------------------------------------------------------------
   Rollback completo (apenas dev) - descomente para recriar do zero
   ---------------------------------------------------------------------
DROP TABLE IF EXISTS flowcraft.comments, flowcraft.audit_log, flowcraft.board_shares, flowcraft.team_members, flowcraft.teams, flowcraft.admins, flowcraft.attachments, flowcraft.edges, flowcraft.nodes, flowcraft.tags,
    flowcraft.suggestion_stats, flowcraft.shape_suggestion_defaults;
ALTER TABLE flowcraft.boards DROP CONSTRAINT IF EXISTS FK_boards_head_branch, FK_boards_base_commit;
DROP TABLE IF EXISTS flowcraft.branches, flowcraft.commits, flowcraft.boards, flowcraft.shape_catalog, flowcraft.users;
DROP SCHEMA IF EXISTS flowcraft;
*/
